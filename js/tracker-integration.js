/**
 * Smart Tracker Integration Layer
 *
 * Connects the SmartTracker module with the existing driver.js UI
 * Provides seamless integration without breaking existing functionality
 *
 * @version 1.0
 * @requires smart-tracker.js
 * @requires driver.js
 * @requires firebase.js
 */

(function() {
    'use strict';

    // Wait for dependencies to load
    function waitForDependencies(callback) {
        const checkInterval = setInterval(() => {
            if (window.SmartTracker && window.firebase && window.firebase.database) {
                clearInterval(checkInterval);
                callback();
            }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
            clearInterval(checkInterval);
            console.error('[TrackerIntegration] Dependencies not loaded');
        }, 10000);
    }

    // Integration state
    const integration = {
        initialized: false,
        uiElements: {},
        callbacks: {}
    };

    /**
     * Initialize UI element references
     */
    function initUIElements() {
        integration.uiElements = {
            // Status indicators
            statusValue: document.getElementById('statusValue'),
            connectedBusId: document.getElementById('connectedBusId'),

            // Speed and heading displays
            speedValue: document.getElementById('speedValue'),
            headingValue: document.getElementById('headingValue'),
            focusSpeedValue: document.getElementById('focusSpeedValue'),

            // Buttons
            trackingBtn: document.getElementById('trackingBtn'),
            startBtn: document.querySelector('.control.primary'),
            stopBtn: document.querySelector('.control.stop'),

            // Map elements (will be set by map API)
            map: null,
            busMarker: null
        };

        // Try to get map and marker from VTMapAPI
        if (window.VTMapAPI && window.VTMapAPI._state) {
            integration.uiElements.map = window.VTMapAPI._state.map;
            integration.uiElements.busMarker = window.VTMapAPI._state.busMarker;
        }

        console.log('[TrackerIntegration] UI elements initialized');
    }

    /**
     * Update UI with location data
     */
    function updateUI(locationData) {
        const { latitude, longitude, speed, heading } = locationData;

        // Update speed display
        if (integration.uiElements.speedValue) {
            integration.uiElements.speedValue.textContent = speed + ' km/h';
        }

        // Update heading display
        if (integration.uiElements.headingValue) {
            integration.uiElements.headingValue.textContent = heading + '°';
        }

        // Update focus mode speed (if in focus mode)
        if (integration.uiElements.focusSpeedValue) {
            integration.uiElements.focusSpeedValue.textContent = speed;
        }

        // Update map marker
        updateMapMarker(latitude, longitude, speed, heading);

        // Add to route polyline
        addToRoutePolyline(latitude, longitude);
    }

    /**
     * Update map marker position
     */
    function updateMapMarker(lat, lon, speed, heading) {
        const busId = SmartTracker.getState().busId;

        // Try VTMapAPI first
        if (window.VTMapAPI && window.VTMapAPI.updateDriverMarker) {
            const popup = `Bus: ${busId}<br>Speed: ${speed} km/h<br>Heading: ${heading}°`;
            window.VTMapAPI.updateDriverMarker(lat, lon, popup);
        }
        // Fallback to direct Leaflet manipulation
        else if (integration.uiElements.map && integration.uiElements.busMarker) {
            const latlng = [lat, lon];
            integration.uiElements.busMarker.setLatLng(latlng);

            const popup = `Bus: ${busId}<br>Speed: ${speed} km/h<br>Heading: ${heading}°`;
            integration.uiElements.busMarker.bindPopup(popup);

            // Pan map to new position
            integration.uiElements.map.panTo(latlng);
        }
        // Fallback to global map variable
        else if (window.map && window.busMarker) {
            const latlng = [lat, lon];
            window.busMarker.setLatLng(latlng);
            window.map.panTo(latlng);
        }
    }

    /**
     * Add point to route polyline
     */
    function addToRoutePolyline(lat, lon) {
        // Try VTMapAPI
        if (window.VTMapAPI && window.VTMapAPI.addRoutePoint) {
            window.VTMapAPI.addRoutePoint(lat, lon, { active: true });
        }
        // Fallback to global routePoints
        else if (window.routePoints && Array.isArray(window.routePoints)) {
            window.routePoints.push([lat, lon]);
            if (window.updateRoutePolyline) {
                window.updateRoutePolyline();
            }
        }
    }

    /**
     * Update status indicator
     */
    function updateStatus(status, message) {
        if (!integration.uiElements.statusValue) return;

        switch (status) {
            case 'tracking':
                integration.uiElements.statusValue.textContent = 'Tracking 🟢';
                integration.uiElements.statusValue.style.color = '#22c55e';
                break;
            case 'stopped':
                integration.uiElements.statusValue.textContent = 'Stopped 🔴';
                integration.uiElements.statusValue.style.color = '#ef4444';
                break;
            case 'error':
                integration.uiElements.statusValue.textContent = 'Error ⚠️';
                integration.uiElements.statusValue.style.color = '#f59e0b';
                break;
            case 'idle':
                integration.uiElements.statusValue.textContent = 'Idle 🟡';
                integration.uiElements.statusValue.style.color = '#eab308';
                break;
        }

        // Also update button states
        updateButtonStates();
    }

    /**
     * Update button states based on tracking status
     */
    function updateButtonStates() {
        const isTracking = SmartTracker.isTracking();

        // Update tracking button
        if (integration.uiElements.trackingBtn) {
            integration.uiElements.trackingBtn.textContent = isTracking ? 'Stop Tracking' : 'Start Tracking';
            integration.uiElements.trackingBtn.classList.toggle('active', isTracking);
        }

        // Update start/stop buttons
        if (integration.uiElements.startBtn) {
            integration.uiElements.startBtn.disabled = isTracking;
            integration.uiElements.startBtn.style.opacity = isTracking ? '0.5' : '1';
        }

        if (integration.uiElements.stopBtn) {
            integration.uiElements.stopBtn.disabled = !isTracking;
            integration.uiElements.stopBtn.style.opacity = isTracking ? '1' : '0.5';
        }
    }

    /**
     * Handle location updates from SmartTracker
     */
    function onLocationUpdate(locationData) {
        console.log('[TrackerIntegration] Location update:', locationData);

        // Update UI
        updateUI(locationData);

        // Call user callback if set
        if (integration.callbacks.onLocationUpdate) {
            integration.callbacks.onLocationUpdate(locationData);
        }

        // Check student proximity (if function exists)
        if (window.checkStudentProximity) {
            window.checkStudentProximity(locationData);
        }
    }

    /**
     * Handle errors from SmartTracker
     */
    function onError(error) {
        console.error('[TrackerIntegration] Error:', error);

        // Update UI
        updateStatus('error', error.message);

        // Show alert to user
        if (error.message.includes('permission')) {
            alert('Location permission denied. Please enable location access in your browser settings.');
        }

        // Call user callback if set
        if (integration.callbacks.onError) {
            integration.callbacks.onError(error);
        }
    }

    /**
     * Handle status changes from SmartTracker
     */
    function onStatusChange(status, message) {
        console.log(`[TrackerIntegration] Status: ${status} - ${message}`);

        // Update UI
        updateStatus(status, message);

        // Call user callback if set
        if (integration.callbacks.onStatusChange) {
            integration.callbacks.onStatusChange(status, message);
        }
    }

    /**
     * Start tracking with SmartTracker
     */
    function startSmartTracking(busId) {
        if (!busId) {
            // Try to get from global or localStorage
            busId = window.currentBusId || localStorage.getItem('v-track-driver-busId');
        }

        if (!busId) {
            alert('Please select a bus ID first');
            return false;
        }

        console.log(`[TrackerIntegration] Starting tracking for ${busId}`);

        const success = SmartTracker.start(busId, {
            onLocationUpdate: onLocationUpdate,
            onError: onError,
            onStatusChange: onStatusChange
        });

        if (success) {
            updateButtonStates();
            console.log('[TrackerIntegration] Tracking started successfully');
        } else {
            console.error('[TrackerIntegration] Failed to start tracking');
        }

        return success;
    }

    /**
     * Stop tracking
     */
    function stopSmartTracking() {
        console.log('[TrackerIntegration] Stopping tracking');

        const success = SmartTracker.stop();

        if (success) {
            updateButtonStates();

            // Show stats
            const stats = SmartTracker.getStats();
            console.log('[TrackerIntegration] Session stats:', stats);
        }

        return success;
    }

    /**
     * Toggle tracking
     */
    function toggleSmartTracking() {
        if (SmartTracker.isTracking()) {
            stopSmartTracking();
        } else {
            startSmartTracking();
        }
    }

    /**
     * Attach event listeners to UI elements
     */
    function attachEventListeners() {
        // Tracking button
        if (integration.uiElements.trackingBtn) {
            integration.uiElements.trackingBtn.addEventListener('click', toggleSmartTracking);
        }

        // Start button
        if (integration.uiElements.startBtn) {
            integration.uiElements.startBtn.addEventListener('click', () => {
                startSmartTracking();
            });
        }

        // Stop button
        if (integration.uiElements.stopBtn) {
            integration.uiElements.stopBtn.addEventListener('click', () => {
                stopSmartTracking();
            });
        }

        // Also listen for buttons with text content
        document.querySelectorAll('button').forEach(btn => {
            const text = (btn.textContent || '').toLowerCase().trim();
            if (text.includes('start tracking') || text === 'start') {
                btn.addEventListener('click', (e) => {
                    if (!SmartTracker.isTracking()) {
                        e.preventDefault();
                        startSmartTracking();
                    }
                });
            }
            if (text.includes('stop tracking') || text === 'stop') {
                btn.addEventListener('click', (e) => {
                    if (SmartTracker.isTracking()) {
                        e.preventDefault();
                        stopSmartTracking();
                    }
                });
            }
        });

        console.log('[TrackerIntegration] Event listeners attached');
    }

    /**
     * Initialize the integration
     */
    function initialize() {
        if (integration.initialized) {
            console.warn('[TrackerIntegration] Already initialized');
            return;
        }

        console.log('[TrackerIntegration] Initializing...');

        // Initialize UI
        initUIElements();

        // Attach event listeners
        attachEventListeners();

        // Mark as initialized
        integration.initialized = true;

        console.log('[TrackerIntegration] Initialized successfully');

        // Auto-start if there was a previous session
        const wasTracking = sessionStorage.getItem('v-track-was-tracking');
        if (wasTracking === 'true') {
            console.log('[TrackerIntegration] Restoring previous tracking session');
            setTimeout(() => startSmartTracking(), 1000);
        }
    }

    /**
     * Save tracking state to sessionStorage
     */
    function saveTrackingState() {
        sessionStorage.setItem('v-track-was-tracking', SmartTracker.isTracking().toString());
    }

    // Save state before page unload
    window.addEventListener('beforeunload', saveTrackingState);

    // ============================================================
    // PUBLIC API
    // ============================================================

    window.TrackerIntegration = {
        initialize: initialize,
        start: startSmartTracking,
        stop: stopSmartTracking,
        toggle: toggleSmartTracking,
        isTracking: () => SmartTracker.isTracking(),
        getState: () => SmartTracker.getState(),
        getStats: () => SmartTracker.getStats(),

        // Allow custom callbacks
        setCallbacks: function(callbacks) {
            integration.callbacks = callbacks;
        },

        // Refresh UI elements (useful after dynamic content changes)
        refreshUI: function() {
            initUIElements();
        }
    };

    // ============================================================
    // AUTO-INITIALIZATION
    // ============================================================

    // Wait for dependencies and initialize
    waitForDependencies(() => {
        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initialize);
        } else {
            initialize();
        }
    });

    console.log('[TrackerIntegration] Module loaded');

})();
