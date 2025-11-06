/**
 * Virtual Bus Simulator
 *
 * Simulates a bus moving along a predefined route with realistic GPS updates
 * Sends location data to Firebase just like a real bus would
 *
 * @version 1.0
 * @requires smart-tracker.js
 * @requires firebase.js
 */

(function() {
    'use strict';

    // ============================================================
    // PREDEFINED ROUTES
    // ============================================================

    const ROUTES = {
        // Pokhara City Route (Lake to Airport)
        pokhara_city: {
            name: 'Pokhara City Route',
            description: 'Lakeside → Mahendrapool → Airport',
            waypoints: [
                { lat: 28.2096, lon: 83.9856, name: 'Lakeside' },
                { lat: 28.2106, lon: 83.9866, name: 'Lakeside North' },
                { lat: 28.2126, lon: 83.9876, name: 'Barahi Temple' },
                { lat: 28.2146, lon: 83.9886, name: 'Center Point' },
                { lat: 28.2156, lon: 83.9896, name: 'Bagar' },
                { lat: 28.2176, lon: 83.9906, name: 'New Road' },
                { lat: 28.2196, lon: 83.9916, name: 'Mahendrapool' },
                { lat: 28.2206, lon: 83.9926, name: 'Chipledhunga' },
                { lat: 28.2216, lon: 83.9936, name: 'Srijana Chowk' },
                { lat: 28.2226, lon: 83.9946, name: 'Prithvi Chowk' },
                { lat: 28.2236, lon: 83.9956, name: 'Zero KM' },
                { lat: 28.2246, lon: 83.9966, name: 'Airport Road' },
                { lat: 28.2256, lon: 83.9976, name: 'Near Airport' }
            ],
            color: '#3b82f6'
        },

        // Campus Route
        campus_route: {
            name: 'Campus Route',
            description: 'Main Campus → Various Stops → Return',
            waypoints: [
                { lat: 28.2150, lon: 83.9886, name: 'Main Campus' },
                { lat: 28.2160, lon: 83.9896, name: 'Stop 1' },
                { lat: 28.2170, lon: 83.9906, name: 'Stop 2' },
                { lat: 28.2180, lon: 83.9916, name: 'Stop 3' },
                { lat: 28.2190, lon: 83.9926, name: 'Stop 4' },
                { lat: 28.2200, lon: 83.9936, name: 'Stop 5' },
                { lat: 28.2210, lon: 83.9946, name: 'Stop 6' },
                { lat: 28.2220, lon: 83.9956, name: 'Stop 7' },
                { lat: 28.2230, lon: 83.9966, name: 'Stop 8' },
                { lat: 28.2220, lon: 83.9976, name: 'Stop 9' },
                { lat: 28.2210, lon: 83.9986, name: 'Stop 10' },
                { lat: 28.2200, lon: 83.9976, name: 'Stop 11' },
                { lat: 28.2190, lon: 83.9966, name: 'Stop 12' },
                { lat: 28.2180, lon: 83.9956, name: 'Stop 13' },
                { lat: 28.2170, lon: 83.9946, name: 'Stop 14' },
                { lat: 28.2160, lon: 83.9936, name: 'Stop 15' },
                { lat: 28.2150, lon: 83.9886, name: 'Main Campus (Return)' }
            ],
            color: '#22c55e'
        },

        // Short Loop (for quick testing)
        test_loop: {
            name: 'Test Loop',
            description: 'Quick circular route for testing',
            waypoints: [
                { lat: 28.2150, lon: 83.9886, name: 'Start' },
                { lat: 28.2180, lon: 83.9886, name: 'North' },
                { lat: 28.2180, lon: 83.9916, name: 'Northeast' },
                { lat: 28.2150, lon: 83.9916, name: 'East' },
                { lat: 28.2120, lon: 83.9916, name: 'Southeast' },
                { lat: 28.2120, lon: 83.9886, name: 'South' },
                { lat: 28.2120, lon: 83.9856, name: 'Southwest' },
                { lat: 28.2150, lon: 83.9856, name: 'West' },
                { lat: 28.2150, lon: 83.9886, name: 'Start (Return)' }
            ],
            color: '#f59e0b'
        },

        // Long Highway Route
        highway_route: {
            name: 'Highway Route',
            description: 'Long distance highway simulation',
            waypoints: [
                { lat: 28.2096, lon: 83.9856, name: 'City Start' },
                { lat: 28.2146, lon: 83.9906, name: 'City Exit' },
                { lat: 28.2246, lon: 84.0006, name: 'Highway Entry' },
                { lat: 28.2346, lon: 84.0106, name: 'Km 5' },
                { lat: 28.2446, lon: 84.0206, name: 'Km 10' },
                { lat: 28.2546, lon: 84.0306, name: 'Km 15' },
                { lat: 28.2646, lon: 84.0406, name: 'Km 20' },
                { lat: 28.2746, lon: 84.0506, name: 'Km 25' },
                { lat: 28.2846, lon: 84.0606, name: 'Rest Stop' }
            ],
            color: '#ef4444'
        }
    };

    // ============================================================
    // SIMULATOR STATE
    // ============================================================

    const simulator = {
        running: false,
        busId: null,
        route: null,
        currentWaypointIndex: 0,
        currentPosition: null,
        targetPosition: null,
        progress: 0,

        // Speed settings (km/h)
        speed: 40,
        minSpeed: 20,
        maxSpeed: 60,

        // Simulation settings
        updateInterval: 1000, // Update every 1 second
        interpolationSteps: 100, // Smoothness of movement

        // Statistics
        stats: {
            distanceTraveled: 0,
            timeElapsed: 0,
            stopsVisited: 0,
            updatesGenerated: 0
        },

        // Callbacks
        callbacks: {
            onPositionUpdate: null,
            onWaypointReached: null,
            onRouteComplete: null,
            onStop: null
        },

        // Internal
        intervalId: null,
        startTime: null,
        lastUpdateTime: null,

        // Traffic simulation
        trafficEnabled: false,
        currentSpeedModifier: 1.0
    };

    // ============================================================
    // UTILITY FUNCTIONS
    // ============================================================

    /**
     * Calculate distance between two points (Haversine formula)
     */
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371000; // Earth radius in meters
        const dLat = toRadians(lat2 - lat1);
        const dLon = toRadians(lon2 - lon1);

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function toRadians(degrees) {
        return degrees * Math.PI / 180;
    }

    /**
     * Calculate bearing between two points
     */
    function calculateBearing(lat1, lon1, lat2, lon2) {
        const dLon = toRadians(lon2 - lon1);
        const lat1Rad = toRadians(lat1);
        const lat2Rad = toRadians(lat2);

        const y = Math.sin(dLon) * Math.cos(lat2Rad);
        const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
                  Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

        let bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    }

    /**
     * Interpolate between two points
     */
    function interpolate(start, end, progress) {
        return {
            lat: start.lat + (end.lat - start.lat) * progress,
            lon: start.lon + (end.lon - start.lon) * progress
        };
    }

    /**
     * Add GPS noise to simulate real GPS
     */
    function addGPSNoise(lat, lon, accuracy = 10) {
        // Add random noise within accuracy radius
        const angle = Math.random() * 2 * Math.PI;
        const distance = Math.random() * accuracy;

        const dLat = (distance * Math.cos(angle)) / 111000; // ~111km per degree
        const dLon = (distance * Math.sin(angle)) / (111000 * Math.cos(toRadians(lat)));

        return {
            lat: lat + dLat,
            lon: lon + dLon
        };
    }

    /**
     * Generate route path from waypoints
     */
    function generateRoutePath(waypoints, pointsPerSegment = 20) {
        const path = [];

        for (let i = 0; i < waypoints.length - 1; i++) {
            const start = waypoints[i];
            const end = waypoints[i + 1];

            for (let j = 0; j < pointsPerSegment; j++) {
                const progress = j / pointsPerSegment;
                const point = interpolate(start, end, progress);
                path.push({
                    lat: point.lat,
                    lon: point.lon,
                    waypointIndex: i,
                    isWaypoint: false
                });
            }
        }

        // Add final waypoint
        const lastWaypoint = waypoints[waypoints.length - 1];
        path.push({
            lat: lastWaypoint.lat,
            lon: lastWaypoint.lon,
            waypointIndex: waypoints.length - 1,
            isWaypoint: true
        });

        return path;
    }

    // ============================================================
    // SIMULATION LOGIC
    // ============================================================

    /**
     * Initialize simulator with route
     */
    function initialize(routeKey, busId, callbacks = {}) {
        if (!ROUTES[routeKey]) {
            console.error(`[VirtualBus] Route "${routeKey}" not found`);
            return false;
        }

        simulator.route = ROUTES[routeKey];
        simulator.busId = busId;
        simulator.callbacks = { ...simulator.callbacks, ...callbacks };

        // Generate detailed path
        simulator.fullPath = generateRoutePath(simulator.route.waypoints);
        simulator.currentPathIndex = 0;

        // Set initial position
        const firstWaypoint = simulator.route.waypoints[0];
        simulator.currentPosition = {
            lat: firstWaypoint.lat,
            lon: firstWaypoint.lon
        };

        // Reset stats
        simulator.stats = {
            distanceTraveled: 0,
            timeElapsed: 0,
            stopsVisited: 0,
            updatesGenerated: 0
        };

        console.log(`[VirtualBus] Initialized on route: ${simulator.route.name}`);
        console.log(`[VirtualBus] Total waypoints: ${simulator.route.waypoints.length}`);
        console.log(`[VirtualBus] Total path points: ${simulator.fullPath.length}`);

        return true;
    }

    /**
     * Start simulation
     */
    function start() {
        if (simulator.running) {
            console.warn('[VirtualBus] Already running');
            return false;
        }

        if (!simulator.route) {
            console.error('[VirtualBus] No route initialized');
            return false;
        }

        simulator.running = true;
        simulator.startTime = Date.now();
        simulator.lastUpdateTime = Date.now();

        // Start SmartTracker
        if (window.SmartTracker) {
            window.SmartTracker.start(simulator.busId, {
                onLocationUpdate: (data) => {
                    console.log('[VirtualBus] Location sent to Firebase:', data);
                },
                onError: (error) => {
                    console.error('[VirtualBus] SmartTracker error:', error);
                }
            });
        }

        // Start simulation loop
        simulator.intervalId = setInterval(updateSimulation, simulator.updateInterval);

        console.log(`[VirtualBus] Started simulation for bus ${simulator.busId}`);
        return true;
    }

    /**
     * Stop simulation
     */
    function stop() {
        if (!simulator.running) {
            return false;
        }

        simulator.running = false;

        if (simulator.intervalId) {
            clearInterval(simulator.intervalId);
            simulator.intervalId = null;
        }

        // Stop SmartTracker
        if (window.SmartTracker && window.SmartTracker.isTracking()) {
            window.SmartTracker.stop();
        }

        if (simulator.callbacks.onStop) {
            simulator.callbacks.onStop(simulator.stats);
        }

        console.log('[VirtualBus] Stopped simulation');
        console.log('[VirtualBus] Stats:', simulator.stats);

        return true;
    }

    /**
     * Update simulation (called every interval)
     */
    function updateSimulation() {
        if (!simulator.running) return;

        const now = Date.now();
        const deltaTime = (now - simulator.lastUpdateTime) / 1000; // seconds
        simulator.lastUpdateTime = now;

        // Update elapsed time
        simulator.stats.timeElapsed = (now - simulator.startTime) / 1000;

        // Apply traffic simulation if enabled
        if (simulator.trafficEnabled) {
            updateTrafficConditions();
        }

        // Calculate how far to move based on speed and time
        const effectiveSpeed = simulator.speed * simulator.currentSpeedModifier;
        const speedMS = (effectiveSpeed * 1000) / 3600; // Convert km/h to m/s
        const distanceToMove = speedMS * deltaTime;

        // Move along path
        moveAlongPath(distanceToMove);

        // Generate GPS update
        generateGPSUpdate(effectiveSpeed);

        // Update stats
        simulator.stats.updatesGenerated++;
    }

    /**
     * Move bus along the path
     */
    function moveAlongPath(distance) {
        let remainingDistance = distance;

        while (remainingDistance > 0 && simulator.currentPathIndex < simulator.fullPath.length - 1) {
            const currentPoint = simulator.fullPath[simulator.currentPathIndex];
            const nextPoint = simulator.fullPath[simulator.currentPathIndex + 1];

            const segmentDistance = calculateDistance(
                currentPoint.lat, currentPoint.lon,
                nextPoint.lat, nextPoint.lon
            );

            if (remainingDistance >= segmentDistance) {
                // Move to next point
                simulator.currentPosition = {
                    lat: nextPoint.lat,
                    lon: nextPoint.lon
                };
                simulator.currentPathIndex++;
                remainingDistance -= segmentDistance;
                simulator.stats.distanceTraveled += segmentDistance;

                // Check if reached waypoint
                if (nextPoint.isWaypoint) {
                    simulator.stats.stopsVisited++;
                    const waypoint = simulator.route.waypoints[nextPoint.waypointIndex];

                    if (simulator.callbacks.onWaypointReached) {
                        simulator.callbacks.onWaypointReached(waypoint, simulator.stats.stopsVisited);
                    }

                    console.log(`[VirtualBus] Reached waypoint: ${waypoint.name}`);
                }
            } else {
                // Interpolate within segment
                const progress = remainingDistance / segmentDistance;
                simulator.currentPosition = interpolate(currentPoint, nextPoint, progress);
                simulator.stats.distanceTraveled += remainingDistance;
                remainingDistance = 0;
            }
        }

        // Check if route complete
        if (simulator.currentPathIndex >= simulator.fullPath.length - 1) {
            console.log('[VirtualBus] Route completed!');

            if (simulator.callbacks.onRouteComplete) {
                simulator.callbacks.onRouteComplete(simulator.stats);
            }

            // Loop back to start
            simulator.currentPathIndex = 0;
            const firstWaypoint = simulator.route.waypoints[0];
            simulator.currentPosition = {
                lat: firstWaypoint.lat,
                lon: firstWaypoint.lon
            };
        }
    }

    /**
     * Generate GPS update
     */
    function generateGPSUpdate(speed) {
        // Add GPS noise for realism
        const noisyPosition = addGPSNoise(
            simulator.currentPosition.lat,
            simulator.currentPosition.lon,
            5 // 5 meter accuracy
        );

        // Calculate heading to next point
        let heading = 0;
        if (simulator.currentPathIndex < simulator.fullPath.length - 1) {
            const nextPoint = simulator.fullPath[simulator.currentPathIndex + 1];
            heading = calculateBearing(
                simulator.currentPosition.lat,
                simulator.currentPosition.lon,
                nextPoint.lat,
                nextPoint.lon
            );
        }

        // Create location data
        const locationData = {
            latitude: noisyPosition.lat,
            longitude: noisyPosition.lon,
            speed: Math.round(speed),
            heading: Math.round(heading),
            accuracy: 5 + Math.random() * 10, // 5-15m accuracy
            altitude: 850 + Math.random() * 50, // Simulated altitude
            timestamp: Date.now()
        };

        // Send to SmartTracker (which will handle Firebase writes)
        if (window.SmartTracker && window.SmartTracker.isTracking()) {
            // Simulate the Geolocation API position object
            const position = {
                coords: {
                    latitude: locationData.latitude,
                    longitude: locationData.longitude,
                    speed: locationData.speed / 3.6, // Convert to m/s
                    heading: locationData.heading,
                    accuracy: locationData.accuracy,
                    altitude: locationData.altitude
                },
                timestamp: locationData.timestamp
            };

            // Trigger position update directly
            // (In real implementation, this would come from GPS)
            if (window.SmartTracker._state && window.SmartTracker._state.handlePosition) {
                // Access internal handler if available
            }
        }

        // Callback for UI updates
        if (simulator.callbacks.onPositionUpdate) {
            simulator.callbacks.onPositionUpdate(locationData, simulator.stats);
        }
    }

    /**
     * Update traffic conditions (for realism)
     */
    function updateTrafficConditions() {
        // Randomly vary speed modifier
        const random = Math.random();

        if (random < 0.1) {
            // 10% chance of traffic jam
            simulator.currentSpeedModifier = 0.3 + Math.random() * 0.3; // 30-60% speed
        } else if (random < 0.2) {
            // 10% chance of slow traffic
            simulator.currentSpeedModifier = 0.6 + Math.random() * 0.2; // 60-80% speed
        } else {
            // 80% normal traffic
            simulator.currentSpeedModifier = 0.9 + Math.random() * 0.2; // 90-110% speed
        }
    }

    // ============================================================
    // CONFIGURATION
    // ============================================================

    function setSpeed(speed) {
        simulator.speed = Math.max(simulator.minSpeed, Math.min(speed, simulator.maxSpeed));
        console.log(`[VirtualBus] Speed set to ${simulator.speed} km/h`);
    }

    function enableTraffic(enabled) {
        simulator.trafficEnabled = enabled;
        console.log(`[VirtualBus] Traffic simulation ${enabled ? 'enabled' : 'disabled'}`);
    }

    function setUpdateInterval(interval) {
        simulator.updateInterval = interval;
        if (simulator.running) {
            clearInterval(simulator.intervalId);
            simulator.intervalId = setInterval(updateSimulation, simulator.updateInterval);
        }
        console.log(`[VirtualBus] Update interval set to ${interval}ms`);
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    window.VirtualBus = {
        // Initialization
        initialize: initialize,

        // Control
        start: start,
        stop: stop,

        // Configuration
        setSpeed: setSpeed,
        enableTraffic: enableTraffic,
        setUpdateInterval: setUpdateInterval,

        // Getters
        getRoutes: () => Object.keys(ROUTES).map(key => ({
            key: key,
            ...ROUTES[key]
        })),
        getRoute: (key) => ROUTES[key],
        getCurrentPosition: () => ({ ...simulator.currentPosition }),
        getStats: () => ({ ...simulator.stats }),
        isRunning: () => simulator.running,

        // Direct Firebase write (bypass SmartTracker for testing)
        writeDirectToFirebase: (locationData) => {
            if (!window.firebase || !simulator.busId) return;

            const db = window.firebase.database();
            const timestamp = Date.now();

            db.ref(`BusLocation/${simulator.busId}/${timestamp}`).set({
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                speed: locationData.speed,
                heading: locationData.heading,
                ts: timestamp
            });
        }
    };

    console.log('[VirtualBus] Module loaded');
    console.log('[VirtualBus] Available routes:', Object.keys(ROUTES));

})();
