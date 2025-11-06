/**
 * V-Track Driver Platform - Vanilla JavaScript Implementation
 * Works without npm or build tools
 */

// Prefer centralized Firebase helper if available; fallback to local init
let database;
function initFirebase() {
    if (window.VTFirebase && window.VTFirebase.getDb) {
        database = window.VTFirebase.getDb();
        return !!database;
    }
    if (typeof firebase === 'undefined') {
        console.error('Firebase SDK not loaded!');
        return false;
    }
    try {
        if (!firebase.apps || firebase.apps.length === 0) {
            // Safeguard: use the same config as other panels if present globally
            firebase.initializeApp(firebaseConfig);
        }
        database = firebase.database();
        return true;
    } catch (error) {
        console.error('Firebase initialization error:', error);
        return false;
    }
}

// Initialize when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        if (initFirebase()) {
            startApp();
        }
    });
} else {
    // DOM already loaded
    if (initFirebase()) {
        startApp();
    }
}

// App State (declared before functions)
let currentBusId = null;
let isTracking = false;
let watchId = null;
let lastPosition = null;
let lastUpdateTime = 0;
let map = null;
let busMarker = null;
let routePolyline = null;
let routePoints = [];
let filteredRoutePoints = [];
let showFiltered = true;
let focusMode = false;
let studentAlerts = [];
let previousLocation = null;
let lastTenCoordinates = [];

const UPDATE_INTERVAL_MS = 4000; // 4 seconds base
const STANDBY_INTERVAL_MS = 15000; // reduced frequency when app hidden
const MIN_MOVE_METERS = 5; // movement threshold
let lastHeartbeatTime = 0;
let geoRetryBackoffMs = 0;
let disconnectUnsub = null;
let trackOthers = false;
let unsubscribeAllBuses = null;
let unsubscribeAlerts = null;
let notices = [];

// Storage Utilities
function getStoredBusId() {
    try {
        return localStorage.getItem('v-track-driver-busId');
    } catch (e) {
        return null;
    }
}

function saveBusId(busId) {
    try {
        localStorage.setItem('v-track-driver-busId', busId);
    } catch (e) {
        console.warn('Failed to save bus ID');
    }
}

// Initialize app
function startApp() {
    const storedBusId = getStoredBusId();
    if (storedBusId) {
        selectBus(storedBusId, false);
    } else {
        showBusSelector();
    }
    // connection observer
    if (window.VTFirebase && window.VTFirebase.onConnectionChanged) {
        if (disconnectUnsub) disconnectUnsub();
        disconnectUnsub = window.VTFirebase.onConnectionChanged((connected) => {
            const el = document.getElementById('statusValue');
            if (el) el.textContent = connected ? (isTracking ? 'Connected ✅' : 'Connected ✅ (idle)') : 'Offline ❌';
        });
    }
}

// Bus Selection
function selectBus(busId, showSelector = true) {
    currentBusId = busId;
    saveBusId(busId);
    
    document.getElementById('connectedBusId').textContent = busId;
    document.getElementById('connectionIndicator').style.display = 'block';
    document.getElementById('busSelector').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    document.getElementById('busSelectDropdown').value = busId;
    
    if (!showSelector) {
        // Initialize map
        if (window.VTMapAPI && window.VTMapAPI.initDriverMap) {
            window.VTMapAPI.initDriverMap();
            map = window.VTMapAPI._state.map;
            busMarker = window.VTMapAPI._state.busMarker;
        } else {
            initMap();
        }
        loadRouteHistory();
        // Start alerts listener for this bus
        startAlertsListener();
    }
}

function selectCustomBus() {
    const customBus = document.getElementById('customBusInput').value.trim().toLowerCase();
    if (customBus) {
        selectBus(customBus);
        document.getElementById('customBusInput').value = '';
    }
}

function showBusSelector() {
    document.getElementById('busSelector').style.display = 'flex';
}

function switchBus(newBusId) {
    if (isTracking) {
        stopTracking();
    }
    selectBus(newBusId, false);
    // Reset notices for new bus
    notices = [];
    renderNotices();
}

// Map Initialization
function initMap() {
    if (map) return;
    
    map = L.map('map').setView([28.2150, 83.9886], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    
    // Create marker
    busMarker = L.marker([28.2150, 83.9886]).addTo(map);
    busMarker.bindPopup('Waiting for location...');
}

// GPS Filtering
function filterGpsPoint(newPoint, lastPoint) {
    if (!lastPoint) return newPoint;
    
    // Calculate distance in meters (rough approximation)
    const latDiff = (newPoint.latitude - lastPoint.latitude) * 111000;
    const lonDiff = (newPoint.longitude - lastPoint.longitude) * 111000 * Math.cos(lastPoint.latitude * Math.PI / 180);
    const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
    
    // Calculate time difference
    const timeDiff = (newPoint.ts - lastPoint.ts) / 1000; // seconds
    
    // Filter unrealistic jumps (>60 m/s or >1000m)
    if (timeDiff > 0) {
        const speed = distance / timeDiff;
        if (speed > 60 || distance > 1000) {
            console.log('Filtered GPS point: speed=' + speed.toFixed(2) + ' m/s');
            return null;
        }
    }
    
    // Filter duplicates (<5m)
    if (distance < 5) {
        return null;
    }
    
    return newPoint;
}

// Location Tracking
function startTracking() {
    if (!currentBusId) {
        alert('Please select a bus ID first');
        return;
    }
    
    if (!navigator.geolocation) {
        alert('Geolocation is not supported');
        return;
    }
    
    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    };
    
    watchId = navigator.geolocation.watchPosition(
        handlePositionUpdate,
        handleLocationError,
        options
    );
    
    isTracking = true;
    updateTrackingButton();
    document.getElementById('statusValue').textContent = 'Tracking';
}

function stopTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    isTracking = false;
    updateTrackingButton();
    document.getElementById('statusValue').textContent = 'Stopped';
}

function toggleTracking() {
    if (isTracking) {
        stopTracking();
    } else {
        startTracking();
    }
}

// Multi-bus tracking
function toggleTrackOthers() {
    trackOthers = !trackOthers;
    const btn = document.getElementById('trackOthersToggle');
    btn.classList.toggle('active', trackOthers);
    if (trackOthers) {
        startListeningOtherBuses();
    } else {
        stopListeningOtherBuses();
    }
}

function startListeningOtherBuses() {
    if (!window.VTFirebase || !window.VTFirebase.listenAllBuses) return;
    if (unsubscribeAllBuses) unsubscribeAllBuses();
    unsubscribeAllBuses = window.VTFirebase.listenAllBuses((busData) => {
        if (!busData) return;
        Object.keys(busData).forEach((busId) => {
            if (!busId || busId === currentBusId) return; // skip my bus
            const latest = window.VTUtils.getLatestFromLocations(busData[busId]);
            if (!latest || !latest.value) return;
            const { latitude, longitude, ts } = latest.value;
            if (!window.VTUtils.isFiniteNumber(latitude) || !window.VTUtils.isFiniteNumber(longitude)) return;
            const color = window.VTUtils.colorFromId(busId);
            const popup = `Bus: ${busId}<br/>Updated: ${window.VTUtils.formatTime(ts || +latest.key)}`;
            if (window.VTMapAPI && window.VTMapAPI.upsertOtherBusMarker) {
                window.VTMapAPI.upsertOtherBusMarker(busId, latitude, longitude, color, popup);
            }
        });
    });
}

function stopListeningOtherBuses() {
    if (unsubscribeAllBuses) {
        try { unsubscribeAllBuses(); } catch (e) {}
        unsubscribeAllBuses = null;
    }
    if (window.VTMapAPI && window.VTMapAPI.clearOtherBusMarkers) {
        window.VTMapAPI.clearOtherBusMarkers();
    }
}

function focusOnMyBus() {
    if (!lastPosition) return;
    if (window.VTMapAPI && window.VTMapAPI.recenterOn) {
        window.VTMapAPI.recenterOn(lastPosition.latitude, lastPosition.longitude);
    } else if (map) {
        map.setView([lastPosition.latitude, lastPosition.longitude], map.getZoom(), { animate: true });
    }
}

// Notices
function startAlertsListener() {
    if (!window.VTFirebase || !window.VTFirebase.listenAlerts) return;
    if (unsubscribeAlerts) unsubscribeAlerts();
    if (!currentBusId) return;
    unsubscribeAlerts = window.VTFirebase.listenAlerts(currentBusId, (alertId, alert) => {
        // validate
        if (!alert || !alert.message) return;
        const item = {
            id: alertId,
            message: alert.message,
            ts: alert.timestamp || Date.now(),
            level: alert.level || 'info',
            read: !!alert.read
        };
        notices.unshift(item);
        // limit cache
        notices = notices.slice(0, 20);
        renderNotices(true);
        if (!item.read) playNoticeChime();
    });
}

function toggleNoticesPanel() {
    const panel = document.getElementById('noticesPanel');
    if (!panel) return;
    const isHidden = panel.style.transform === '' || panel.style.transform.includes('100%');
    if (isHidden) {
        panel.style.transform = 'translateY(0)';
        markAllNoticesRead();
    } else {
        panel.style.transform = 'translateY(100%)';
    }
}

function renderNotices(pulse) {
    const list = document.getElementById('noticesList');
    if (!list) return;
    list.innerHTML = notices.map(n => (
        '<div style="padding:10px 8px; border-bottom:1px solid rgba(255,255,255,0.08); display:flex; justify-content:space-between; gap:8px; align-items:center;">'
        + '<div>'
        + '<div style="font-weight:600;">' + escapeHtml(n.level.toUpperCase()) + '</div>'
        + '<div style="opacity:0.9;">' + escapeHtml(n.message) + '</div>'
        + '<div style="opacity:0.6;font-size:12px;margin-top:4px;">' + (window.VTUtils.formatTime(n.ts) || '') + '</div>'
        + '</div>'
        + (n.read ? '<span style="opacity:0.5;font-size:12px;">Read</span>' : '<span style="color:#4CAF50;font-size:12px;">New</span>')
        + '</div>'
    )).join('');
    if (pulse) pulseConnectionIndicator();
}

function pulseConnectionIndicator() {
    const bar = document.getElementById('connectionIndicator');
    if (!bar) return;
    bar.style.boxShadow = '0 0 0 0 rgba(76,175,80,0.7)';
    bar.style.transition = 'box-shadow 0.4s ease';
    requestAnimationFrame(() => {
        bar.style.boxShadow = '0 0 20px 6px rgba(76,175,80,0.5)';
        setTimeout(() => { bar.style.boxShadow = ''; }, 600);
    });
}

function playNoticeChime() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 880;
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
        o.start();
        setTimeout(() => {
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
            setTimeout(() => { o.stop(); ctx.close(); }, 160);
        }, 100);
    } catch (e) {}
}

function markAllNoticesRead() {
    if (!window.VTFirebase || !currentBusId) return;
    notices = notices.map(n => {
        if (!n.read) window.VTFirebase.markAlertRead(currentBusId, n.id).catch(() => {});
        return { ...n, read: true };
    });
    renderNotices();
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"]+/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

function updateTrackingButton() {
    const btn = document.getElementById('trackingBtn');
    if (isTracking) {
        btn.textContent = 'Stop Tracking';
        btn.className = 'btn-stop-tracking';
    } else {
        btn.textContent = 'Start Tracking';
        btn.className = 'btn-start-tracking';
    }
}

function handlePositionUpdate(position) {
    const now = Date.now();
    const effectiveInterval = (window.VTUtils && !window.VTUtils.isAppVisible()) ? STANDBY_INTERVAL_MS : UPDATE_INTERVAL_MS;
    const timeSinceLastUpdate = now - lastUpdateTime;
    if (timeSinceLastUpdate < effectiveInterval) {
        return; // Throttle updates
    }
    
    const { latitude, longitude, speed, heading, timestamp } = position.coords;
    
    // Calculate heading if not provided
    let calculatedHeading = heading;
    if (!heading && lastPosition) {
        calculatedHeading = calculateHeading(
            lastPosition.latitude,
            lastPosition.longitude,
            latitude,
            longitude
        );
    }
    
    const locationData = {
        latitude,
        longitude,
        speed: speed ? Math.round(speed * 3.6) : 0,
        heading: calculatedHeading || 0,
        ts: timestamp || now
    };
    
    // Intelligent move filter: allow <5m as heartbeat (timestamp-only) occasionally
    let filteredPoint = filterGpsPoint(locationData, lastPosition);
    const isDuplicateMove = !filteredPoint;
    const timeSinceHeartbeat = now - lastHeartbeatTime;
    if (isDuplicateMove) {
        // Only update timestamp to drivers/currentLocation as heartbeat
        if (timeSinceHeartbeat >= effectiveInterval) {
            lastHeartbeatTime = now;
            if (window.VTFirebase) {
                window.VTFirebase.updateDriverCurrent(currentBusId, { ts: now });
            } else if (database) {
                database.ref(`drivers/${currentBusId}/currentLocation`).set({ ts: now }).catch(() => {});
            }
        }
        return;
    }
    
    // Update UI
    previousLocation = lastPosition;
    lastPosition = { latitude, longitude, ts: filteredPoint.ts };
    lastUpdateTime = now;
    
    const speedEl = document.getElementById('speedValue');
    const headEl = document.getElementById('headingValue');
    const focusSpeedEl = document.getElementById('focusSpeedValue');
    const newSpeed = filteredPoint.speed + ' km/h';
    const newHead = filteredPoint.heading + '°';
    if (speedEl && speedEl.textContent !== newSpeed) speedEl.textContent = newSpeed;
    if (headEl && headEl.textContent !== newHead) headEl.textContent = newHead;
    if (focusSpeedEl && ('' + focusSpeedEl.textContent) !== ('' + filteredPoint.speed)) focusSpeedEl.textContent = filteredPoint.speed;
    
    // Update map
    if (window.VTMapAPI) {
        window.VTMapAPI.updateDriverMarker(filteredPoint.latitude, filteredPoint.longitude, 'Bus: ' + currentBusId + '<br>Speed: ' + filteredPoint.speed + ' km/h');
        window.VTMapAPI.addRoutePoint(filteredPoint.latitude, filteredPoint.longitude, { active: isTracking });
    } else if (map) {
        const latlng = [filteredPoint.latitude, filteredPoint.longitude];
        // Avoid re-centering on trivial adjustments to reduce work
        if (busMarker) {
            busMarker.setLatLng(latlng);
            const p = busMarker.getPopup && busMarker.getPopup();
            const popupTxt = 'Bus: ' + currentBusId + '<br>Speed: ' + filteredPoint.speed + ' km/h';
            if (p) p.setContent(popupTxt); else busMarker.bindPopup(popupTxt);
        }
        // Defer map pan to next frame
        requestAnimationFrame(() => map.setView(latlng, map.getZoom(), { animate: true }));
        routePoints.push(latlng);
        filteredRoutePoints.push(latlng);
        updateRoutePolyline();
    }
    
    // Write to Firebase
    const timestampKey = now.toString();
    if (window.VTFirebase) {
        window.VTFirebase.writeBusLocation(currentBusId, timestampKey, filteredPoint)
            .catch((error) => console.error('Firebase write error:', error));
        window.VTFirebase.updateDriverCurrent(currentBusId, filteredPoint).catch(() => {});
    } else {
        writeToFirebase(timestampKey, filteredPoint);
        // mirror to drivers/currentLocation for compatibility with other panels
        database.ref(`drivers/${currentBusId}/currentLocation`).set(filteredPoint).catch(() => {});
    }
    
    // Check student proximity (mock)
    checkStudentProximity(filteredPoint, previousLocation);

    // Cache last 10 coordinates in memory (for quick resume/UI use)
    lastTenCoordinates.push({ lat: filteredPoint.latitude, lon: filteredPoint.longitude, ts: filteredPoint.ts });
    if (lastTenCoordinates.length > 10) lastTenCoordinates.shift();
}

function handleLocationError(error) {
    console.error('Location error:', error);
    const statusEl = document.getElementById('statusValue');
    if (statusEl) statusEl.textContent = 'Offline ❌';
    // Simple retry with incremental backoff
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    geoRetryBackoffMs = Math.min(30000, (geoRetryBackoffMs || 5000) * 2);
    setTimeout(() => {
        if (!isTracking) return;
        startTracking();
    }, geoRetryBackoffMs);
}

function calculateHeading(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    
    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
              Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
    
    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    bearing = (bearing + 360) % 360;
    
    return Math.round(bearing);
}

// Firebase Operations
function writeToFirebase(timestampKey, locationData) {
    if (!currentBusId) return;
    
    database.ref(`BusLocation/${currentBusId}/${timestampKey}`).set(locationData)
        .then(() => {
            console.log('Location written to Firebase');
        })
        .catch((error) => {
            console.error('Firebase write error:', error);
        });
}

function loadRouteHistory() {
    if (!currentBusId) return;
    
    database.ref(`BusLocation/${currentBusId}`)
        .limitToLast(500)
        .once('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                const points = Object.keys(data)
                    .map(timestamp => ({
                        timestamp: parseInt(timestamp),
                        ...data[timestamp]
                    }))
                    .sort((a, b) => a.timestamp - b.timestamp);
                
                const validPoints = points.filter(p => window.VTUtils.isFiniteNumber(p.latitude) && window.VTUtils.isFiniteNumber(p.longitude));
                routePoints = validPoints.map(p => [p.latitude, p.longitude]);
                filteredRoutePoints = routePoints; // Already filtered to valid
                updateRoutePolyline();
                
                // Center map on last point
                if (validPoints.length > 0) {
                    const last = validPoints[validPoints.length - 1];
                    map.setView([last.latitude, last.longitude], 13);
                }
            }
        });
}

function updateRoutePolyline() {
    if (!map) return;
    
    if (routePolyline) {
        map.removeLayer(routePolyline);
    }
    
    const raw = showFiltered ? filteredRoutePoints : routePoints;
    const points = raw.filter(arr => Array.isArray(arr) && arr.length === 2 && Number.isFinite(arr[0]) && Number.isFinite(arr[1]));
    if (points.length > 1) {
        routePolyline = L.polyline(points, {
            color: isTracking ? '#4CAF50' : '#1a73e8',
            weight: 4,
            opacity: 0.8,
            dashArray: isTracking ? null : '5, 5'
        }).addTo(map);
    }
}

function toggleFilter() {
    showFiltered = !showFiltered;
    document.getElementById('filterToggle').textContent = showFiltered ? 'Filtered' : 'Raw';
    document.getElementById('filterToggle').classList.toggle('active', showFiltered);
    updateRoutePolyline();
}

// Focus Mode
function toggleFocusMode() {
    focusMode = !focusMode;
    const focusEl = document.getElementById('focusMode');
    const toggleBtn = document.getElementById('focusModeToggle');
    
    if (focusMode) {
        focusEl.classList.add('active');
        toggleBtn.textContent = 'Exit Focus';
        toggleBtn.classList.add('active');
        document.getElementById('focusBusId').textContent = currentBusId || 'Active';
    } else {
        focusEl.classList.remove('active');
        toggleBtn.textContent = 'Driving Focus';
        toggleBtn.classList.remove('active');
    }
}

function markStop() {
    if (lastPosition) {
        alert('Stop marked at: ' + lastPosition.latitude + ', ' + lastPosition.longitude);
        // TODO: Save to Firebase
    }
}

function requestPause() {
    alert('Pause request sent');
    // TODO: Send to Firebase
}

// Student Proximity
function checkStudentProximity(currentPos, previousPos) {
    // Mock student detection - replace with Firebase listener
    const mockStudent = {
        id: 'student1',
        latitude: currentPos.latitude + 0.0001,
        longitude: currentPos.longitude + 0.0001
    };
    
    // Calculate distance
    const latDiff = (mockStudent.latitude - currentPos.latitude) * 111000;
    const lonDiff = (mockStudent.longitude - currentPos.longitude) * 111000 * Math.cos(currentPos.latitude * Math.PI / 180);
    const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
    
    if (distance < 50 && distance > 5) {
        // Check if in front (simple check)
        let heading = currentPos.heading || 0;
        if (!heading && previousPos) {
            heading = calculateHeading(previousPos.latitude, previousPos.longitude, currentPos.latitude, currentPos.longitude);
        }
        
        const bearing = calculateHeading(currentPos.latitude, currentPos.longitude, mockStudent.latitude, mockStudent.longitude);
        const angleDiff = Math.abs(heading - bearing);
        const minAngle = Math.min(angleDiff, 360 - angleDiff);
        
        if (minAngle <= 60) {
            // Student is in front
            studentAlerts.unshift({
                studentId: mockStudent.id,
                distance: Math.round(distance)
            });
            studentAlerts = studentAlerts.slice(0, 5);
            updateStudentAlerts();
            
            // Voice alert in focus mode
            if (focusMode && 'speechSynthesis' in window) {
                const utterance = new SpeechSynthesisUtterance(`Student nearby, ${Math.round(distance)} meters ahead`);
                window.speechSynthesis.speak(utterance);
            }
        }
    }
}

function updateStudentAlerts() {
    const banner = document.getElementById('studentAlerts');
    const list = document.getElementById('alertsList');
    
    if (studentAlerts.length > 0 && !focusMode) {
        banner.style.display = 'block';
        list.innerHTML = studentAlerts.slice(0, 3).map(alert => 
            `<div style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.2);">
                ${alert.distance}m ahead - Student ${alert.studentId}
            </div>`
        ).join('');
    } else {
        banner.style.display = 'none';
    }
}

function dismissAlerts() {
    studentAlerts = [];
    updateStudentAlerts();
}


// Guard optional demo-only bindings (present on some pages)
document.addEventListener('DOMContentLoaded', function() {
  const navButtons = document.querySelectorAll('.nav-btn');
  if (navButtons && navButtons.length) {
    navButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = (btn.textContent || '').trim().toLowerCase();
        if (text === 'map') window.location.href = 'driver.html';
        if (text === 'route') window.location.href = 'driver-route.html';
        if (text === 'students') window.location.href = 'driver-students.html';
        if (text === 'alerts') window.location.href = 'driver-others.html';
        if (text === 'profile') window.location.href = 'driver-profile.html';
      });
    });
  }
  const fb = document.getElementById('focusBtn');
  const exitFb = document.getElementById('exitFocus');
  if (fb && exitFb) {
    fb.addEventListener('click', () => {
      const fm = document.getElementById('focusMode');
      if (fm) fm.style.display = 'flex';
      const ma = document.querySelector('.map-area');
      if (ma) ma.style.height = '75vh';
    });
    exitFb.addEventListener('click', () => {
      const fm = document.getElementById('focusMode');
      if (fm) fm.style.display = 'none';
      const ma = document.querySelector('.map-area');
      if (ma) ma.style.height = 'auto';
    });
  }
});
  