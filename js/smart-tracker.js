/**
 * Smart GPS Tracker for V-Track Driver Platform
 *
 * Features:
 * - Intelligent duplicate detection (avoid writing when bus hasn't moved)
 * - Adaptive update intervals (fast when moving, slow when idle)
 * - GPS accuracy filtering
 * - Efficient Firebase writes
 * - Heartbeat updates for idle periods
 * - Battery-friendly background tracking
 *
 * @version 2.0
 * @author V-Track Team
 */

(function () {
  "use strict";

  // ============================================================
  // CONFIGURATION
  // ============================================================

  const CONFIG = {
    // Update intervals
    MOVING_INTERVAL: 3000, // 3s when moving
    SLOW_INTERVAL: 6000, // 6s when moving slowly
    IDLE_INTERVAL: 15000, // 15s when idle
    BACKGROUND_INTERVAL: 30000, // 30s when app in background

    // Movement thresholds
    MIN_DISTANCE_METERS: 5, // Minimum movement to record
    SLOW_SPEED_THRESHOLD: 5, // km/h - below this is "slow"
    IDLE_SPEED_THRESHOLD: 1, // km/h - below this is "idle"

    // GPS filtering
    MAX_SPEED_MS: 60, // 60 m/s max speed (216 km/h)
    MAX_ACCURACY_METERS: 50, // Ignore points with poor accuracy
    MAX_JUMP_METERS: 500, // Max distance between consecutive points

    // Heartbeat
    HEARTBEAT_INTERVAL: 30000, // Update timestamp every 30s when idle

    // Geolocation options
    GEO_OPTIONS: {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    },
  };

  // ============================================================
  // STATE MANAGEMENT
  // ============================================================

  const state = {
    busId: null,
    isTracking: false,
    watchId: null,

    // Last recorded position (written to Firebase)
    lastRecordedPosition: null,
    lastRecordedTime: 0,

    // Last GPS reading (may not be recorded)
    lastGpsReading: null,
    lastGpsTime: 0,

    // Heartbeat tracking
    lastHeartbeatTime: 0,

    // Statistics
    stats: {
      totalUpdates: 0,
      filteredUpdates: 0,
      heartbeats: 0,
      errors: 0,
    },

    // Movement state
    currentSpeed: 0,
    isMoving: false,
    isIdle: true,

    // Callbacks
    onLocationUpdate: null,
    onError: null,
    onStatusChange: null,
  };

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  /**
   * Calculate distance between two GPS points using Haversine formula
   * @param {number} lat1 - Latitude of point 1
   * @param {number} lon1 - Longitude of point 1
   * @param {number} lat2 - Latitude of point 2
   * @param {number} lon2 - Longitude of point 2
   * @returns {number} Distance in meters
   */
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  /**
   * Calculate bearing between two points
   * @returns {number} Bearing in degrees (0-360)
   */
  function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = toRadians(lon2 - lon1);
    const lat1Rad = toRadians(lat1);
    const lat2Rad = toRadians(lat2);

    const y = Math.sin(dLon) * Math.cos(lat2Rad);
    const x =
      Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

    let bearing = (Math.atan2(y, x) * 180) / Math.PI;
    return (bearing + 360) % 360;
  }

  /**
   * Check if app is visible (for adaptive intervals)
   */
  function isAppVisible() {
    return document.visibilityState === "visible";
  }

  /**
   * Get adaptive interval based on speed and app state
   */
  function getAdaptiveInterval() {
    if (!isAppVisible()) {
      return CONFIG.BACKGROUND_INTERVAL;
    }

    if (state.isIdle) {
      return CONFIG.IDLE_INTERVAL;
    }

    if (state.currentSpeed < CONFIG.SLOW_SPEED_THRESHOLD) {
      return CONFIG.SLOW_INTERVAL;
    }

    return CONFIG.MOVING_INTERVAL;
  }

  /**
   * Validate GPS coordinates
   */
  function isValidCoordinate(lat, lon) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    );
  }

  // ============================================================
  // GPS FILTERING & VALIDATION
  // ============================================================

  /**
   * Filter GPS point - returns null if point should be rejected
   * @param {Object} newPoint - New GPS reading
   * @param {Object} lastPoint - Last recorded point
   * @returns {Object|null} Filtered point or null
   */
  function filterGpsPoint(newPoint, lastPoint) {
    // Validate coordinates
    if (!isValidCoordinate(newPoint.latitude, newPoint.longitude)) {
      console.warn("[SmartTracker] Invalid coordinates");
      state.stats.filteredUpdates++;
      return null;
    }

    // Check GPS accuracy (if available)
    if (newPoint.accuracy && newPoint.accuracy > CONFIG.MAX_ACCURACY_METERS) {
      console.warn(
        `[SmartTracker] Poor accuracy: ${newPoint.accuracy.toFixed(1)}m`,
      );
      state.stats.filteredUpdates++;
      return null;
    }

    // If no previous point, accept this one
    if (!lastPoint) {
      return newPoint;
    }

    // Calculate distance from last recorded point
    const distance = haversineDistance(
      lastPoint.latitude,
      lastPoint.longitude,
      newPoint.latitude,
      newPoint.longitude,
    );

    // Calculate time difference
    const timeDiff = (newPoint.ts - lastPoint.ts) / 1000; // seconds

    // Filter unrealistic jumps
    if (distance > CONFIG.MAX_JUMP_METERS) {
      console.warn(`[SmartTracker] Jump too large: ${distance.toFixed(1)}m`);
      state.stats.filteredUpdates++;
      return null;
    }

    // Check for unrealistic speed
    if (timeDiff > 0) {
      const speedMS = distance / timeDiff;
      if (speedMS > CONFIG.MAX_SPEED_MS) {
        console.warn(
          `[SmartTracker] Speed too high: ${(speedMS * 3.6).toFixed(1)} km/h`,
        );
        state.stats.filteredUpdates++;
        return null;
      }
    }

    // Check minimum distance threshold
    if (distance < CONFIG.MIN_DISTANCE_METERS) {
      // Not enough movement - don't record new point
      return null;
    }

    // Point passed all filters
    return newPoint;
  }

  // ============================================================
  // FIREBASE OPERATIONS
  // ============================================================

  /**
   * Write location to Firebase under BusLocation/{busId}/{timestamp}
   */
  function writeLocationToFirebase(busId, timestamp, data) {
    if (!window.firebase || !window.firebase.database) {
      console.error("[SmartTracker] Firebase not available");
      return Promise.reject(new Error("Firebase unavailable"));
    }

    const db = window.firebase.database();
    // Write ONLY latitude and longitude at timestamp level (as per user requirement)
    const locationData = {
      latitude: data.latitude,
      longitude: data.longitude,
    };

    return db.ref(`BusLocation/${busId}/${timestamp}`).set(locationData);
  }

  /**
   * Update current location (for real-time tracking)
   */
  function updateCurrentLocation(busId, data) {
    if (!window.firebase || !window.firebase.database) {
      return Promise.reject(new Error("Firebase unavailable"));
    }

    const db = window.firebase.database();
    // Store additional data in drivers/currentLocation for UI display
    return db.ref(`drivers/${busId}/currentLocation`).set({
      latitude: data.latitude,
      longitude: data.longitude,
      speed: data.speed || 0,
      heading: data.heading || 0,
      ts: data.ts,
      lastUpdate: Date.now(),
      online: true,
    });
  }

  /**
   * Send heartbeat (timestamp-only update when idle)
   */
  function sendHeartbeat(busId) {
    if (!window.firebase || !window.firebase.database) {
      return Promise.resolve();
    }

    const now = Date.now();
    const db = window.firebase.database();

    return db
      .ref(`drivers/${busId}/currentLocation/ts`)
      .set(now)
      .then(() => {
        state.lastHeartbeatTime = now;
        state.stats.heartbeats++;
        console.log("[SmartTracker] Heartbeat sent");
      })
      .catch((err) => {
        console.error("[SmartTracker] Heartbeat error:", err);
      });
  }

  // ============================================================
  // POSITION HANDLING
  // ============================================================

  /**
   * Process new GPS position
   */
  function handlePosition(position) {
    const now = Date.now();
    const coords = position.coords;

    // Update last GPS reading
    state.lastGpsReading = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      altitude: coords.altitude,
      speed: coords.speed,
      heading: coords.heading,
      timestamp: coords.timestamp || now,
    };
    state.lastGpsTime = now;

    // Calculate speed in km/h
    let speedKmh = 0;
    if (coords.speed && coords.speed >= 0) {
      speedKmh = Math.round(coords.speed * 3.6);
    } else if (state.lastRecordedPosition) {
      // Estimate speed from distance/time
      const distance = haversineDistance(
        state.lastRecordedPosition.latitude,
        state.lastRecordedPosition.longitude,
        coords.latitude,
        coords.longitude,
      );
      const timeDiff = (now - state.lastRecordedTime) / 1000;
      if (timeDiff > 0) {
        speedKmh = Math.round((distance / timeDiff) * 3.6);
      }
    }

    // Calculate heading if not provided
    let heading = coords.heading;
    if (!heading && state.lastRecordedPosition) {
      heading = calculateBearing(
        state.lastRecordedPosition.latitude,
        state.lastRecordedPosition.longitude,
        coords.latitude,
        coords.longitude,
      );
    }

    // Update movement state
    state.currentSpeed = speedKmh;
    state.isIdle = speedKmh < CONFIG.IDLE_SPEED_THRESHOLD;
    state.isMoving = speedKmh >= CONFIG.SLOW_SPEED_THRESHOLD;

    // Create location data object
    const locationData = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      speed: speedKmh,
      heading: Math.round(heading || 0),
      accuracy: coords.accuracy,
      altitude: coords.altitude,
      ts: now,
    };

    // Check if enough time has passed since last update
    const adaptiveInterval = getAdaptiveInterval();
    const timeSinceLastUpdate = now - state.lastRecordedTime;

    if (timeSinceLastUpdate < adaptiveInterval) {
      // Too soon - skip this update
      return;
    }

    // Filter GPS point
    const filteredPoint = filterGpsPoint(
      locationData,
      state.lastRecordedPosition,
    );

    if (!filteredPoint) {
      // Point was filtered out (not enough movement)
      // Send heartbeat if it's been a while
      const timeSinceHeartbeat = now - state.lastHeartbeatTime;
      if (timeSinceHeartbeat >= CONFIG.HEARTBEAT_INTERVAL) {
        sendHeartbeat(state.busId);
      }
      return;
    }

    // Point passed filters - write to Firebase
    const timestamp = now;

    writeLocationToFirebase(state.busId, timestamp, filteredPoint)
      .then(() => {
        console.log(
          `[SmartTracker] Location recorded: ${filteredPoint.latitude.toFixed(6)}, ${filteredPoint.longitude.toFixed(6)} | Speed: ${filteredPoint.speed} km/h`,
        );

        // Update state
        state.lastRecordedPosition = {
          latitude: filteredPoint.latitude,
          longitude: filteredPoint.longitude,
          ts: timestamp,
        };
        state.lastRecordedTime = timestamp;
        state.stats.totalUpdates++;

        // Also update current location for real-time tracking
        return updateCurrentLocation(state.busId, filteredPoint);
      })
      .then(() => {
        // Trigger callback if set
        if (state.onLocationUpdate) {
          state.onLocationUpdate(filteredPoint);
        }
      })
      .catch((err) => {
        console.error("[SmartTracker] Firebase write error:", err);
        state.stats.errors++;
        if (state.onError) {
          state.onError(err);
        }
      });
  }

  /**
   * Handle geolocation errors
   */
  function handleError(error) {
    console.error("[SmartTracker] Geolocation error:", error.message);
    state.stats.errors++;

    let errorMessage = "Location error";
    switch (error.code) {
      case error.PERMISSION_DENIED:
        errorMessage = "Location permission denied";
        break;
      case error.POSITION_UNAVAILABLE:
        errorMessage = "Location unavailable";
        break;
      case error.TIMEOUT:
        errorMessage = "Location timeout";
        break;
    }

    if (state.onError) {
      state.onError(new Error(errorMessage));
    }

    if (state.onStatusChange) {
      state.onStatusChange("error", errorMessage);
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  const SmartTracker = {
    /**
     * Initialize and start tracking
     * @param {string} busId - Bus identifier
     * @param {Object} callbacks - Optional callbacks
     */
    start: function (busId, callbacks = {}) {
      if (state.isTracking) {
        console.warn("[SmartTracker] Already tracking");
        return false;
      }

      if (!busId) {
        console.error("[SmartTracker] Bus ID required");
        return false;
      }

      if (!navigator.geolocation) {
        console.error("[SmartTracker] Geolocation not supported");
        return false;
      }

      // Set callbacks
      state.onLocationUpdate = callbacks.onLocationUpdate || null;
      state.onError = callbacks.onError || null;
      state.onStatusChange = callbacks.onStatusChange || null;

      // Update state
      state.busId = busId;
      state.isTracking = true;

      // Start watching position
      state.watchId = navigator.geolocation.watchPosition(
        handlePosition,
        handleError,
        CONFIG.GEO_OPTIONS,
      );

      console.log(`[SmartTracker] Started tracking for ${busId}`);

      if (state.onStatusChange) {
        state.onStatusChange("tracking", "GPS tracking started");
      }

      return true;
    },

    /**
     * Stop tracking
     */
    stop: function () {
      if (!state.isTracking) {
        console.warn("[SmartTracker] Not tracking");
        return false;
      }

      if (state.watchId !== null) {
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
      }

      state.isTracking = false;

      console.log("[SmartTracker] Stopped tracking");
      console.log(
        `[SmartTracker] Stats: ${state.stats.totalUpdates} updates, ${state.stats.filteredUpdates} filtered, ${state.stats.heartbeats} heartbeats, ${state.stats.errors} errors`,
      );

      if (state.onStatusChange) {
        state.onStatusChange("stopped", "GPS tracking stopped");
      }

      return true;
    },

    /**
     * Check if currently tracking
     */
    isTracking: function () {
      return state.isTracking;
    },

    /**
     * Get current state
     */
    getState: function () {
      return {
        busId: state.busId,
        isTracking: state.isTracking,
        currentSpeed: state.currentSpeed,
        isMoving: state.isMoving,
        isIdle: state.isIdle,
        lastRecordedPosition: state.lastRecordedPosition,
        lastGpsReading: state.lastGpsReading,
        stats: { ...state.stats },
      };
    },

    /**
     * Get statistics
     */
    getStats: function () {
      return { ...state.stats };
    },

    /**
     * Reset statistics
     */
    resetStats: function () {
      state.stats = {
        totalUpdates: 0,
        filteredUpdates: 0,
        heartbeats: 0,
        errors: 0,
      };
    },

    /**
     * Update configuration
     */
    configure: function (newConfig) {
      Object.assign(CONFIG, newConfig);
      console.log("[SmartTracker] Configuration updated");
    },

    /**
     * Get current configuration
     */
    getConfig: function () {
      return { ...CONFIG };
    },
  };

  // ============================================================
  // EXPORT
  // ============================================================

  // Expose to global scope
  window.SmartTracker = SmartTracker;

  // Log initialization
  console.log("[SmartTracker] Module loaded v2.0");
})();
