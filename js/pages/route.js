(function() {
	if (!window.VTApp) return;
	const db = VTApp.getDb();
	if (!db) return;

	let busId = null;
	try { busId = localStorage.getItem('v-track-driver-busId'); } catch(e) {}

	function getUid() { try { return localStorage.getItem('vtrack_driver_uid'); } catch(e) { return null; } }

	async function resolveBusId() {
		if (busId) return busId;
		const uid = getUid();
		if (!uid) return null;
		const snap = await db.ref(`driverInfo/${uid}`).once('value');
		const d = snap.val() || {};
		if (d.assignedBusId) {
			try { localStorage.setItem('v-track-driver-busId', d.assignedBusId); } catch(e) {}
			return d.assignedBusId;
		}
		return null;
	}

	let driverMap = null;
	let currentRoutingControl = null;
	
	function ensureMap() {
		// First check if map already exists
		if (driverMap) return driverMap;
		
		// Try to use VTMapAPI if available
		if (window.VTMapAPI && VTMapAPI.initDriverMap) {
			VTMapAPI.initDriverMap();
			if (VTMapAPI._state && VTMapAPI._state.map) {
				driverMap = VTMapAPI._state.map;
				return driverMap;
			}
		}
		
		// Create map directly if VTMapAPI is not available
		const mapContainer = document.getElementById('driverRouteMap');
		if (!mapContainer) return null;
		
		try {
			driverMap = L.map('driverRouteMap').setView([27.7172, 85.3240], 13); // Kathmandu, Nepal
			L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
				attribution: '© OpenStreetMap contributors'
			}).addTo(driverMap);
		} catch (e) {
			console.error('Error creating map:', e);
		}
		
		return driverMap;
	}

	let currentRouteId = null;

	async function showAssignedRoute() {
		const id = await resolveBusId();
		if (!id) return;
		const map = ensureMap();
		if (!map) return;
		// get route id from busDetails
		const busSnap = await db.ref(`busDetails/${id}`).once('value');
		const bus = busSnap.val() || {};
		if (!bus.route) return;
		const routeSnap = await db.ref(`routes/${bus.route}`).once('value');
		const route = routeSnap.val() || {};
		if (!route.points || !route.points.length) return;
		currentRouteId = bus.route;
		const points = route.points.map(p => [p.lat, p.lng]).filter(arr => Number.isFinite(arr[0]) && Number.isFinite(arr[1]));
		if (points.length < 2) return;
		const poly = L.polyline(points, { color:'#28a745', weight:4, opacity:0.9 }).addTo(map);
		map.fitBounds(poly.getBounds(), { padding:[20,20] });
		// add markers for points with names
		route.points.forEach((p, idx) => {
			if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return;
			L.marker([p.lat, p.lng]).bindPopup(`${idx+1}. ${p.name || ''}`).addTo(map);
		});
		// also add latest bus location
		const locSnap = await db.ref(`BusLocation/${id}`).limitToLast(1).once('value');
		const locs = locSnap.val() || {};
		const keys = Object.keys(locs);
		if (keys.length) {
			const last = locs[keys[keys.length-1]];
			if (last && Number.isFinite(last.latitude) && Number.isFinite(last.longitude)) {
				L.marker([last.latitude, last.longitude]).bindPopup(`Bus ${id}`).addTo(map);
			}
		}
	}

	// List all routes and allow viewing/starting them
	function renderRoutesList(routesObj) {
		let container = document.getElementById('routesListDriver');
		if (!container) {
			const host = document.querySelector('.route-details') || document.body;
			container = document.createElement('div');
			container.id = 'routesListDriver';
			container.style.marginTop = '12px';
			container.style.padding = '10px';
			container.style.border = '1px solid rgba(0,0,0,0.1)';
			container.style.borderRadius = '8px';
			const title = document.createElement('h3');
			title.textContent = 'Available Routes';
			host.appendChild(title);
			host.appendChild(container);
		}
		const entries = Object.entries(routesObj || {});
		if (!entries.length) { container.innerHTML = '<div style="opacity:0.7;">No routes available</div>'; return; }
		container.innerHTML = entries.map(([id, r]) => (
			`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(0,0,0,0.06);">
				<div>
					<div style="font-weight:600;">${escapeHtml(r.name || id)}</div>
					<div style="opacity:0.7;font-size:12px;">Points: ${(r.points && r.points.length) || 0}</div>
				</div>
				<div style="display:flex;gap:8px;">
					<button data-view="${id}" style="padding:6px 10px;border:1px solid #1a73e8;border-radius:6px;background:#fff;color:#1a73e8;cursor:pointer;">View</button>
					<button data-start="${id}" style="padding:6px 10px;border:1px solid #28a745;border-radius:6px;background:#fff;color:#28a745;cursor:pointer;">Start</button>
				</div>
			</div>`
		)).join('');
		container.querySelectorAll('button[data-view]').forEach(btn => btn.addEventListener('click', () => viewRouteOnMap(btn.getAttribute('data-view'))));
		container.querySelectorAll('button[data-start]').forEach(btn => btn.addEventListener('click', () => startRouteById(btn.getAttribute('data-start'))));
	}

	async function viewRouteOnMap(routeId) {
		const map = ensureMap(); 
		if (!map) {
			alert('Map could not be initialized. Please refresh the page.');
			return;
		}

		// Fetch route from Firebase
		const snap = await db.ref(`routes/${routeId}`).once('value');
		const route = snap.val() || {};
		
		if (!route.points || !route.points.length) {
			alert('This route has no points defined.');
			return;
		}

		// Convert points to LatLng and filter valid coordinates
		const pointsArray = route.points.filter(p => 
			Number.isFinite(p.lat) && Number.isFinite(p.lng)
		);

		if (pointsArray.length === 0) {
			alert('This route has no valid coordinates.');
			return;
		}

		// Get first and last point names
		const fromLocation = pointsArray[0].name || 'Start Point';
		const toLocation = pointsArray[pointsArray.length - 1].name || 'End Point';

		// Clear existing routing control
		if (currentRoutingControl) {
			try {
				map.removeControl(currentRoutingControl);
			} catch (e) {
				console.warn('Could not remove previous routing control:', e);
			}
			currentRoutingControl = null;
		}

		// Clear existing overlays (except base tile layer)
		map.eachLayer(layer => {
			if (!(layer instanceof L.TileLayer)) {
				map.removeLayer(layer);
			}
		});

		// Create waypoints for routing
		const waypoints = pointsArray.map(p => L.latLng(p.lat, p.lng));

		// Try to use Leaflet Routing Machine if available
		if (typeof L.Routing !== 'undefined' && L.Routing.control) {
			try {
				currentRoutingControl = L.Routing.control({
					waypoints,
					routeWhileDragging: false,
					addWaypoints: false,
					show: false, // Hide text directions
					lineOptions: {
						styles: [{ color: '#1a73e8', weight: 5, opacity: 0.9 }]
					},
					createMarker: (i, wp) => {
						return L.marker(wp.latLng, {
							icon: L.divIcon({
								className: 'route-marker',
								html: `<b>${i + 1}</b>`,
								iconSize: [24, 24],
								iconAnchor: [12, 12]
							})
						}).bindPopup(`<b>${pointsArray[i].name || `Stop ${i + 1}`}</b>`);
					}
				})
				.on('routesfound', (e) => {
					const coords = e.routes[0].coordinates.map(c => [c.lat, c.lng]);
					map.fitBounds(L.latLngBounds(coords), { padding: [20, 20] });

					// Get route summary from routing result
					const routeSummary = e.routes[0].summary;
					const distanceKm = (routeSummary.totalDistance / 1000).toFixed(1);
					const timeMinutes = Math.round(routeSummary.totalTime / 60);
					const hours = Math.floor(timeMinutes / 60);
					const minutes = timeMinutes % 60;
					const timeStr = hours > 0 ? `${hours} hr${hours > 1 ? 's' : ''} ${minutes} min` : `${minutes} min`;

					// Update route card with actual data
					updateRouteCard(fromLocation, toLocation, distanceKm, timeStr);

					// Animate bus marker along the route
					let index = 0;
					let animationSpeed = 50; // milliseconds per step
					const busMarker = L.marker(coords[0], { 
						icon: L.divIcon({ 
							className: 'bus-marker', 
							html: '🚌', 
							iconSize: [32, 32], 
							iconAnchor: [16, 16] 
						}),
						zIndexOffset: 1000
					}).addTo(map);

					const animateBus = () => {
						if (index < coords.length - 1) {
							index++;
							busMarker.setLatLng(coords[index]);
							setTimeout(animateBus, animationSpeed);
						}
					};
					
					// Start animation after a brief delay
					setTimeout(animateBus, 500);
				})
				.on('routingerror', (err) => {
					console.warn('Routing service failed, using fallback:', err);
					const fallbackResult = showFallbackRoute(map, waypoints, pointsArray);
					updateRouteCard(fromLocation, toLocation, fallbackResult.distance, fallbackResult.time);
				})
				.addTo(map);
			} catch (e) {
				console.warn('Leaflet Routing Machine failed, using fallback:', e);
				const fallbackResult = showFallbackRoute(map, waypoints, pointsArray);
				updateRouteCard(fromLocation, toLocation, fallbackResult.distance, fallbackResult.time);
			}
		} else {
			// Fallback: Draw simple polyline
			const fallbackResult = showFallbackRoute(map, waypoints, pointsArray);
			updateRouteCard(fromLocation, toLocation, fallbackResult.distance, fallbackResult.time);
		}

		// Show popup with route info
		setTimeout(() => {
			const popupContent = `
				<div style="min-width: 260px; padding: 8px;">
					<h3 style="margin: 0 0 8px 0;">🚌 ${escapeHtml(route.name || 'Route Details')}</h3>
					<p style="margin: 4px 0;"><strong>Description:</strong> ${escapeHtml(route.description || 'No description available')}</p>
					<p style="margin: 4px 0;"><strong>Total Stops:</strong> ${pointsArray.length}</p>
					<p style="margin: 8px 0 0 0; font-size: 12px; color: #666;">📍 Click on markers to see stop names</p>
				</div>`;
			L.popup()
				.setLatLng(map.getCenter())
				.setContent(popupContent)
				.openOn(map);
		}, 1000);

		currentRouteId = routeId;
	}

	function updateRouteCard(fromLocation, toLocation, distance, time) {
		const routeCard = document.querySelector('.route-card');
		if (!routeCard) return;

		routeCard.innerHTML = `
			<p><strong>From:</strong> ${escapeHtml(fromLocation)}</p>
			<p><strong>To:</strong> ${escapeHtml(toLocation)}</p>
			<p><strong>Distance:</strong> ${distance} km</p>
			<p><strong>Estimated Time:</strong> ${escapeHtml(time)}</p>
		`;
	}

	function showFallbackRoute(map, waypoints, pointsArray) {
		// Draw simple polyline connecting all points
		const coords = waypoints.map(w => [w.lat, w.lng]);
		const poly = L.polyline(coords, { 
			color: '#1a73e8', 
			weight: 5, 
			opacity: 0.8,
			dashArray: '10, 5'
		}).addTo(map);
		
		map.fitBounds(poly.getBounds(), { padding: [20, 20] });

		// Calculate total distance using Haversine formula
		let totalDistance = 0;
		for (let i = 0; i < coords.length - 1; i++) {
			totalDistance += calculateDistance(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
		}
		const distanceKm = totalDistance.toFixed(1);

		// Estimate time (assuming average speed of 40 km/h)
		const avgSpeed = 40; // km/h
		const timeHours = totalDistance / avgSpeed;
		const hours = Math.floor(timeHours);
		const minutes = Math.round((timeHours - hours) * 60);
		const timeStr = hours > 0 ? `${hours} hr${hours > 1 ? 's' : ''} ${minutes} min` : `${minutes} min`;

		// Add markers for each point
		pointsArray.forEach((point, index) => {
			L.marker([point.lat, point.lng], {
				icon: L.divIcon({
					className: 'route-marker',
					html: `<b>${index + 1}</b>`,
					iconSize: [24, 24],
					iconAnchor: [12, 12]
				})
			})
			.bindPopup(`<b>${escapeHtml(point.name || `Stop ${index + 1}`)}</b>`)
			.addTo(map);
		});

		// Add animated bus marker
		const busMarker = L.marker(coords[0], {
			icon: L.divIcon({
				className: 'bus-marker',
				html: '🚌',
				iconSize: [32, 32],
				iconAnchor: [16, 16]
			}),
			zIndexOffset: 1000
		}).addTo(map);

		// Simple animation along polyline points
		let index = 0;
		const animateBus = () => {
			if (index < coords.length - 1) {
				index++;
				busMarker.setLatLng(coords[index]);
				setTimeout(animateBus, 100);
			}
		};
		setTimeout(animateBus, 500);

		return { distance: distanceKm, time: timeStr };
	}

	function calculateDistance(lat1, lng1, lat2, lng2) {
		const R = 6371; // Earth's radius in km
		const dLat = (lat2 - lat1) * Math.PI / 180;
		const dLng = (lng2 - lng1) * Math.PI / 180;
		const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
			Math.sin(dLng / 2) * Math.sin(dLng / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}


	async function startRouteById(routeId) {
		const id = await resolveBusId();
		const uid = getUid();
		if (!id || !uid) return;
		currentRouteId = routeId;
		const session = { routeId, busId: id, uid, status: 'running', startedAt: Date.now() };
		await db.ref(`sessions/${id}/current`).set(session).catch(()=>{});
		await db.ref(`drivers/${id}/status`).set('on_route').catch(()=>{});
		const btnStart = document.querySelector('.start-route'); if (btnStart) btnStart.disabled = true;
		const btnPause = document.querySelector('.pause-route'); if (btnPause) btnPause.disabled = false;
		const btnEnd = document.querySelector('.end-route'); if (btnEnd) btnEnd.disabled = false;
	}

	async function pauseRoute() {
		const id = await resolveBusId(); if (!id) return;
		await db.ref(`sessions/${id}/current/status`).set('paused').catch(()=>{});
	}

	async function endRoute() {
		const id = await resolveBusId(); if (!id) return;
		const endAt = Date.now();
		const snap = await db.ref(`sessions/${id}/current`).once('value');
		const sess = snap.val();
		await db.ref(`sessions/${id}/history`).push({ ...(sess||{}), endedAt: endAt, status: 'ended' }).catch(()=>{});
		await db.ref(`sessions/${id}/current`).remove().catch(()=>{});
		await db.ref(`drivers/${id}/status`).set('idle').catch(()=>{});
		const btnStart = document.querySelector('.start-route'); if (btnStart) btnStart.disabled = false;
		const btnPause = document.querySelector('.pause-route'); if (btnPause) btnPause.disabled = true;
		const btnEnd = document.querySelector('.end-route'); if (btnEnd) btnEnd.disabled = true;
	}

	async function showRouteSelectionModal() {
		return new Promise(async (resolve) => {
			// Create modal overlay
			const overlay = document.createElement("div");
			overlay.id = "routeSelectionModal";
			overlay.style.cssText = `
				position: fixed;
				top: 0;
				left: 0;
				width: 100%;
				height: 100%;
				background: rgba(0, 0, 0, 0.7);
				z-index: 10000;
				display: flex;
				align-items: center;
				justify-content: center;
			`;

			// Create modal content
			const modal = document.createElement("div");
			modal.style.cssText = `
				background: white;
				border-radius: 12px;
				padding: 24px;
				max-width: 600px;
				width: 90%;
				max-height: 80vh;
				overflow-y: auto;
				box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
			`;

			modal.innerHTML = `
				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
					<h2 style="margin: 0; color: #1f2937;">Select Route</h2>
					<button id="closeRouteModal" style="
						background: none;
						border: none;
						font-size: 24px;
						cursor: pointer;
						color: #6b7280;
						padding: 0;
						width: 30px;
						height: 30px;
					">×</button>
				</div>
				<div id="routesList" style="margin-bottom: 20px;">
					<div style="text-align: center; padding: 40px; color: #6b7280;">
						Loading routes...
					</div>
				</div>
			`;

			overlay.appendChild(modal);
			document.body.appendChild(overlay);

			// Load routes from Firebase
			try {
				const snapshot = await db.ref('routes').once('value');
				const routes = snapshot.val() || {};
				const routesList = document.getElementById('routesList');
				
				if (Object.keys(routes).length === 0) {
					routesList.innerHTML = '<div style="text-align: center; padding: 40px; color: #6b7280;">No routes available</div>';
				} else {
					routesList.innerHTML = Object.entries(routes).map(([routeId, route]) => `
						<div style="
							padding: 15px;
							margin-bottom: 10px;
							border: 2px solid #e5e7eb;
							border-radius: 8px;
							cursor: pointer;
							transition: all 0.2s;
						" class="route-item" data-route-id="${routeId}">
							<h3 style="margin: 0 0 8px 0; color: #1f2937;">${escapeHtml(route.name || routeId)}</h3>
							<p style="margin: 0; color: #6b7280; font-size: 14px;">${escapeHtml(route.description || 'No description')}</p>
							<p style="margin: 4px 0 0 0; color: #9ca3af; font-size: 12px;">Stops: ${(route.points && route.points.length) || 0}</p>
						</div>
					`).join('');

					// Add click handlers
					routesList.querySelectorAll('.route-item').forEach(item => {
						item.addEventListener('click', () => {
							const routeId = item.getAttribute('data-route-id');
							const route = routes[routeId];
							resolve({
								routeId: routeId,
								routeName: route.name || routeId,
								routeDescription: route.description || '',
								routePoints: route.points || []
							});
							overlay.remove();
						});
					});
				}
			} catch (error) {
				console.error('Error loading routes:', error);
				const routesList = document.getElementById('routesList');
				if (routesList) {
					routesList.innerHTML = '<div style="text-align: center; padding: 40px; color: #ef4444;">Error loading routes</div>';
				}
			}

			// Close button
			const closeBtn = document.getElementById('closeRouteModal');
			if (closeBtn) {
				closeBtn.addEventListener('click', () => {
					resolve(null);
					overlay.remove();
				});
			}

			// Close on overlay click
			overlay.addEventListener('click', (e) => {
				if (e.target === overlay) {
					resolve(null);
					overlay.remove();
				}
			});
		});
	}

	function bindRouteButtons() {
		const btnStart = document.getElementById('startRouteBtn');
		const btnPause = document.getElementById('pauseRouteBtn');
		const btnEnd = document.getElementById('endRouteBtn');
		
		if (btnStart) {
			btnStart.addEventListener('click', async () => {
				// Show route selection modal
				const selectedRoute = await showRouteSelectionModal();
				if (!selectedRoute) {
					return; // User cancelled
				}

				// Start the trip
				const busId = await resolveBusId();
				if (!busId) {
					alert('Bus ID not found');
					return;
				}

				try {
					// Start trip using TripManager if available
					if (window.TripManager) {
						// Get driver ID from localStorage
						let driverId = null;
						try {
							driverId = localStorage.getItem("vtrack_driver_uid");
						} catch (e) {
							console.warn("Failed to get driver ID from localStorage:", e);
						}
						const tripId = await window.TripManager.startTrip(busId, selectedRoute.routeId, driverId);
						
						// Alert route selection in Firebase
						const now = Date.now();
						await db.ref(`alerts/${busId}/routeSelection`).set({
							routeId: selectedRoute.routeId,
							routeName: selectedRoute.routeName,
							routeDescription: selectedRoute.routeDescription,
							busId: busId,
							timestamp: now,
							status: "active"
						});

						await db.ref(`busDetails/${busId}`).update({
							currentRoute: selectedRoute.routeId,
							currentRouteName: selectedRoute.routeName,
							routeUpdatedAt: now
						});

						// Start location tracking
						if (window.SmartTracker) {
							window.SmartTracker.start(busId, {
								onLocationUpdate: (locationData) => {
									console.log("[Route] Location update:", locationData);
								},
								onError: (error) => {
									console.error("[Route] Tracking error:", error);
								}
							});
						}

						// Update UI
						if (btnStart) btnStart.disabled = true;
						if (btnPause) btnPause.disabled = false;
						if (btnEnd) btnEnd.disabled = false;

						// Redirect to driver.html and open focus mode
						window.location.href = 'driver.html?focus=true';
					} else {
						// Fallback to old method
						startRouteById(selectedRoute.routeId);
					}
				} catch (error) {
					console.error('Error starting trip:', error);
					alert('Failed to start trip: ' + error.message);
				}
			});
		}
		
		if (btnPause) btnPause.addEventListener('click', pauseRoute);
		if (btnEnd) btnEnd.addEventListener('click', endRoute);
	}

	function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

	document.addEventListener('DOMContentLoaded', showAssignedRoute);
	document.addEventListener('DOMContentLoaded', () => {
		bindRouteButtons();
		// Load all routes
		db.ref('routes').once('value', (snap) => {
			renderRoutesList(snap.val() || {});
		});
	});
})();
