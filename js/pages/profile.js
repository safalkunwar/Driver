(function() {
	if (!window.VTApp) return;
	const db = VTApp.getDb();
	if (!db) return;
	let uid = null;
	try { uid = localStorage.getItem('vtrack_driver_uid'); } catch(e) {}
	if (!uid) { window.location.href = 'driver-login.html'; return; }

	// Load driver info by uid
	db.ref(`driverInfo/${uid}`).on('value', (snap) => {
		const d = snap.val() || {};
		// Name
		if (!setText('driverName', d.name || '—')) {
			const h2 = document.querySelector('.driver-info h2'); if (h2) h2.textContent = d.name || '—';
		}
		// Info list updates by label
		updateInfoItem('ID:', d.id || uid);
		updateInfoItem('Bus:', d.assignedBusId || '—');
		updateInfoItem('Contact:', d.phone || '—');
		updateInfoItem('Shift Time:', d.shift || '—');
		updateInfoItem('Route:', d.assignedRouteId || '—');
	});

	function updateInfoItem(labelPrefix, value) {
		const items = document.querySelectorAll('.info-list .info-item');
		items.forEach(it => {
			const span = it.querySelector('span');
			const strong = it.querySelector('strong');
			if (span && strong && (span.textContent || '').trim().startsWith(labelPrefix)) {
				strong.textContent = value || '—';
			}
		});
	}

	function setText(id, v){ const el=document.getElementById(id); if(el){ el.textContent=v; return true; } return false; }
	function fmt(ts){ try{return new Date(ts||Date.now()).toLocaleString();}catch(e){return ''} }
})();


