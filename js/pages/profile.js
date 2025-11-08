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
		// IDs for later lookup
		let busId = d.assignedBusId || '';
		let routeId = d.assignedRouteId || '';
		// Bus name fetch
		if (busId) {
			db.ref('busDetails/' + busId).once('value', (busSnap) => {
				const bus = busSnap.val() || {};
				const name = (bus.busName ? (bus.busName + (bus.busNumber ? ' - ' + bus.busNumber : '')) : busId);
				updateInfoItem('Bus:', name);
			});
		} else {
			updateInfoItem('Bus:', '—');
		}
		// Route name fetch
		if (routeId) {
			db.ref('routes/' + routeId).once('value', (routeSnap) => {
				const route = routeSnap.val() || {};
				updateInfoItem('Route:', route.name || routeId);
			});
		} else {
			updateInfoItem('Route:', '—');
		}
		// Everything else
		updateInfoItem('ID:', d.id || uid);
		updateInfoItem('Contact:', d.phone || '—');
		updateInfoItem('Shift Time:', d.shift || '—');
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

// ========= SETTINGS LOGIC ========= //
document.addEventListener('DOMContentLoaded', function() {
  var changePwBtn = document.getElementById('changePwBtn');
  var toggleModeBtn = document.getElementById('toggleModeBtn');
  var logoutBtn = document.getElementById('logoutBtn');

  // CHG PW: redirect to login and show forgot password there
  if (changePwBtn) {
    changePwBtn.addEventListener('click', function(e) {
      e.preventDefault();
      window.location.href = 'driver-login.html#forgot';
    });
  }

  // LOGOUT FUNCTIONALITY
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function(e) {
      e.preventDefault();
      // Clear localStorage
      try {
        localStorage.removeItem('vtrack_driver_uid');
        localStorage.removeItem('v-track-driver-busId');
      } catch (err) {}
      // Firebase sign-out if possible
      try { if (window.firebase && window.firebase.auth) window.firebase.auth().signOut(); } catch(e){}
      // Redirect to login
      window.location.href = 'driver-login.html';
    });
  }

  // THEME TOGGLE (unchanged)
  var body = document.body;
  var THEME_KEY = 'vtrack_driver_theme';
  var darkMode = true;
  function applyTheme() {
    if (darkMode) {
      body.classList.add('dark-mode');
      body.classList.remove('light-mode');
      if (toggleModeBtn) toggleModeBtn.innerHTML = '🌙 Toggle Dark Mode';
    } else {
      body.classList.remove('dark-mode');
      body.classList.add('light-mode');
      if (toggleModeBtn) toggleModeBtn.innerHTML = '☀️ Toggle White Mode';
    }
  }
  function saveTheme() { try { localStorage.setItem(THEME_KEY, darkMode ? 'dark' : 'light'); } catch(e){} }
  function loadTheme() {
    var mode = '';
    try { mode = localStorage.getItem(THEME_KEY); } catch(e){}
    if (mode === 'light') darkMode = false;
    else darkMode = true;
    applyTheme();
  }
  if (toggleModeBtn) {
    toggleModeBtn.addEventListener('click', function() {
      darkMode = !darkMode;
      applyTheme();
      saveTheme();
    });
  }
  loadTheme();
});


