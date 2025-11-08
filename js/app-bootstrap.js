(function() {
	function getBusId() { try { return localStorage.getItem('v-track-driver-busId'); } catch(e) { return null; } }
	function setStatus(text) { const el = document.getElementById('statusValue'); if (el) el.textContent = text; }

	if (!window.VTFirebase || !window.VTFirebase.getDb) {
		console.error('VTFirebase not loaded. Include js/firebase.js first.');
		return;
	}

	window.VTApp = {
		getBusId,
		getDb: VTFirebase.getDb,
		listenAlerts: VTFirebase.listenAlerts,
		markAlertRead: VTFirebase.markAlertRead,
		listenAllBuses: VTFirebase.listenAllBuses,
		writeBusLocation: VTFirebase.writeBusLocation,
		updateDriverCurrent: VTFirebase.updateDriverCurrent
	};

	VTFirebase.onConnectionChanged((connected) => setStatus(connected ? 'Connected ✅' : 'Offline ❌'));
})();





