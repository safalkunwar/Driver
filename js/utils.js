// Utility helpers for Driver Platform

function haversineDistanceMeters(a, b) {
	const R = 6371000;
	const dLat = (b.latitude - a.latitude) * Math.PI / 180;
	const dLon = (b.longitude - a.longitude) * Math.PI / 180;
	const lat1 = a.latitude * Math.PI / 180;
	const lat2 = b.latitude * Math.PI / 180;
	const sinDLat = Math.sin(dLat / 2);
	const sinDLon = Math.sin(dLon / 2);
	const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
	const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
	return R * c;
}

function formatTime(ts) {
	try { return new Date(ts).toLocaleTimeString(); } catch (e) { return '' }
}

function throttle(fn, intervalMs) {
	let last = 0;
	let pending;
	return function() {
		const now = Date.now();
		if (now - last >= intervalMs) {
			last = now;
			fn.apply(this, arguments);
		} else {
			clearTimeout(pending);
			pending = setTimeout(() => {
				last = Date.now();
				fn.apply(this, arguments);
			}, intervalMs - (now - last));
		}
	};
}

function calculateHeadingDeg(lat1, lon1, lat2, lon2) {
	const dLon = (lon2 - lon1) * Math.PI / 180;
	const lat1Rad = lat1 * Math.PI / 180;
	const lat2Rad = lat2 * Math.PI / 180;
	const y = Math.sin(dLon) * Math.cos(lat2Rad);
	const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
	let brng = Math.atan2(y, x) * 180 / Math.PI;
	brng = (brng + 360) % 360;
	return Math.round(brng);
}

// Smart standby: detect page visibility
function isAppVisible() {
	return document.visibilityState === 'visible';
}

window.VTUtils = {
	haversineDistanceMeters,
	formatTime,
	throttle,
	calculateHeadingDeg,
	isAppVisible,
};

// Color assignment utility for bus markers
function colorFromId(id) {
	let hash = 0;
	for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
	const hue = Math.abs(hash) % 360;
	return `hsl(${hue}, 75%, 50%)`;
}

function getLatestFromLocations(locationsObj) {
	if (!locationsObj) return null;
	const keys = Object.keys(locationsObj);
	if (keys.length === 0) return null;
	const latestKey = keys.reduce((a, b) => (+a > +b ? a : b));
	return { key: latestKey, value: locationsObj[latestKey] };
}

window.VTUtils.colorFromId = colorFromId;
window.VTUtils.getLatestFromLocations = getLatestFromLocations;

// general validators
function isFiniteNumber(n) { return typeof n === 'number' && Number.isFinite(n); }
window.VTUtils.isFiniteNumber = isFiniteNumber;


