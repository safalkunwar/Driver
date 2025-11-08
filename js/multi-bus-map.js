/**
 * Multi-Bus Map Display Module
 *
 * Displays all buses on the map with online/offline status indicators
 * Shows animations for online buses
 * Real-time updates from Firebase
 *
 * @version 1.0
 */

(function () {
  "use strict";

  // ============================================================
  // STATE MANAGEMENT
  // ============================================================

  const state = {
    map: null,
    busMarkers: {},
    myBusId: null,
    isEnabled: false,
    updateInterval: null,
    firebaseListeners: {},
  };

  // Bus marker colors
  const COLORS = {
    MY_BUS: "#3b82f6", // Blue
    OTHER_ONLINE: "#22c55e", // Green
    OTHER_OFFLINE: "#64748b", // Gray
  };

  // Online threshold (if no update in 2 minutes, consider offline)
  const ONLINE_THRESHOLD_MS = 120000; // 2 minutes

  // ============================================================
  // MARKER CREATION
  // ============================================================

  /**
   * Create custom bus marker with animation
   */
  function createBusMarker(lat, lon, busId, isMyBus, isOnline, isMoving = false, hasRoute = false) {
    if (!window.L) {
      console.error("[MultiBusMap] Leaflet not loaded");
      return null;
    }

    // Determine color based on status
    let color = COLORS.OTHER_OFFLINE;
    if (isMyBus) {
      color = COLORS.MY_BUS;
    } else if (hasRoute && isMoving) {
      color = "#10b981"; // Green for moving on route
    } else if (hasRoute) {
      color = "#3b82f6"; // Blue for on route but stopped
    } else if (isOnline) {
      color = COLORS.OTHER_ONLINE;
    }

    // Enhanced animation for moving buses
    const pulseAnimation = isMoving && isOnline
      ? `
        @keyframes pulse-${busId} {
            0%, 100% { transform: scale(1) rotate(0deg); opacity: 1; }
            25% { transform: scale(1.15) rotate(2deg); opacity: 0.9; }
            50% { transform: scale(1.1) rotate(0deg); opacity: 0.8; }
            75% { transform: scale(1.15) rotate(-2deg); opacity: 0.9; }
        }
        animation: pulse-${busId} 1.5s infinite;
    `
      : isOnline
        ? `
        @keyframes pulse-${busId} {
            0%, 100% { transform: scale(1); opacity: 1; }
            50% { transform: scale(1.1); opacity: 0.8; }
        }
        animation: pulse-${busId} 2s infinite;
    `
        : "";

    const icon = L.divIcon({
      className: "custom-bus-marker",
      html: `
                <style>
                    .bus-marker-${busId} {
                        position: relative;
                        ${pulseAnimation}
                    }
                    .bus-marker-${busId}::before {
                        content: '';
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        width: 60px;
                        height: 60px;
                        background: ${color};
                        opacity: 0.2;
                        border-radius: 50%;
                        ${isOnline ? "animation: ripple 2s infinite;" : ""}
                    }
                    @keyframes ripple {
                        0% {
                            width: 60px;
                            height: 60px;
                            opacity: 0.4;
                        }
                        100% {
                            width: 100px;
                            height: 100px;
                            opacity: 0;
                        }
                    }
                    .bus-icon-${busId} {
                        background: ${color};
                        color: white;
                        padding: 12px;
                        border-radius: 50%;
                        font-size: 24px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                        border: 3px solid white;
                        position: relative;
                        z-index: 10;
                    }
                    ${
                      isOnline
                        ? `
                    .bus-icon-${busId}::after {
                        content: '';
                        position: absolute;
                        top: -2px;
                        right: -2px;
                        width: 12px;
                        height: 12px;
                        background: #22c55e;
                        border: 2px solid white;
                        border-radius: 50%;
                        animation: blink 1.5s infinite;
                    }
                    @keyframes blink {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.3; }
                    }
                    `
                        : ""
                    }
                </style>
                <div class="bus-marker-${busId}">
                    <div class="bus-icon-${busId}">
                        ${isMyBus ? "🚌" : "🚐"}
                    </div>
                </div>
            `,
      iconSize: [60, 60],
      iconAnchor: [30, 30],
      popupAnchor: [0, -30],
    });

    const marker = L.marker([lat, lon], { icon: icon });

    return marker;
  }

  /**
   * Create popup content for bus
   */
  function createPopupContent(busId, data, isMyBus, isOnline) {
    const speed = data.speed || 0;
    const heading = data.heading || 0;
    const lastUpdate = data.lastUpdate || data.ts || data.timestamp || Date.now();
    const timeSince = Math.floor((Date.now() - lastUpdate) / 1000);

    let timeText = "Just now";
    if (timeSince > 3600) {
      const hours = Math.floor(timeSince / 3600);
      timeText = `${hours} hour${hours > 1 ? "s" : ""} ago`;
    } else if (timeSince > 60) {
      const minutes = Math.floor(timeSince / 60);
      timeText = `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    } else if (timeSince > 10) {
      timeText = `${timeSince} seconds ago`;
    }

    const statusBadge = isOnline
      ? '<span style="background: #22c55e; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600;">● ONLINE</span>'
      : '<span style="background: #64748b; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600;">● OFFLINE</span>';

    const movingBadge = data.isMoving
      ? '<span style="background: #f59e0b; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; margin-left: 4px;">🚌 MOVING</span>'
      : '<span style="background: #94a3b8; color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; margin-left: 4px;">⏸️ STOPPED</span>';

    const routeInfo = data.routeInfo ? `
      <div style="background: #eff6ff; padding: 8px; border-radius: 6px; margin-top: 8px; border-left: 3px solid #3b82f6;">
        <div style="font-weight: 600; color: #1e40af; margin-bottom: 4px;">📍 Route: ${data.routeInfo.routeName || data.routeInfo.routeId || "Unknown"}</div>
        ${data.routeInfo.routeDescription ? `<div style="font-size: 0.8rem; color: #475569;">${data.routeInfo.routeDescription}</div>` : ""}
      </div>
    ` : "";

    const myBusBadge = isMyBus
      ? '<div style="background: #3b82f6; color: white; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; margin-top: 8px;">📍 Your Bus</div>'
      : "";

    return `
            <div style="font-family: 'Segoe UI', sans-serif; min-width: 200px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <h3 style="margin: 0; color: #1e293b; font-size: 1.1rem;">
                        ${busId}
                    </h3>
                    <div>${statusBadge}${movingBadge}</div>
                </div>
                <div style="font-size: 0.9rem; color: #475569; line-height: 1.8;">
                    <div><strong>Speed:</strong> ${speed} km/h</div>
                    ${heading > 0 ? `<div><strong>Heading:</strong> ${heading}°</div>` : ""}
                    <div><strong>Last Update:</strong> ${timeText}</div>
                    <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 4px;">
                        📍 ${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}
                    </div>
                </div>
                ${routeInfo}
                ${myBusBadge}
            </div>
        `;
  }

  // ============================================================
  // BUS MANAGEMENT
  // ============================================================

  /**
   * Add or update bus marker on map
   */
  function addOrUpdateBus(busId, data) {
    if (!state.map || !data || !data.latitude || !data.longitude) {
      return;
    }

    const isMyBus = busId === state.myBusId;
    const isOnline = checkIfOnline(data);
    const isMoving = data.isMoving || (data.speed && data.speed > 5);
    const hasRoute = data.routeInfo && data.routeInfo.routeId;

    // Check if marker already exists
    if (state.busMarkers[busId]) {
      // Update existing marker
      const marker = state.busMarkers[busId];
      const newLatLng = [data.latitude, data.longitude];

      // Smooth transition to new position (animate if moving)
      if (isMoving && marker._lastPosition) {
        const oldLatLng = marker._lastPosition;
        const distance = haversineDistance(
          oldLatLng[0], oldLatLng[1],
          newLatLng[0], newLatLng[1]
        );
        
        // Only animate if moved significantly
        if (distance > 5) {
          marker.setLatLng(newLatLng, { animate: true, duration: 1 });
        } else {
          marker.setLatLng(newLatLng);
        }
      } else {
        marker.setLatLng(newLatLng);
      }
      marker._lastPosition = newLatLng;

      // Update popup content
      const popupContent = createPopupContent(busId, data, isMyBus, isOnline);
      marker.setPopupContent(popupContent);

      // Update marker appearance if status changed
      const wasOnline = marker._wasOnline;
      const wasMoving = marker._wasMoving;
      const hadRoute = marker._hadRoute;
      
      if (wasOnline !== isOnline || wasMoving !== isMoving || hadRoute !== hasRoute) {
        if (state.map && typeof state.map.removeLayer === 'function') {
          state.map.removeLayer(marker);
        }
        const newMarker = createBusMarker(
          data.latitude,
          data.longitude,
          busId,
          isMyBus,
          isOnline,
          isMoving,
          hasRoute
        );
        if (newMarker && state.map && typeof state.map.addLayer === 'function') {
          newMarker.addTo(state.map);
          newMarker.bindPopup(popupContent);
          newMarker._wasOnline = isOnline;
          newMarker._wasMoving = isMoving;
          newMarker._hadRoute = hasRoute;
          newMarker._lastPosition = newLatLng;
          state.busMarkers[busId] = newMarker;
        }
      }
    } else {
      // Create new marker
      const marker = createBusMarker(
        data.latitude,
        data.longitude,
        busId,
        isMyBus,
        isOnline,
        isMoving,
        hasRoute
      );

      if (!marker) return;

      const popupContent = createPopupContent(busId, data, isMyBus, isOnline);
      marker.bindPopup(popupContent);
      marker._wasOnline = isOnline;
      marker._wasMoving = isMoving;
      marker._hadRoute = hasRoute;
      marker._lastPosition = [data.latitude, data.longitude];
      
      // Check if map has addLayer method (Leaflet map)
      if (state.map && typeof state.map.addLayer === 'function') {
        marker.addTo(state.map);
      } else {
        console.error('[MultiBusMap] Map does not have addLayer method', state.map);
        return;
      }

      state.busMarkers[busId] = marker;

      console.log(
        `[MultiBusMap] Added bus: ${busId} (${isOnline ? "online" : "offline"}, ${isMoving ? "moving" : "stopped"}, ${hasRoute ? "on route" : "no route"})`,
      );
    }
  }

  /**
   * Remove bus marker from map
   */
  function removeBus(busId) {
    if (state.busMarkers[busId]) {
      state.map.removeLayer(state.busMarkers[busId]);
      delete state.busMarkers[busId];
      console.log(`[MultiBusMap] Removed bus: ${busId}`);
    }
  }

  /**
   * Check if bus is online based on last update time
   */
  function checkIfOnline(data) {
    const lastUpdate = data.lastUpdate || data.ts || 0;
    const timeSince = Date.now() - lastUpdate;
    return timeSince < ONLINE_THRESHOLD_MS && data.online !== false;
  }

  // ============================================================
  // FIREBASE INTEGRATION
  // ============================================================

  /**
   * Get last location from BusLocation for a bus
   */
  async function getLastLocationFromBusLocation(busId) {
    if (!window.firebase || !window.firebase.database) return null;

    try {
      const db = window.firebase.database();
      const busLocationRef = db.ref(`BusLocation/${busId}`);
      const snapshot = await busLocationRef.once("value");
      const busData = snapshot.val();
      
      if (!busData) return null;

      // Get all timestamp keys (numeric)
      const timestamps = Object.keys(busData)
        .filter(key => !isNaN(key) && key !== "currentRoute")
        .map(ts => parseInt(ts))
        .sort((a, b) => b - a); // Sort descending to get latest first

      if (timestamps.length === 0) return null;

      const latestTimestamp = timestamps[0];
      const latestLocation = busData[latestTimestamp];

      if (!latestLocation || !latestLocation.latitude || !latestLocation.longitude) {
        return null;
      }

      // Get route info if available
      const routeInfo = busData.currentRoute || null;

      return {
        latitude: latestLocation.latitude,
        longitude: latestLocation.longitude,
        timestamp: latestTimestamp,
        lastUpdate: latestTimestamp,
        routeInfo: routeInfo,
        isMoving: checkIfBusIsMoving(busData, timestamps)
      };
    } catch (error) {
      console.error(`[MultiBusMap] Error getting location for ${busId}:`, error);
      return null;
    }
  }

  /**
   * Check if bus is moving based on recent location updates
   */
  function checkIfBusIsMoving(busData, timestamps) {
    if (timestamps.length < 2) return false;

    // Check if there are updates in the last hour
    const oneHourAgo = Date.now() - 3600000;
    const recentTimestamps = timestamps.filter(ts => ts > oneHourAgo);

    if (recentTimestamps.length < 2) return false;

    // Get last two locations
    const lastTwo = recentTimestamps.slice(0, 2).sort((a, b) => b - a);
    const loc1 = busData[lastTwo[0]];
    const loc2 = busData[lastTwo[1]];

    if (!loc1 || !loc2) return false;

    // Calculate distance between last two points
    const distance = haversineDistance(
      loc1.latitude, loc1.longitude,
      loc2.latitude, loc2.longitude
    );

    // If moved more than 10 meters in recent updates, consider it moving
    return distance > 10;
  }

  /**
   * Calculate distance between two points
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
   * Listen to all buses from Firebase
   */
  function listenToAllBuses() {
    if (!window.firebase || !window.firebase.database) {
      console.error("[MultiBusMap] Firebase not available");
      return;
    }

    const db = window.firebase.database();

    // Listen to BusLocation for all buses
    const busLocationRef = db.ref("BusLocation");

    state.firebaseListeners.busLocation = busLocationRef.on("value", async (snapshot) => {
      const busLocations = snapshot.val();
      if (!busLocations) return;

      // Track which buses we've seen
      const seenBuses = new Set();

      // Process each bus
      const busIds = Object.keys(busLocations);
      for (const busId of busIds) {
        if (busId === state.myBusId) continue; // Skip my bus

        seenBuses.add(busId);
        
        // Get last location from BusLocation
        const locationData = await getLastLocationFromBusLocation(busId);
        
        if (locationData) {
          addOrUpdateBus(busId, locationData);
        }
      }

      // Remove buses that are no longer in Firebase
      Object.keys(state.busMarkers).forEach((busId) => {
        if (!seenBuses.has(busId) && busId !== state.myBusId) {
          removeBus(busId);
        }
      });
    });

    // Also listen to drivers for real-time updates
    const driversRef = db.ref("drivers");
    state.firebaseListeners.drivers = driversRef.on("value", (snapshot) => {
      const drivers = snapshot.val();
      if (!drivers) return;

      Object.keys(drivers).forEach((busId) => {
        if (busId === state.myBusId) return; // Skip my bus
        
        const driverData = drivers[busId];
        if (driverData && driverData.currentLocation) {
          // Merge with route info from BusLocation
          getLastLocationFromBusLocation(busId).then(locationData => {
            if (locationData) {
              const mergedData = {
                ...driverData.currentLocation,
                routeInfo: locationData.routeInfo,
                isMoving: locationData.isMoving || (driverData.currentLocation.speed > 5)
              };
              addOrUpdateBus(busId, mergedData);
            } else {
              addOrUpdateBus(busId, driverData.currentLocation);
            }
          });
        }
      });
    });

    console.log("[MultiBusMap] Listening to all buses from BusLocation and drivers");
  }

  /**
   * Stop listening to Firebase
   */
  function stopListening() {
    if (state.firebaseListeners.drivers) {
      const db = window.firebase.database();
      const driversRef = db.ref("drivers");
      driversRef.off("value", state.firebaseListeners.drivers);
      state.firebaseListeners.drivers = null;
    }
    if (state.firebaseListeners.busLocation) {
      const db = window.firebase.database();
      const busLocationRef = db.ref("BusLocation");
      busLocationRef.off("value", state.firebaseListeners.busLocation);
      state.firebaseListeners.busLocation = null;
    }
  }

  // ============================================================
  // PERIODIC UPDATES
  // ============================================================

  /**
   * Check online status of all buses periodically
   */
  function updateBusStatuses() {
    Object.keys(state.busMarkers).forEach((busId) => {
      const marker = state.busMarkers[busId];
      // Force re-render to update online/offline status
      // This will be handled by the Firebase listener
    });
  }

  /**
   * Start periodic status updates
   */
  function startPeriodicUpdates() {
    if (state.updateInterval) {
      clearInterval(state.updateInterval);
    }

    state.updateInterval = setInterval(() => {
      updateBusStatuses();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop periodic updates
   */
  function stopPeriodicUpdates() {
    if (state.updateInterval) {
      clearInterval(state.updateInterval);
      state.updateInterval = null;
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  window.MultiBusMap = {
    /**
     * Initialize multi-bus display
     * @param {Object} map - Leaflet map instance
     * @param {string} myBusId - Current driver's bus ID
     */
    initialize: function (map, myBusId) {
      if (!map) {
        console.error("[MultiBusMap] Map instance required");
        return false;
      }

      state.map = map;
      state.myBusId = myBusId;
      state.isEnabled = true;

      // Start listening to Firebase
      listenToAllBuses();

      // Start periodic updates
      startPeriodicUpdates();

      console.log(`[MultiBusMap] Initialized for bus: ${myBusId}`);
      return true;
    },

    /**
     * Stop multi-bus display
     */
    stop: function () {
      stopListening();
      stopPeriodicUpdates();

      // Remove all markers except my bus
      Object.keys(state.busMarkers).forEach((busId) => {
        if (busId !== state.myBusId) {
          removeBus(busId);
        }
      });

      state.isEnabled = false;
      console.log("[MultiBusMap] Stopped");
    },

    /**
     * Manually add/update a bus
     */
    addBus: function (busId, data) {
      addOrUpdateBus(busId, data);
    },

    /**
     * Manually remove a bus
     */
    removeBus: function (busId) {
      removeBus(busId);
    },

    /**
     * Get all bus markers
     */
    getBusMarkers: function () {
      return { ...state.busMarkers };
    },

    /**
     * Focus on specific bus
     */
    focusOnBus: function (busId) {
      const marker = state.busMarkers[busId];
      if (marker && state.map) {
        state.map.setView(marker.getLatLng(), 15, { animate: true });
        marker.openPopup();
      }
    },

    /**
     * Fit map to show all buses
     */
    fitAllBuses: function () {
      const markers = Object.values(state.busMarkers);
      if (markers.length === 0) return;

      const group = L.featureGroup(markers);
      state.map.fitBounds(group.getBounds(), { padding: [50, 50] });
    },

    /**
     * Get count of online buses
     */
    getOnlineCount: function () {
      return Object.keys(state.busMarkers).filter((busId) => {
        const marker = state.busMarkers[busId];
        return marker && marker._wasOnline;
      }).length;
    },

    /**
     * Get count of total buses
     */
    getTotalCount: function () {
      return Object.keys(state.busMarkers).length;
    },

    /**
     * Check if enabled
     */
    isEnabled: function () {
      return state.isEnabled;
    },

    /**
     * Set my bus ID
     */
    setMyBusId: function (busId) {
      state.myBusId = busId;
    },
  };

  console.log("[MultiBusMap] Module loaded");
})();
