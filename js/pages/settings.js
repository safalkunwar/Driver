(function() {
	function bindToggle(id, key, def=false) {
		const el = document.getElementById(id);
		if (!el) return;
		try { el.checked = JSON.parse(localStorage.getItem(key) || String(def)); } catch(e) {}
		el.addEventListener('change', () => { try { localStorage.setItem(key, JSON.stringify(!!el.checked)); } catch(e) {} });
	}
	// Example optional toggles if your UI has matching inputs
	bindToggle('prefDarkMode', 'vtrack_pref_dark_mode', true);
	bindToggle('prefHaptics', 'vtrack_pref_haptics', true);
})();


