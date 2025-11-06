// Firebase helper module for Driver Platform
// Initializes Firebase app once and exposes database helpers

// Ensure firebase SDK v8 scripts are loaded in HTML before this file
let db = null;

function initFirebaseApp() {
	if (db) return db;
	const firebaseConfig = {
		apiKey: "AIzaSyBZpFhPq1pFpvTmyndOnA6SRs9_ftb4jfI",
		authDomain: "v-track-gu999.firebaseapp.com",
		databaseURL: "https://v-track-gu999-default-rtdb.firebaseio.com",
		projectId: "v-track-gu999",
		storageBucket: "v-track-gu999.appspot.com",
		messagingSenderId: "1046512747961",
		appId: "1:1046512747961:web:80df40c48bca3159296268",
		measurementId: "G-38X29VT1YT"
	};

	if (typeof firebase === 'undefined') {
		console.error('Firebase SDK not loaded');
		return null;
	}

	if (!firebase.apps || firebase.apps.length === 0) {
		firebase.initializeApp(firebaseConfig);
	}

	db = firebase.database();
	return db;
}

function getDb() {
	return db || initFirebaseApp();
}

function writeBusLocation(busId, timestampKey, payload) {
	const database = getDb();
	if (!database) return Promise.reject(new Error('DB unavailable'));
	return database.ref(`BusLocation/${busId}/${timestampKey}`).set(payload);
}

function updateDriverCurrent(busId, payload) {
	const database = getDb();
	if (!database) return Promise.reject(new Error('DB unavailable'));
	return database.ref(`drivers/${busId}/currentLocation`).set(payload);
}

function onConnectionChanged(callback) {
	const database = getDb();
	if (!database) return () => {};
	const ref = database.ref('.info/connected');
	const handler = ref.on('value', (snap) => {
		callback(!!snap.val());
	});
	return () => ref.off('value', handler);
}

// Expose to global scope for non-module usage
window.VTFirebase = {
	getDb,
	writeBusLocation,
	updateDriverCurrent,
	onConnectionChanged,
};

// Multi-bus listeners
let _busRef = null;
function listenAllBuses(callback) {
	const database = getDb();
	if (!database) return () => {};
	_busRef = database.ref('BusLocation');
	const handler = _busRef.on('value', (snap) => {
		callback(snap.val() || {});
	});
	return () => { if (_busRef) _busRef.off('value', handler); };
}

window.VTFirebase.listenAllBuses = listenAllBuses;

// Alerts helpers
let _alertsRef = null;
function listenAlerts(busId, onAdd) {
	const database = getDb();
	if (!database || !busId) return () => {};
	_alertsRef = database.ref(`Alerts/${busId}`);
	const handler = _alertsRef.on('child_added', (snap) => {
		const alertId = snap.key;
		const val = snap.val();
		onAdd && onAdd(alertId, val);
	});
	return () => { if (_alertsRef) _alertsRef.off('child_added', handler); };
}

function markAlertRead(busId, alertId) {
	const database = getDb();
	if (!database || !busId || !alertId) return Promise.resolve();
	const readAt = Date.now();
	return database.ref(`Alerts/${busId}/${alertId}/read`).set(readAt).catch(() => {});
}

window.VTFirebase.listenAlerts = listenAlerts;
window.VTFirebase.markAlertRead = markAlertRead;

// Route history (mirror of user panel behavior)
function getRouteHistory(busId, callback) {
	const database = getDb();
	if (!database || !busId) { callback([]); return; }
	try {
		const today = new Date().toISOString().split('T')[0];
		database.ref(`RouteHistory/${busId}/${today}`).once('value', (snapshot) => {
			const routeData = snapshot.val();
			if (routeData) {
				const routePoints = Object.values(routeData).sort((a, b) => (a.timestamp || a.ts || 0) - (b.timestamp || b.ts || 0));
				callback(routePoints);
			} else {
				callback([]);
			}
		});
	} catch (e) {
		callback([]);
	}
}

function listenToRouteHistory(busId, onAdd) {
	const database = getDb();
	if (!database || !busId) return () => {};
	const today = new Date().toISOString().split('T')[0];
	const ref = database.ref(`RouteHistory/${busId}/${today}`);
	const handler = ref.on('child_added', (snapshot) => {
		const v = snapshot.val();
		if (v) onAdd(v);
	});
	return () => ref.off('child_added', handler);
}

window.VTFirebase.getRouteHistory = getRouteHistory;
window.VTFirebase.listenToRouteHistory = listenToRouteHistory;


