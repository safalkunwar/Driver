(function() {
	if (!window.VTApp) return;
	const busId = VTApp.getBusId();
	if (!busId) return;

	VTApp.listenAlerts(busId, (id, alert) => {
		if (!alert || !alert.message) return;
		const list = document.getElementById('noticesList'); if (!list) return;
		const row = document.createElement('div');
		row.style.cssText = 'padding:10px 8px;border-bottom:1px solid rgba(0,0,0,0.08);display:flex;justify-content:space-between;gap:8px;align-items:center;';
		row.innerHTML =
			'<div>'
				+ '<div style="font-weight:600;">' + esc((alert.level||'info').toUpperCase()) + '</div>'
				+ '<div>' + esc(alert.message) + '</div>'
				+ '<div style="opacity:0.6;font-size:12px;margin-top:4px;">' + fmt(alert.timestamp) + '</div>'
			+ '</div>'
			+ (alert.read ? '<span style="opacity:0.5;font-size:12px;">Read</span>' : '<span style="color:#4CAF50;font-size:12px;">New</span>');
		list.prepend(row);
		if (!alert.read) VTApp.markAlertRead(busId, id).catch(() => {});
	});

	function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
	function fmt(ts){try{return new Date(ts||Date.now()).toLocaleTimeString();}catch(e){return ''}}
})();










