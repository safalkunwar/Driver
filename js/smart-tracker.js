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
    MOVING_INTERVAL: 1000, // 1.5s when moving
    SLOW_INTERVAL: 2000, // 3s when moving slowly
    IDLE_INTERVAL: 5000, // 10s when idle
    BACKGROUND_INTERVAL: 9000, // 20s when app in background

    // Movement thresholds
    MIN_DISTANCE_METERS: 5, // Minimum movement to record
    SLOW_SPEED_THRESHOLD: 5, // km/h - below this is "slow"
    IDLE_SPEED_THRESHOLD: 1, // km/h - below this is "idle"

    // GPS filtering
    MAX_SPEED_MS: 60, // 60 m/s max speed (216 km/h)
    MAX_ACCURACY_METERS: 50, // Ignore points with poor accuracy
    MAX_JUMP_METERS: 500, // Max distance between consecutive points

    // Heartbeat
    HEARTBEAT_INTERVAL: 3000, // Update timestamp every 30s when idle

    // Geolocation options
    GEO_OPTIONS: {
      enableHighAccuracy: true,
      timeout: 10000,
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

  // Track last written location to detect duplicates
  let lastWrittenLocation = null;
  let lastWrittenTimestamp = null;

  /**
   * Check if location is the same as last written (within threshold)
   */
  function isSameLocation(lat1, lon1, lat2, lon2) {
    if (!lat2 || !lon2) return false;
    const distance = haversineDistance(lat1, lon1, lat2, lon2);
    return distance < CONFIG.MIN_DISTANCE_METERS; // Same location if within 5 meters
  }

  /**
   * Write location to Firebase under BusLocation/{busId}/{timestamp}
   * Smart storage: if bus is at same location, update timestamp instead of creating duplicate
   */
  async function writeLocationToFirebase(busId, timestamp, data) {
    if (!window.firebase || !window.firebase.database) {
      console.error("[SmartTracker] Firebase not available");
      return Promise.reject(new Error("Firebase unavailable"));
    }

    const db = window.firebase.database();
    const locationData = {
      latitude: data.latitude,
      longitude: data.longitude,
    };

    // Check if bus is at the same location as last written
    if (
      lastWrittenLocation &&
      isSameLocation(
        data.latitude,
        data.longitude,
        lastWrittenLocation.latitude,
        lastWrittenLocation.longitude,
      ) &&
      lastWrittenTimestamp
    ) {
      // Bus is stationary. Update the timestamp by removing the old entry and creating a new one.
      const oldTimestamp = lastWrittenTimestamp;
      const newTimestamp = timestamp;

      // Update internal state first to prevent race conditions
      lastWrittenTimestamp = newTimestamp;

      const oldRef = db.ref(`BusLocation/${busId}/${oldTimestamp}`);
      const newRef = db.ref(`BusLocation/${busId}/${newTimestamp}`);

      try {
        await oldRef.remove();
        await newRef.set(locationData);
        console.log(
          `[SmartTracker] Timestamp updated for stationary location: ${newTimestamp}`,
        );
      } catch (error) {
        console.error("[SmartTracker] Failed to update timestamp:", error);
        // If it fails, the next moving update will fix the chain.
        throw error;
      }
    } else {
      // Bus has moved or this is the first update. Create a new location entry.
      try {
        await db.ref(`BusLocation/${busId}/${timestamp}`).set(locationData);
        // Update tracking state
        lastWrittenLocation = {
          latitude: data.latitude,
          longitude: data.longitude,
        };
        lastWrittenTimestamp = timestamp;
        state.stats.totalUpdates++;
        console.log(
          `[SmartTracker] New location recorded: ${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`,
        );
      } catch (error) {
        console.warn(
          "[SmartTracker] Firebase write failed, queuing for offline sync...",
        );
        if (window.OfflineManager) {
          OfflineManager.queueUpdate(
            busId,
            timestamp,
            locationData,
            "location",
          );
        }
        throw error;
      }
    }
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

    const locationData = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      altitude: coords.altitude,
      speed: coords.speed,
      heading: coords.heading,
      ts: now,
    };

    // Determine if the bus has moved significantly
    const hasMoved = !isSameLocation(
      locationData.latitude,
      locationData.longitude,
      lastWrittenLocation ? lastWrittenLocation.latitude : null,
      lastWrittenLocation ? lastWrittenLocation.longitude : null,
    );

    // If the bus hasn't moved, we still want to update the timestamp to show it's online.
    // If it has moved, we write the new location.
    writeLocationToFirebase(state.busId, now, locationData)
      .then(() => {
        // Update state that tracks the last recorded position for filtering and distance calculation
        state.lastRecordedPosition = {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          ts: now,
        };
        state.lastRecordedTime = now;

        // Also update the separate, real-time UI tracking location
        return updateCurrentLocation(state.busId, locationData);
      })
      .then(() => {
        if (state.onLocationUpdate) {
          state.onLocationUpdate(locationData);
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

      // Reset location tracking
      lastWrittenLocation = null;
      lastWrittenTimestamp = null;

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
