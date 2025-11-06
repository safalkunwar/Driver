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

	function ensureMap() {
		if (window.VTMapAPI && VTMapAPI.initDriverMap) VTMapAPI.initDriverMap();
		return (window.VTMapAPI && VTMapAPI._state) ? VTMapAPI._state.map : null;
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
    if (!map) return;

    // Fetch route from Firebase
    const snap = await db.ref(`routes/${routeId}`).once('value');
    const route = snap.val() || {};
    if (!route.points || !route.points.length) return;

    // Convert points to LatLng
    const pointsArray = route.points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));

    // Clear existing overlays
    map.eachLayer(layer => {
        if (!(layer instanceof L.TileLayer)) map.removeLayer(layer);
    });

    // Create waypoints for routing
    const waypoints = pointsArray.map(p => L.latLng(p.lat, p.lng));

    // Use Leaflet Routing Machine for optimized routing
    const routingControl = L.Routing.control({
        waypoints,
        routeWhileDragging: false,
        addWaypoints: false,
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
            }).bindPopup(`<b>${pointsArray[i].name || `Point ${i + 1}`}</b>`);
        }
    })
    .on('routesfound', (e) => {
        const coords = e.routes[0].coordinates.map(c => [c.lat, c.lng]);
        const routeLine = L.polyline(coords, { color: '#1a73e8', weight: 5, opacity: 0.9 }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });

        // Animate bus marker along the route (optional enhancement)
        let index = 0;
        const busMarker = L.marker(coords[0], { 
            icon: L.divIcon({ 
                className: 'bus-marker', 
                html: '🚌', 
                iconSize: [28, 28], 
                iconAnchor: [14, 14] 
            }) 
        }).addTo(map);

        const animateBus = () => {
            if (index < coords.length - 1) {
                busMarker.setLatLng(coords[index]);
                index++;
                requestAnimationFrame(animateBus);
            }
        };
        animateBus();
    })
    .on('routingerror', () => {
        console.warn('Routing service failed — fallback to raw points');
        const fallbackCoords = waypoints.map(w => [w.lat, w.lng]);
        const poly = L.polyline(fallbackCoords, { color: '#1a73e8', weight: 5, opacity: 0.8 }).addTo(map);
        map.fitBounds(poly.getBounds(), { padding: [20, 20] });
    })
    .addTo(map);

    // Show popup with route info
    const popupContent = `
        <div style="min-width: 260px;">
            <h3>🚌 ${route.name || 'Route Details'}</h3>
            <p><strong>Description:</strong> ${route.description || 'No description available'}</p>
            <p><strong>Total Stops:</strong> ${pointsArray.length}</p>
        </div>`;
    L.popup()
        .setLatLng(map.getCenter())
        .setContent(popupContent)
        .openOn(map);

    currentRouteId = routeId;
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

	function bindRouteButtons() {
		const btnStart = document.querySelector('.start-route');
		const btnPause = document.querySelector('.pause-route');
		const btnEnd = document.querySelector('.end-route');
		if (btnStart) btnStart.addEventListener('click', () => { if (currentRouteId) startRouteById(currentRouteId); });
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


