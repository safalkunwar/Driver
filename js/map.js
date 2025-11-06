// Leaflet map rendering for Driver Platform

// Fix default marker icon URLs when not serving Leaflet assets locally
if (typeof L !== 'undefined' && L.Icon && L.Icon.Default) {
	L.Icon.Default.mergeOptions({
		iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
		iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
		shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
	});
}

let VTMap = {
	map: null,
	busMarker: null,
	routePolyline: null,
	routePoints: [],
	otherBusMarkers: {},
};

function initDriverMap() {
	if (VTMap.map) return;
	VTMap.map = L.map('map').setView([28.2150, 83.9886], 13);
	L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '&copy; OpenStreetMap contributors'
	}).addTo(VTMap.map);
	VTMap.busMarker = L.marker([28.2150, 83.9886]).addTo(VTMap.map);
	VTMap.busMarker.bindPopup('Waiting for location...');
}

function updateDriverMarker(lat, lon, popupText) {
	if (!VTMap.map || !VTMap.busMarker) return;
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
	const latlng = [lat, lon];
	VTMap.busMarker.setLatLng(latlng);
	if (popupText) {
		const existing = VTMap.busMarker.getPopup && VTMap.busMarker.getPopup();
		if (existing) existing.setContent(popupText); else VTMap.busMarker.bindPopup(popupText);
	}
	VTMap.map.setView(latlng, VTMap.map.getZoom(), { animate: true });
}

function addRoutePoint(lat, lon, opts) {
	VTMap.routePoints.push([lat, lon]);
	if (VTMap.routePolyline) {
		VTMap.routePolyline.addLatLng([lat, lon]);
	} else if (VTMap.routePoints.length > 1) {
		VTMap.routePolyline = L.polyline(VTMap.routePoints, {
			color: (opts && opts.active) ? '#4CAF50' : '#2196F3',
			weight: 4,
			opacity: 0.7
		}).addTo(VTMap.map);
	}
}

function recenterOn(lat, lon, zoom) {
	if (!VTMap.map) return;
	VTMap.map.setView([lat, lon], zoom || VTMap.map.getZoom(), { animate: true });
}

window.VTMapAPI = {
	initDriverMap,
	updateDriverMarker,
	addRoutePoint,
	recenterOn,
	_state: VTMap,
};

// Multi-bus helpers
function _makeColoredIcon(color) {
	return L.divIcon({
		className: 'vt-bus-icon',
		html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,0.4);"></div>`,
		iconSize: [18, 18],
		iconAnchor: [9, 9],
	});
}

function upsertOtherBusMarker(busId, lat, lon, color, popup) {
	if (!VTMap.map) return;
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
	const key = String(busId);
	const existing = VTMap.otherBusMarkers[key];
	const latlng = [lat, lon];
	if (existing) {
		existing.marker.setLatLng(latlng);
		if (popup) {
			const p = existing.marker.getPopup && existing.marker.getPopup();
			if (p) p.setContent(popup); else existing.marker.bindPopup(popup);
		}
	} else {
		const icon = _makeColoredIcon(color);
		const marker = L.marker(latlng, { icon }).addTo(VTMap.map);
		if (popup) marker.bindPopup(popup);
		VTMap.otherBusMarkers[key] = { marker, color };
	}
}

function clearOtherBusMarkers() {
	Object.values(VTMap.otherBusMarkers).forEach(({ marker }) => {
		try { VTMap.map && VTMap.map.removeLayer(marker); } catch (e) {}
	});
	VTMap.otherBusMarkers = {};
}

window.VTMapAPI.upsertOtherBusMarker = upsertOtherBusMarker;
window.VTMapAPI.clearOtherBusMarkers = clearOtherBusMarkers;


