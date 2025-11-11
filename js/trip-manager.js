/**
 * Trip Management System
 *
 * Manages complete trip lifecycle for V-Track driver platform
 * Features:
 * - Start/End/Pause/Resume trips
 * - Distance tracking
 * - Stop management
 * - Student attendance
 * - Trip history
 *
 * @version 1.0
 * @author V-Track Team
 */

(function () {
  "use strict";

  // ============================================================
  // CONFIGURATION
  // ============================================================

  const CONFIG = {
    AUTO_END_AFTER_HOURS: 12, // Auto-end trip after 12 hours
    MIN_TRIP_DURATION: 60000, // Minimum 1 minute trip
    MAX_DISTANCE_KM: 500, // Maximum reasonable trip distance
  };

  // ============================================================
  // STATE MANAGEMENT
  // ============================================================

  const state = {
    currentTrip: null,
    isActive: false,
    lastLocation: null,
    totalDistance: 0,
    stops: [],
    studentsBoarded: [],
    studentsDropped: [],
    startTime: null,
    pausedTime: null,
    pauseDuration: 0,
  };

  // ============================================================
  // TRIP LIFECYCLE MANAGEMENT
  // ============================================================

  /**
   * Start a new trip
   */
  async function startTrip(busId, routeId, driverId) {
    if (state.isActive) {
      console.warn("[TripManager] Trip already active");
      return null;
    }

    // Validate inputs
    if (!busId) {
      throw new Error("Bus ID is required");
    }

    // Get driver ID from localStorage if not provided (driver login stores it there)
    if (!driverId) {
      try {
        driverId = localStorage.getItem("vtrack_driver_uid") || sessionStorage.getItem("driverId") || "driver_unknown";
      } catch (e) {
        driverId = "driver_unknown";
      }
    }

    // Fetch driver name from driverInfo
    let driverName = "Unknown Driver";
    if (driverId && driverId !== "driver_unknown") {
      try {
        const driverSnapshot = await firebase
          .database()
          .ref(`driverInfo/${driverId}`)
          .once("value");
        const driverData = driverSnapshot.val();
        if (driverData && driverData.name) {
          driverName = driverData.name;
        }
      } catch (error) {
        console.warn("[TripManager] Failed to fetch driver name:", error);
      }
    }

    // Get route ID from assignment if not provided
    if (!routeId) {
      routeId = await getAssignedRoute(busId);
    }

    // Get current location
    const startLocation = await getCurrentLocation();
    if (!startLocation) {
      throw new Error("Unable to get current location");
    }

    // Generate unique trip ID
    const tripId = `trip_${Date.now()}_${busId}`;
    const now = Date.now();

    // Get route details if routeId is provided
    let routeData = null;
    if (routeId && routeId !== "default_route") {
      try {
        const routeSnapshot = await firebase
          .database()
          .ref(`routes/${routeId}`)
          .once("value");
        const route = routeSnapshot.val();
        if (route) {
          routeData = {
            routeId: routeId,
            routeName: route.name || routeId,
            routeDescription: route.description || "",
            totalStops: (route.points || []).length,
          };
        }
      } catch (error) {
        console.warn("[TripManager] Failed to fetch route details:", error);
      }
    }

    // Create trip object
    const trip = {
      tripId: tripId,
      busId: busId,
      routeId: routeId || "default_route",
      routeName: routeData ? routeData.routeName : routeId || "Default Route",
      routeDescription: routeData ? routeData.routeDescription : "",
      driverId: driverId,
      driverName: driverName,
      startTime: now,
      startLocation: startLocation,
      status: "active",
      distance: 0,
      stops: [],
      studentsBoarded: [],
      studentsDropped: [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      // Write to Firebase - trips collection
      await firebase.database().ref(`trips/${busId}/${tripId}`).set(trip);

      // Mark as active trip
      await firebase.database().ref(`activeTrips/${busId}`).set({
        tripId: tripId,
        startTime: now,
        status: "active",
      });

      // Update bus status
      await firebase
        .database()
        .ref(`buses/${busId}/status`)
        .set({
          status: "on_trip",
          currentTrip: tripId,
          currentRoute: routeId || "default_route",
          currentRouteName: trip.routeName,
          updatedAt: now,
        });

      // Only GPS points will be written to BusLocation/{busId}/{timestamp} by location tracking logic during trip.

      // Update state
      state.currentTrip = trip;
      state.isActive = true;
      state.startTime = now;
      state.lastLocation = startLocation;
      state.totalDistance = 0;
      state.stops = [];
      state.studentsBoarded = [];
      state.studentsDropped = [];
      state.pausedTime = null;
      state.pauseDuration = 0;

      console.log("[TripManager] Trip started:", tripId);

      // Trigger callback
      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onTripStart
      ) {
        window.TripManagerCallbacks.onTripStart(trip);
      }

      // Start auto-save interval
      startAutoSave();

      return tripId;
    } catch (error) {
      console.error("[TripManager] Failed to start trip:", error);
      throw error;
    }
  }

  /**
   * End current trip
   */
  async function endTrip() {
    if (!state.isActive || !state.currentTrip) {
      console.warn("[TripManager] No active trip to end");
      return null;
    }

    const now = Date.now();
    const endLocation = await getCurrentLocation();
    const duration = now - state.startTime - state.pauseDuration;

    // Validate minimum trip duration
    if (duration < CONFIG.MIN_TRIP_DURATION) {
      throw new Error("Trip too short. Minimum duration is 1 minute.");
    }

    // Prepare trip summary
    const tripSummary = {
      endTime: now,
      endLocation: endLocation || state.lastLocation,
      duration: duration,
      distance: state.totalDistance,
      status: "completed",
      stops: state.stops,
      studentsBoarded: state.studentsBoarded,
      studentsDropped: state.studentsDropped,
      totalStops: state.stops.length,
      totalStudents: state.studentsBoarded.length,
      updatedAt: now,
    };

    try {
      // Update trip in Firebase
      await firebase
        .database()
        .ref(`trips/${state.currentTrip.busId}/${state.currentTrip.tripId}`)
        .update(tripSummary);

      // Remove from active trips
      await firebase
        .database()
        .ref(`activeTrips/${state.currentTrip.busId}`)
        .remove();

      // Update bus status
      await firebase
        .database()
        .ref(`buses/${state.currentTrip.busId}/status`)
        .set({
          status: "idle",
          currentTrip: null,
          lastTrip: state.currentTrip.tripId,
          updatedAt: now,
        });

      // Save to trip history
      const tripHistoryData = {
        ...state.currentTrip,
        ...tripSummary,
      };
      await firebase
        .database()
        .ref(
          `tripHistory/${state.currentTrip.busId}/${state.currentTrip.tripId}`,
        )
        .set(tripHistoryData);

      // Also save to tripHistory/drivers/{driverId} for driver-specific history
      if (state.currentTrip.driverId && state.currentTrip.driverId !== "driver_unknown") {
        await firebase
          .database()
          .ref(
            `tripHistory/drivers/${state.currentTrip.driverId}/${state.currentTrip.tripId}`,
          )
          .set(tripHistoryData);
      }

      console.log("[TripManager] Trip ended:", state.currentTrip.tripId);
      console.log("[TripManager] Trip summary:", tripSummary);

      // Trigger callback
      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onTripEnd
      ) {
        window.TripManagerCallbacks.onTripEnd(tripSummary);
      }

      // Stop auto-save
      stopAutoSave();

      // Reset state
      const completedTrip = { ...state.currentTrip, ...tripSummary };
      state.currentTrip = null;
      state.isActive = false;
      state.lastLocation = null;
      state.totalDistance = 0;
      state.stops = [];
      state.studentsBoarded = [];
      state.studentsDropped = [];
      state.startTime = null;
      state.pausedTime = null;
      state.pauseDuration = 0;

      return completedTrip;
    } catch (error) {
      console.error("[TripManager] Failed to end trip:", error);
      throw error;
    }
  }

  /**
   * Pause current trip
   */
  async function pauseTrip(reason) {
    if (!state.isActive || !state.currentTrip) {
      throw new Error("No active trip to pause");
    }

    if (state.currentTrip.status === "paused") {
      console.warn("[TripManager] Trip already paused");
      return;
    }

    const now = Date.now();

    try {
      await firebase
        .database()
        .ref(`trips/${state.currentTrip.busId}/${state.currentTrip.tripId}`)
        .update({
          status: "paused",
          pausedAt: now,
          pauseReason: reason || "Driver initiated",
          updatedAt: now,
        });

      state.currentTrip.status = "paused";
      state.pausedTime = now;

      console.log("[TripManager] Trip paused");

      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onTripPause
      ) {
        window.TripManagerCallbacks.onTripPause();
      }
    } catch (error) {
      console.error("[TripManager] Failed to pause trip:", error);
      throw error;
    }
  }

  /**
   * Resume paused trip
   */
  async function resumeTrip() {
    if (!state.isActive || !state.currentTrip) {
      throw new Error("No trip to resume");
    }

    if (state.currentTrip.status !== "paused") {
      console.warn("[TripManager] Trip is not paused");
      return;
    }

    const now = Date.now();
    const pauseLength = now - state.pausedTime;
    state.pauseDuration += pauseLength;

    try {
      await firebase
        .database()
        .ref(`trips/${state.currentTrip.busId}/${state.currentTrip.tripId}`)
        .update({
          status: "active",
          resumedAt: now,
          pauseDuration: state.pauseDuration,
          updatedAt: now,
        });

      state.currentTrip.status = "active";
      state.pausedTime = null;

      console.log("[TripManager] Trip resumed");

      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onTripResume
      ) {
        window.TripManagerCallbacks.onTripResume();
      }
    } catch (error) {
      console.error("[TripManager] Failed to resume trip:", error);
      throw error;
    }
  }

  // ============================================================
  // DISTANCE TRACKING
  // ============================================================

  /**
   * Update distance traveled
   */
  function updateDistance(newLocation) {
    if (!state.isActive || !state.lastLocation) {
      return;
    }

    // Don't update distance when paused
    if (state.currentTrip && state.currentTrip.status === "paused") {
      return;
    }

    const distance = calculateDistance(
      state.lastLocation.latitude,
      state.lastLocation.longitude,
      newLocation.latitude,
      newLocation.longitude,
    );

    // Validate distance (filter unrealistic jumps)
    if (distance > 1000) {
      // More than 1km jump
      console.warn(
        "[TripManager] Distance jump too large, ignoring:",
        distance,
      );
      return;
    }

    state.totalDistance += distance / 1000; // Convert to km
    state.lastLocation = newLocation;

    // Update in Firebase periodically (every 10 updates or 1km)
    if (state.totalDistance % 1 < 0.1) {
      // Roughly every 1km
      updateTripDistance();
    }
  }

  /**
   * Update trip distance in Firebase
   */
  async function updateTripDistance() {
    if (!state.isActive || !state.currentTrip) return;

    try {
      await firebase
        .database()
        .ref(
          `trips/${state.currentTrip.busId}/${state.currentTrip.tripId}/distance`,
        )
        .set(Math.round(state.totalDistance * 100) / 100); // Round to 2 decimals
    } catch (error) {
      console.error("[TripManager] Failed to update distance:", error);
    }
  }

  /**
   * Calculate distance between two points (Haversine formula)
   */
  function calculateDistance(lat1, lon1, lat2, lon2) {
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

  // ============================================================
  // STOP MANAGEMENT
  // ============================================================

  /**
   * Mark stop visited
   */
  async function markStop(stopId, stopName, location) {
    if (!state.isActive || !state.currentTrip) {
      throw new Error("No active trip");
    }

    const now = Date.now();
    const stopData = {
      stopId: stopId,
      stopName: stopName,
      location: location || (await getCurrentLocation()),
      timestamp: now,
      studentsBoarded: [],
      studentsDropped: [],
    };

    state.stops.push(stopData);

    try {
      await firebase
        .database()
        .ref(
          `trips/${state.currentTrip.busId}/${state.currentTrip.tripId}/stops`,
        )
        .push(stopData);

      console.log("[TripManager] Stop marked:", stopName);

      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onStopReached
      ) {
        window.TripManagerCallbacks.onStopReached(stopData);
      }

      return stopData;
    } catch (error) {
      console.error("[TripManager] Failed to mark stop:", error);
      throw error;
    }
  }

  // ============================================================
  // STUDENT MANAGEMENT
  // ============================================================

  /**
   * Mark student boarded
   */
  async function markStudentBoarded(studentId, studentName, stopId) {
    if (!state.isActive || !state.currentTrip) {
      throw new Error("No active trip");
    }

    const now = Date.now();
    const boardingData = {
      studentId: studentId,
      studentName: studentName,
      stopId: stopId,
      timestamp: now,
      location: await getCurrentLocation(),
    };

    state.studentsBoarded.push(boardingData);

    try {
      await firebase
        .database()
        .ref(
          `trips/${state.currentTrip.busId}/${state.currentTrip.tripId}/studentsBoarded/${studentId}`,
        )
        .set(boardingData);

      // Update student status
      await firebase
        .database()
        .ref(`students/${studentId}/status`)
        .set("onboard");

      console.log("[TripManager] Student boarded:", studentName);

      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onStudentBoarded
      ) {
        window.TripManagerCallbacks.onStudentBoarded(boardingData);
      }

      return boardingData;
    } catch (error) {
      console.error("[TripManager] Failed to mark student boarded:", error);
      throw error;
    }
  }

  /**
   * Mark student dropped off
   */
  async function markStudentDropped(studentId, studentName, stopId) {
    if (!state.isActive || !state.currentTrip) {
      throw new Error("No active trip");
    }

    const now = Date.now();
    const dropoffData = {
      studentId: studentId,
      studentName: studentName,
      stopId: stopId,
      timestamp: now,
      location: await getCurrentLocation(),
    };

    state.studentsDropped.push(dropoffData);

    try {
      await firebase
        .database()
        .ref(
          `trips/${state.currentTrip.busId}/${state.currentTrip.tripId}/studentsDropped/${studentId}`,
        )
        .set(dropoffData);

      // Update student status
      await firebase.database().ref(`students/${studentId}/status`).set("home");

      console.log("[TripManager] Student dropped off:", studentName);

      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onStudentDropped
      ) {
        window.TripManagerCallbacks.onStudentDropped(dropoffData);
      }

      return dropoffData;
    } catch (error) {
      console.error("[TripManager] Failed to mark student dropped:", error);
      throw error;
    }
  }

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  /**
   * Get current location
   */
  function getCurrentLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp || Date.now(),
          });
        },
        (error) => {
          console.warn("[TripManager] Location error:", error);
          resolve(null);
        },
        { timeout: 5000, maximumAge: 10000 },
      );
    });
  }

  /**
   * End current trip
   */
  async function endTrip() {
    if (!state.isActive || !state.currentTrip) {
      console.warn("[TripManager] No active trip to end");
      return null;
    }

    const now = Date.now();
    const endLocation = await getCurrentLocation();
    const duration = now - state.startTime - state.pauseDuration;

    // Validate minimum trip duration
    if (duration < CONFIG.MIN_TRIP_DURATION) {
      throw new Error("Trip too short. Minimum duration is 1 minute.");
    }

    // Prepare trip summary
    const tripSummary = {
      endTime: now,
      endLocation: endLocation || state.lastLocation,
      duration: duration,
      distance: state.totalDistance,
      status: "completed",
      stops: state.stops,
      studentsBoarded: state.studentsBoarded,
      studentsDropped: state.studentsDropped,
      totalStops: state.stops.length,
      totalStudents: state.studentsBoarded.length,
      updatedAt: now,
    };

    try {
      // Update trip in Firebase
      await firebase
        .database()
        .ref(`trips/${state.currentTrip.busId}/${state.currentTrip.tripId}`)
        .update(tripSummary);

      // Remove from active trips
      await firebase
        .database()
        .ref(`activeTrips/${state.currentTrip.busId}`)
        .remove();

      // Update bus status
      await firebase
        .database()
        .ref(`buses/${state.currentTrip.busId}/status`)
        .set({
          status: "idle",
          currentTrip: null,
          lastTrip: state.currentTrip.tripId,
          updatedAt: now,
        });

      // Save to trip history (by busId)
      await firebase
        .database()
        .ref(
          `tripHistory/${state.currentTrip.busId}/${state.currentTrip.tripId}`,
        )
        .set({
          ...state.currentTrip,
          ...tripSummary,
        });

      // Also save to trip history by driverId for easy querying
      if (state.currentTrip.driverId) {
        await firebase
          .database()
          .ref(
            `tripHistory/drivers/${state.currentTrip.driverId}/${state.currentTrip.tripId}`,
          )
          .set({
            ...state.currentTrip,
            ...tripSummary,
          });
      }

      console.log("[TripManager] Trip ended:", state.currentTrip.tripId);
      console.log("[TripManager] Trip summary:", tripSummary);

      // Trigger callback
      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onTripEnd
      ) {
        window.TripManagerCallbacks.onTripEnd(tripSummary);
      }

      // Stop auto-save
      stopAutoSave();

      // Reset state
      const completedTrip = { ...state.currentTrip, ...tripSummary };
      state.currentTrip = null;
      state.isActive = false;
      state.lastLocation = null;
      state.totalDistance = 0;
      state.stops = [];
      state.studentsBoarded = [];
      state.studentsDropped = [];
      state.startTime = null;
      state.pausedTime = null;
      state.pauseDuration = 0;

      return completedTrip;
    } catch (error) {
      console.error("[TripManager] Failed to end trip:", error);
      throw error;
    }
  }

  /**
   * Pause current trip
   */
  async function pauseTrip(reason) {
    if (!state.isActive || !state.currentTrip) {
      throw new Error("No active trip to pause");
    }

    if (state.currentTrip.status === "paused") {
      console.warn("[TripManager] Trip already paused");
      return;
    }

    const now = Date.now();

    try {
      await firebase
        .database()
        .ref(`trips/${state.currentTrip.busId}/${state.currentTrip.tripId}`)
        .update({
          status: "paused",
          pausedAt: now,
          pauseReason: reason || "Driver initiated",
          updatedAt: now,
        });

      state.currentTrip.status = "paused";
      state.pausedTime = now;

      console.log("[TripManager] Trip paused");

      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onTripPause
      ) {
        window.TripManagerCallbacks.onTripPause();
      }
    } catch (error) {
      console.error("[TripManager] Failed to pause trip:", error);
      throw error;
    }
  }

  /**
   * Resume paused trip
   */
  async function resumeTrip() {
    if (!state.isActive || !state.currentTrip) {
      throw new Error("No trip to resume");
    }

    if (state.currentTrip.status !== "paused") {
      console.warn("[TripManager] Trip is not paused");
      return;
    }

    const now = Date.now();
    const pauseLength = now - state.pausedTime;
    state.pauseDuration += pauseLength;

    try {
      await firebase
        .database()
        .ref(`trips/${state.currentTrip.busId}/${state.currentTrip.tripId}`)
        .update({
          status: "active",
          resumedAt: now,
          pauseDuration: state.pauseDuration,
          updatedAt: now,
        });

      state.currentTrip.status = "active";
      state.pausedTime = null;

      console.log("[TripManager] Trip resumed");

      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onTripResume
      ) {
        window.TripManagerCallbacks.onTripResume();
      }
    } catch (error) {
      console.error("[TripManager] Failed to resume trip:", error);
      throw error;
    }
  }

  // ============================================================
  // DISTANCE TRACKING
  // ============================================================

  /**
   * Update distance traveled
   */
  function updateDistance(newLocation) {
    if (!state.isActive || !state.lastLocation) {
      return;
    }

    // Don't update distance when paused
    if (state.currentTrip && state.currentTrip.status === "paused") {
      return;
    }

    const distance = calculateDistance(
      state.lastLocation.latitude,
      state.lastLocation.longitude,
      newLocation.latitude,
      newLocation.longitude,
    );

    // Validate distance (filter unrealistic jumps)
    if (distance > 1000) {
      // More than 1km jump
      console.warn(
        "[TripManager] Distance jump too large, ignoring:",
        distance,
      );
      return;
    }

    state.totalDistance += distance / 1000; // Convert to km
    state.lastLocation = newLocation;

    // Update in Firebase periodically (every 10 updates or 1km)
    if (state.totalDistance % 1 < 0.1) {
      // Roughly every 1km
      updateTripDistance();
    }
  }

  /**
   * Update trip distance in Firebase
   */
  async function updateTripDistance() {
    if (!state.isActive || !state.currentTrip) return;

    try {
      await firebase
        .database()
        .ref(
          `trips/${state.currentTrip.busId}/${state.currentTrip.tripId}/distance`,
        )
        .set(Math.round(state.totalDistance * 100) / 100); // Round to 2 decimals
    } catch (error) {
      console.error("[TripManager] Failed to update distance:", error);
    }
  }

  /**
   * Calculate distance between two points (Haversine formula)
   */
  function calculateDistance(lat1, lon1, lat2, lon2) {
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

  // ============================================================
  // STOP MANAGEMENT
  // ============================================================

  /**
   * Mark stop visited
   */
  async function markStop(stopId, stopName, location) {
    if (!state.isActive || !state.currentTrip) {
      throw new Error("No active trip");
    }

    const now = Date.now();
    const stopData = {
      stopId: stopId,
      stopName: stopName,
      location: location || (await getCurrentLocation()),
      timestamp: now,
      studentsBoarded: [],
      studentsDropped: [],
    };

    state.stops.push(stopData);

    try {
      await firebase
        .database()
        .ref(
          `trips/${state.currentTrip.busId}/${state.currentTrip.tripId}/stops`,
        )
        .push(stopData);

      console.log("[TripManager] Stop marked:", stopName);

      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onStopReached
      ) {
        window.TripManagerCallbacks.onStopReached(stopData);
      }

      return stopData;
    } catch (error) {
      console.error("[TripManager] Failed to mark stop:", error);
      throw error;
    }
  }

  // ============================================================
  // STUDENT MANAGEMENT
  // ============================================================

  /**
   * Mark student boarded
   */
  async function markStudentBoarded(studentId, studentName, stopId) {
    if (!state.isActive || !state.currentTrip) {
      throw new Error("No active trip");
    }

    const now = Date.now();
    const boardingData = {
      studentId: studentId,
      studentName: studentName,
      stopId: stopId,
      timestamp: now,
      location: await getCurrentLocation(),
    };

    state.studentsBoarded.push(boardingData);

    try {
      await firebase
        .database()
        .ref(
          `trips/${state.currentTrip.busId}/${state.currentTrip.tripId}/studentsBoarded/${studentId}`,
        )
        .set(boardingData);

      // Update student status
      await firebase
        .database()
        .ref(`students/${studentId}/status`)
        .set("onboard");

      console.log("[TripManager] Student boarded:", studentName);

      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onStudentBoarded
      ) {
        window.TripManagerCallbacks.onStudentBoarded(boardingData);
      }

      return boardingData;
    } catch (error) {
      console.error("[TripManager] Failed to mark student boarded:", error);
      throw error;
    }
  }

  /**
   * Mark student dropped off
   */
  async function markStudentDropped(studentId, studentName, stopId) {
    if (!state.isActive || !state.currentTrip) {
      throw new Error("No active trip");
    }

    const now = Date.now();
    const dropoffData = {
      studentId: studentId,
      studentName: studentName,
      stopId: stopId,
      timestamp: now,
      location: await getCurrentLocation(),
    };

    state.studentsDropped.push(dropoffData);

    try {
      await firebase
        .database()
        .ref(
          `trips/${state.currentTrip.busId}/${state.currentTrip.tripId}/studentsDropped/${studentId}`,
        )
        .set(dropoffData);

      // Update student status
      await firebase.database().ref(`students/${studentId}/status`).set("home");

      console.log("[TripManager] Student dropped off:", studentName);

      if (
        window.TripManagerCallbacks &&
        window.TripManagerCallbacks.onStudentDropped
      ) {
        window.TripManagerCallbacks.onStudentDropped(dropoffData);
      }

      return dropoffData;
    } catch (error) {
      console.error("[TripManager] Failed to mark student dropped:", error);
      throw error;
    }
  }

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  /**
   * Get current location
   */
  function getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by this browser."));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp || Date.now(),
          });
        },
        (error) => {
          let errorMessage = "Unable to retrieve location.";
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorMessage =
                "Location permission denied. Please enable location services.";
              break;
            case error.POSITION_UNAVAILABLE:
              errorMessage = "Location information is unavailable.";
              break;
            case error.TIMEOUT:
              errorMessage = "The request to get user location timed out.";
              break;
          }
          console.warn("[TripManager] Location error:", error.message);
          reject(new Error(errorMessage));
        },
        { timeout: 10000, maximumAge: 0, enableHighAccuracy: true },
      );
    });
  }

  /**
   * Get assigned route for bus
   */
  async function getAssignedRoute(busId) {
    try {
      const snapshot = await firebase
        .database()
        .ref(`busAssignments/${busId}/routeId`)
        .once("value");

      return snapshot.val() || null;
    } catch (error) {
      console.warn("[TripManager] Failed to get assigned route:", error);
      return null;
    }
  }

  /**
   * Load active trip from Firebase (on page reload)
   */
  async function loadActiveTrip(busId) {
    try {
      const snapshot = await firebase
        .database()
        .ref(`activeTrips/${busId}`)
        .once("value");

      const activeTrip = snapshot.val();
      if (!activeTrip) {
        return null;
      }

      // Load full trip details
      const tripSnapshot = await firebase
        .database()
        .ref(`trips/${busId}/${activeTrip.tripId}`)
        .once("value");

      const trip = tripSnapshot.val();
      if (trip) {
        state.currentTrip = trip;
        state.isActive = true;
        state.startTime = trip.startTime;
        state.totalDistance = trip.distance || 0;
        state.lastLocation = trip.startLocation;

        console.log("[TripManager] Active trip loaded:", trip.tripId);
        return trip;
      }

      return null;
    } catch (error) {
      console.error("[TripManager] Failed to load active trip:", error);
      return null;
    }
  }

  // ============================================================
  // AUTO-SAVE & MONITORING
  // ============================================================

  let autoSaveInterval = null;

  /**
   * Start auto-save interval
   */
  function startAutoSave() {
    if (autoSaveInterval) {
      clearInterval(autoSaveInterval);
    }

    // Auto-save every 5 minutes
    autoSaveInterval = setInterval(() => {
      if (state.isActive && state.currentTrip) {
        saveProgress();
      }
    }, 300000); // 5 minutes
  }

  /**
   * Stop auto-save interval
   */
  function stopAutoSave() {
    if (autoSaveInterval) {
      clearInterval(autoSaveInterval);
      autoSaveInterval = null;
    }
  }

  /**
   * Save trip progress
   */
  async function saveProgress() {
    if (!state.isActive || !state.currentTrip) return;

    try {
      await firebase
        .database()
        .ref(`trips/${state.currentTrip.busId}/${state.currentTrip.tripId}`)
        .update({
          distance: state.totalDistance,
          updatedAt: Date.now(),
        });

      console.log("[TripManager] Progress saved");
    } catch (error) {
      console.error("[TripManager] Failed to save progress:", error);
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  window.TripManager = {
    // Trip lifecycle
    startTrip: startTrip,
    endTrip: endTrip,
    pauseTrip: pauseTrip,
    resumeTrip: resumeTrip,

    // Distance tracking
    updateDistance: updateDistance,

    // Stop management
    markStop: markStop,

    // Student management
    markStudentBoarded: markStudentBoarded,
    markStudentDropped: markStudentDropped,

    // Utility
    loadActiveTrip: loadActiveTrip,
    getCurrentLocation: getCurrentLocation,

    // Getters
    getCurrentTrip: () => state.currentTrip,
    isActive: () => state.isActive,
    getTotalDistance: () => state.totalDistance,
    getStops: () => [...state.stops],
    getStudentsBoarded: () => [...state.studentsBoarded],
    getStudentsDropped: () => [...state.studentsDropped],

    // State
    getState: () => ({
      currentTrip: state.currentTrip,
      isActive: state.isActive,
      totalDistance: state.totalDistance,
      stops: state.stops.length,
      studentsBoarded: state.studentsBoarded.length,
      studentsDropped: state.studentsDropped.length,
    }),
  };

  // Expose callbacks object for external listeners
  window.TripManagerCallbacks = window.TripManagerCallbacks || {};

  console.log("[TripManager] Module loaded v1.0");
})();
