(function() {
	if (!window.VTApp) return;

	let mapReady = false;
	let isTracking = false;
	let watchId = null;
	let lastUpdateTime = 0;
	let lastPos = null;
	let lastHeartbeat = 0;
	let trackOthers = false;
	let unsubAllBuses = null;

	const UPDATE_INTERVAL_MS = 4000;
	const STANDBY_INTERVAL_MS = 15000;

	function ensureMap() {
		if (mapReady) return;
		// If there is no #map but we have a .map-placeholder, inject a map div
		let mapEl = document.getElementById('map');
		if (!mapEl) {
			const ph = document.querySelector('.map-placeholder') || document.querySelector('.map-area') || document.querySelector('.map-container');
			if (ph) {
				mapEl = document.createElement('div');
				mapEl.id = 'map';
				mapEl.style.width = '100%';
				mapEl.style.height = '50vh';
				ph.innerHTML = '';
				ph.appendChild(mapEl);
			}
		}
		if (mapEl && window.VTMapAPI && VTMapAPI.initDriverMap) {
			VTMapAPI.initDriverMap();
			mapReady = true;
		}
	}

	function qButtons() { return Array.from(document.querySelectorAll('button, a[role="button"], .btn')); }
	function byId(id) { return document.getElementById(id); }
	function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }
	function matchByText(substr) { return qButtons().find(b => (b.innerText || '').toLowerCase().includes(substr)); }

	function wireButtons() {
		on(byId('trackingBtn') || matchByText('start tracking') || matchByText('stop tracking'), 'click', toggleTracking);
		on(byId('recenterBtn') || matchByText('recenter'), 'click', focusOnMyBus);
		on(byId('trackOthersToggle') || matchByText('track other buses'), 'click', toggleTrackOthers);
		on(byId('focusMyBusBtn') || matchByText('focus on my bus'), 'click', focusOnMyBus);
		on(byId('viewNoticesBtn') || matchByText('view notices') || matchByText('alerts'), 'click', openNotices);
		on(byId('changeBusBtn') || matchByText('change bus'), 'click', () => window.location.href = 'driver.html');
		// Bottom nav shortcuts
		qButtons().forEach(btn => {
			const t = (btn.textContent || '').trim().toLowerCase();
			btn.addEventListener('click', () => {
				if (t === 'map') window.location.href = 'driver.html';
				if (t === 'route') window.location.href = 'driver-route.html';
				if (t === 'students') window.location.href = 'driver-students.html';
				if (t === 'alerts') window.location.href = 'driver-others.html';
				if (t === 'profile') window.location.href = 'driver-profile.html';
			});
		});
	}

	function toggleTracking() { isTracking ? stopTracking() : startTracking(); }
	function startTracking() {
		const busId = VTApp.getBusId();
		if (!busId) return alert('Select a bus first in the main page');
		if (!navigator.geolocation) return alert('Geolocation not supported');
		ensureMap();
		const opts = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
		watchId = navigator.geolocation.watchPosition(onPosition, onGeoError, opts);
		isTracking = true; setBtnState(); setStatus('Tracking');
	}
	function stopTracking() {
		if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
		isTracking = false; setBtnState(); setStatus('Stopped');
	}
	function setBtnState() {
		const btn = byId('trackingBtn') || matchByText('start tracking') || matchByText('stop tracking');
		if (!btn) return;
		if (isTracking) { btn.textContent = 'Stop Tracking'; btn.classList.add('active'); }
		else { btn.textContent = 'Start Tracking'; btn.classList.remove('active'); }
	}
	function setStatus(text) { const el = document.getElementById('statusValue'); if (el) el.textContent = text; }

	function onPosition(pos) {
		const now = Date.now();
		const effective = document.visibilityState === 'visible' ? UPDATE_INTERVAL_MS : STANDBY_INTERVAL_MS;
		if (now - lastUpdateTime < effective) return;

		const busId = VTApp.getBusId(); if (!busId) return;
		const c = pos.coords;
		const latitude = c.latitude, longitude = c.longitude;
		if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
		let heading = c.heading;
		if ((!heading || !Number.isFinite(heading)) && lastPos) heading = calcHeading(lastPos.latitude, lastPos.longitude, latitude, longitude);
		const kmh = c.speed ? Math.round(c.speed * 3.6) : 0;
		const point = { latitude, longitude, speed: kmh, heading: heading || 0, ts: c.timestamp || now };

		if (lastPos) {
			const d = haversine(lastPos, point);
			if (d < 5) {
				if (now - lastHeartbeat >= effective) { lastHeartbeat = now; VTApp.updateDriverCurrent(busId, { ts: now }).catch(()=>{}); }
				return;
			}
		}

		lastPos = { latitude, longitude, ts: point.ts };
		lastUpdateTime = now;

		if (window.VTMapAPI) {
			VTMapAPI.updateDriverMarker(latitude, longitude, 'Bus: ' + busId + '<br>Speed: ' + kmh + ' km/h');
			VTMapAPI.addRoutePoint(latitude, longitude, { active: true });
		}

		const key = now.toString();
		VTApp.writeBusLocation(busId, key, point).catch(()=>{});
		VTApp.updateDriverCurrent(busId, point).catch(()=>{});
	}
	function onGeoError(err) { console.warn('Geolocation error', err); setStatus('Offline ❌'); }

	function toggleTrackOthers(e) {
		trackOthers = !trackOthers;
		if (e && e.currentTarget) e.currentTarget.classList.toggle('active', trackOthers);
		if (trackOthers) startListeningOthers(); else stopListeningOthers();
	}
	function startListeningOthers() {
		if (!VTApp.listenAllBuses) return; stopListeningOthers();
		unsubAllBuses = VTApp.listenAllBuses((all) => {
			if (!all) return;
			Object.keys(all).forEach(busId => {
				const my = VTApp.getBusId(); if (!busId || busId === my) return;
				const latest = getLatest(all[busId]);
				if (!latest || !Number.isFinite(latest.latitude) || !Number.isFinite(latest.longitude)) return;
				const color = colorFromId(busId);
				const popup = 'Bus: ' + busId + '<br>Updated: ' + formatTime(latest.ts || Date.now());
				if (window.VTMapAPI) VTMapAPI.upsertOtherBusMarker(busId, latest.latitude, latest.longitude, color, popup);
			});
		});
	}
	function stopListeningOthers() { if (unsubAllBuses) { try { unsubAllBuses(); } catch(e) {} unsubAllBuses = null; } if (window.VTMapAPI && VTMapAPI.clearOtherBusMarkers) VTMapAPI.clearOtherBusMarkers(); }

	function openNotices() { const panel = document.getElementById('noticesPanel'); if (panel) { panel.style.transform = 'translateY(0)'; return; } window.location.href = 'driver-others.html'; }
	function focusOnMyBus() {
		const db = VTApp.getDb(); const busId = VTApp.getBusId(); if (!db || !busId) return;
		db.ref(`drivers/${busId}/currentLocation`).once('value', (snap) => {
			const v = snap.val(); if (!v || !Number.isFinite(v.latitude) || !Number.isFinite(v.longitude)) return;
			if (window.VTMapAPI) VTMapAPI.recenterOn(v.latitude, v.longitude);
		});
	}

	function haversine(a, b) { const R=6371000, dLat=(b.latitude-a.latitude)*Math.PI/180, dLon=(b.longitude-a.longitude)*Math.PI/180, la1=a.latitude*Math.PI/180, la2=b.latitude*Math.PI/180; const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2; return 2*R*Math.atan2(Math.sqrt(h),Math.sqrt(1-h)); }
	function calcHeading(lat1,lon1,lat2,lon2){ const dLon=(lon2-lon1)*Math.PI/180, la1=lat1*Math.PI/180, la2=lat2*Math.PI/180; const y=Math.sin(dLon)*Math.cos(la2); const x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLon); let br=Math.atan2(y,x)*180/Math.PI; return (Math.round((br+360)%360)); }
	function getLatest(obj){ if(!obj) return null; const keys=Object.keys(obj); if(!keys.length) return null; const k=keys.reduce((a,b)=>(+a>+b?a:b)); const v=obj[k]; if(!v) return null; return { latitude:v.latitude, longitude:v.longitude, ts:v.ts||v.timestamp||+k }; }
	function colorFromId(id){ let hash=0; for(let i=0;i<id.length;i++) hash=id.charCodeAt(i)+((hash<<5)-hash); const hue=Math.abs(hash)%360; return `hsl(${hue}, 75%, 50%)`; }
	function formatTime(ts){ try{return new Date(ts).toLocaleTimeString();}catch(e){return ''} }

	document.addEventListener('DOMContentLoaded', function(){ ensureMap(); wireButtons(); });
})();










