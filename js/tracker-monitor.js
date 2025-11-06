/**
 * Smart Tracker Monitor
 *
 * Real-time monitoring and analytics dashboard for GPS tracking performance
 * Provides debugging tools, performance metrics, and visual feedback
 *
 * @version 1.0
 * @requires smart-tracker.js
 */

(function() {
    'use strict';

    // Monitor state
    const monitor = {
        enabled: false,
        startTime: null,
        logs: [],
        maxLogs: 100,

        // Performance metrics
        metrics: {
            gpsReadings: 0,
            acceptedPoints: 0,
            rejectedPoints: 0,
            heartbeats: 0,
            errors: 0,

            // Timing
            avgUpdateInterval: 0,
            lastUpdateTime: 0,
            updateIntervals: [],

            // Movement
            totalDistance: 0,
            avgSpeed: 0,
            maxSpeed: 0,

            // Firebase
            firebaseWrites: 0,
            firebaseErrors: 0,
            firebaseLatency: [],

            // GPS quality
            avgAccuracy: 0,
            accuracyReadings: [],
            poorAccuracyCount: 0
        },

        // Real-time data
        realtime: {
            currentSpeed: 0,
            currentHeading: 0,
            currentAccuracy: 0,
            lastPosition: null,
            isMoving: false,
            isIdle: false
        },

        // Callbacks
        callbacks: {
            onMetricsUpdate: null,
            onLog: null,
            onAlert: null
        }
    };

    /**
     * Initialize monitor
     */
    function initialize() {
        if (monitor.enabled) {
            console.warn('[TrackerMonitor] Already initialized');
            return false;
        }

        monitor.enabled = true;
        monitor.startTime = Date.now();

        // Hook into SmartTracker if available
        if (window.SmartTracker) {
            hookIntoTracker();
        }

        addLog('info', 'Monitor initialized');
        return true;
    }

    /**
     * Hook into SmartTracker events
     */
    function hookIntoTracker() {
        // Store original methods
        const originalStart = window.SmartTracker.start;
        const originalStop = window.SmartTracker.stop;

        // Wrap start method
        window.SmartTracker.start = function(busId, callbacks = {}) {
            // Wrap callbacks to monitor them
            const wrappedCallbacks = {
                onLocationUpdate: (data) => {
                    handleLocationUpdate(data);
                    if (callbacks.onLocationUpdate) {
                        callbacks.onLocationUpdate(data);
                    }
                },
                onError: (error) => {
                    handleError(error);
                    if (callbacks.onError) {
                        callbacks.onError(error);
                    }
                },
                onStatusChange: (status, message) => {
                    handleStatusChange(status, message);
                    if (callbacks.onStatusChange) {
                        callbacks.onStatusChange(status, message);
                    }
                }
            };

            monitor.metrics.gpsReadings = 0;
            addLog('success', `Tracking started for ${busId}`);

            return originalStart.call(this, busId, wrappedCallbacks);
        };

        // Wrap stop method
        window.SmartTracker.stop = function() {
            const result = originalStop.call(this);
            if (result) {
                generateReport();
                addLog('warning', 'Tracking stopped');
            }
            return result;
        };
    }

    /**
     * Handle location update
     */
    function handleLocationUpdate(data) {
        monitor.metrics.gpsReadings++;
        monitor.metrics.acceptedPoints++;
        monitor.metrics.firebaseWrites++;

        // Update timing
        const now = Date.now();
        if (monitor.metrics.lastUpdateTime > 0) {
            const interval = now - monitor.metrics.lastUpdateTime;
            monitor.metrics.updateIntervals.push(interval);
            if (monitor.metrics.updateIntervals.length > 20) {
                monitor.metrics.updateIntervals.shift();
            }
            monitor.metrics.avgUpdateInterval =
                monitor.metrics.updateIntervals.reduce((a, b) => a + b, 0) /
                monitor.metrics.updateIntervals.length;
        }
        monitor.metrics.lastUpdateTime = now;

        // Update distance
        if (monitor.realtime.lastPosition) {
            const distance = calculateDistance(
                monitor.realtime.lastPosition.latitude,
                monitor.realtime.lastPosition.longitude,
                data.latitude,
                data.longitude
            );
            monitor.metrics.totalDistance += distance;
        }

        // Update speed
        monitor.realtime.currentSpeed = data.speed || 0;
        monitor.metrics.avgSpeed =
            (monitor.metrics.avgSpeed * (monitor.metrics.acceptedPoints - 1) + data.speed) /
            monitor.metrics.acceptedPoints;
        monitor.metrics.maxSpeed = Math.max(monitor.metrics.maxSpeed, data.speed);

        // Update accuracy
        if (data.accuracy) {
            monitor.realtime.currentAccuracy = data.accuracy;
            monitor.metrics.accuracyReadings.push(data.accuracy);
            if (monitor.metrics.accuracyReadings.length > 20) {
                monitor.metrics.accuracyReadings.shift();
            }
            monitor.metrics.avgAccuracy =
                monitor.metrics.accuracyReadings.reduce((a, b) => a + b, 0) /
                monitor.metrics.accuracyReadings.length;

            if (data.accuracy > 50) {
                monitor.metrics.poorAccuracyCount++;
            }
        }

        // Update position
        monitor.realtime.lastPosition = {
            latitude: data.latitude,
            longitude: data.longitude,
            timestamp: data.ts
        };
        monitor.realtime.currentHeading = data.heading || 0;

        addLog('info', `Location recorded: Speed ${data.speed} km/h, Accuracy ${data.accuracy?.toFixed(1) || 'N/A'}m`);
        notifyMetricsUpdate();
    }

    /**
     * Handle error
     */
    function handleError(error) {
        monitor.metrics.errors++;
        monitor.metrics.firebaseErrors++;
        addLog('error', `Error: ${error.message}`);

        if (monitor.callbacks.onAlert) {
            monitor.callbacks.onAlert('error', error.message);
        }

        notifyMetricsUpdate();
    }

    /**
     * Handle status change
     */
    function handleStatusChange(status, message) {
        addLog('info', `Status: ${status} - ${message}`);

        // Update movement state
        const state = window.SmartTracker?.getState();
        if (state) {
            monitor.realtime.isMoving = state.isMoving;
            monitor.realtime.isIdle = state.isIdle;
        }
    }

    /**
     * Calculate distance between two points (Haversine)
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
     * Add log entry
     */
    function addLog(level, message) {
        const entry = {
            timestamp: Date.now(),
            level: level,
            message: message
        };

        monitor.logs.push(entry);

        // Trim logs if too many
        if (monitor.logs.length > monitor.maxLogs) {
            monitor.logs.shift();
        }

        if (monitor.callbacks.onLog) {
            monitor.callbacks.onLog(entry);
        }
    }

    /**
     * Notify metrics update
     */
    function notifyMetricsUpdate() {
        if (monitor.callbacks.onMetricsUpdate) {
            monitor.callbacks.onMetricsUpdate(getMetrics());
        }
    }

    /**
     * Generate performance report
     */
    function generateReport() {
        const duration = Date.now() - monitor.startTime;
        const durationMinutes = duration / 60000;

        const report = {
            summary: {
                duration: formatDuration(duration),
                totalReadings: monitor.metrics.gpsReadings,
                acceptedPoints: monitor.metrics.acceptedPoints,
                rejectedPoints: monitor.metrics.rejectedPoints,
                acceptanceRate: ((monitor.metrics.acceptedPoints / monitor.metrics.gpsReadings) * 100).toFixed(1) + '%'
            },

            movement: {
                totalDistance: (monitor.metrics.totalDistance / 1000).toFixed(2) + ' km',
                avgSpeed: monitor.metrics.avgSpeed.toFixed(1) + ' km/h',
                maxSpeed: monitor.metrics.maxSpeed.toFixed(1) + ' km/h'
            },

            performance: {
                avgUpdateInterval: (monitor.metrics.avgUpdateInterval / 1000).toFixed(1) + 's',
                firebaseWrites: monitor.metrics.firebaseWrites,
                writesPerMinute: (monitor.metrics.firebaseWrites / durationMinutes).toFixed(1),
                errors: monitor.metrics.errors
            },

            gpsQuality: {
                avgAccuracy: monitor.metrics.avgAccuracy.toFixed(1) + 'm',
                poorAccuracyCount: monitor.metrics.poorAccuracyCount,
                qualityScore: calculateQualityScore() + '%'
            },

            efficiency: {
                dataReduction: calculateDataReduction() + '%',
                estimatedOldWrites: estimateOldSystemWrites(duration),
                actualWrites: monitor.metrics.firebaseWrites,
                saved: estimateOldSystemWrites(duration) - monitor.metrics.firebaseWrites
            }
        };

        console.group('📊 Tracking Session Report');
        console.log('Duration:', report.summary.duration);
        console.log('Total GPS Readings:', report.summary.totalReadings);
        console.log('Accepted Points:', report.summary.acceptedPoints);
        console.log('Acceptance Rate:', report.summary.acceptanceRate);
        console.log('\n📍 Movement:');
        console.log('Total Distance:', report.movement.totalDistance);
        console.log('Average Speed:', report.movement.avgSpeed);
        console.log('Max Speed:', report.movement.maxSpeed);
        console.log('\n⚡ Performance:');
        console.log('Avg Update Interval:', report.performance.avgUpdateInterval);
        console.log('Firebase Writes:', report.performance.firebaseWrites);
        console.log('Writes/Minute:', report.performance.writesPerMinute);
        console.log('\n✨ Efficiency:');
        console.log('Data Reduction:', report.efficiency.dataReduction);
        console.log('Old System (estimated):', report.efficiency.estimatedOldWrites, 'writes');
        console.log('Smart Tracker:', report.efficiency.actualWrites, 'writes');
        console.log('Saved:', report.efficiency.saved, 'writes');
        console.groupEnd();

        addLog('success', 'Session report generated');

        return report;
    }

    /**
     * Calculate quality score
     */
    function calculateQualityScore() {
        if (monitor.metrics.gpsReadings === 0) return 100;

        const accuracyScore = Math.max(0, 100 - (monitor.metrics.avgAccuracy / 50 * 100));
        const errorScore = Math.max(0, 100 - (monitor.metrics.errors / monitor.metrics.gpsReadings * 100));
        const acceptanceScore = (monitor.metrics.acceptedPoints / monitor.metrics.gpsReadings * 100);

        return ((accuracyScore + errorScore + acceptanceScore) / 3).toFixed(0);
    }

    /**
     * Calculate data reduction percentage
     */
    function calculateDataReduction() {
        const oldWrites = estimateOldSystemWrites(Date.now() - monitor.startTime);
        const reduction = ((oldWrites - monitor.metrics.firebaseWrites) / oldWrites * 100);
        return Math.max(0, reduction).toFixed(1);
    }

    /**
     * Estimate old system writes
     */
    function estimateOldSystemWrites(durationMs) {
        const OLD_INTERVAL = 4000; // 4 seconds
        return Math.floor(durationMs / OLD_INTERVAL);
    }

    /**
     * Format duration
     */
    function formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    /**
     * Get current metrics
     */
    function getMetrics() {
        return {
            ...monitor.metrics,
            realtime: { ...monitor.realtime },
            uptime: Date.now() - monitor.startTime
        };
    }

    /**
     * Get logs
     */
    function getLogs(level = null) {
        if (level) {
            return monitor.logs.filter(log => log.level === level);
        }
        return [...monitor.logs];
    }

    /**
     * Clear logs
     */
    function clearLogs() {
        monitor.logs = [];
        addLog('info', 'Logs cleared');
    }

    /**
     * Reset metrics
     */
    function resetMetrics() {
        monitor.startTime = Date.now();
        monitor.metrics = {
            gpsReadings: 0,
            acceptedPoints: 0,
            rejectedPoints: 0,
            heartbeats: 0,
            errors: 0,
            avgUpdateInterval: 0,
            lastUpdateTime: 0,
            updateIntervals: [],
            totalDistance: 0,
            avgSpeed: 0,
            maxSpeed: 0,
            firebaseWrites: 0,
            firebaseErrors: 0,
            firebaseLatency: [],
            avgAccuracy: 0,
            accuracyReadings: [],
            poorAccuracyCount: 0
        };

        addLog('info', 'Metrics reset');
    }

    /**
     * Export data for analysis
     */
    function exportData() {
        return {
            timestamp: Date.now(),
            startTime: monitor.startTime,
            duration: Date.now() - monitor.startTime,
            metrics: { ...monitor.metrics },
            realtime: { ...monitor.realtime },
            logs: [...monitor.logs],
            report: generateReport()
        };
    }

    /**
     * Create monitoring widget
     */
    function createWidget() {
        if (document.getElementById('tracker-monitor-widget')) {
            console.warn('[TrackerMonitor] Widget already exists');
            return;
        }

        const widget = document.createElement('div');
        widget.id = 'tracker-monitor-widget';
        widget.innerHTML = `
            <style>
                #tracker-monitor-widget {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: rgba(0, 0, 0, 0.9);
                    color: #fff;
                    padding: 15px;
                    border-radius: 8px;
                    font-family: monospace;
                    font-size: 12px;
                    z-index: 10000;
                    min-width: 250px;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
                }
                #tracker-monitor-widget h4 {
                    margin: 0 0 10px 0;
                    color: #3b82f6;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                #tracker-monitor-widget .close-btn {
                    cursor: pointer;
                    background: #ef4444;
                    border: none;
                    color: white;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 10px;
                }
                #tracker-monitor-widget .metric {
                    display: flex;
                    justify-content: space-between;
                    margin: 5px 0;
                    padding: 3px 0;
                    border-bottom: 1px solid #333;
                }
                #tracker-monitor-widget .metric-label {
                    color: #9ca3af;
                }
                #tracker-monitor-widget .metric-value {
                    color: #22c55e;
                    font-weight: bold;
                }
            </style>
            <h4>
                📊 Monitor
                <button class="close-btn" onclick="TrackerMonitor.hideWidget()">✕</button>
            </h4>
            <div id="monitor-content"></div>
        `;

        document.body.appendChild(widget);
        updateWidget();

        // Auto-update every second
        setInterval(updateWidget, 1000);
    }

    /**
     * Update widget content
     */
    function updateWidget() {
        const content = document.getElementById('monitor-content');
        if (!content) return;

        const metrics = getMetrics();
        const state = window.SmartTracker?.getState();

        content.innerHTML = `
            <div class="metric">
                <span class="metric-label">Status:</span>
                <span class="metric-value">${state?.isTracking ? '🟢 Active' : '🔴 Stopped'}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Speed:</span>
                <span class="metric-value">${metrics.realtime.currentSpeed} km/h</span>
            </div>
            <div class="metric">
                <span class="metric-label">Writes:</span>
                <span class="metric-value">${metrics.firebaseWrites}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Saved:</span>
                <span class="metric-value">${estimateOldSystemWrites(metrics.uptime) - metrics.firebaseWrites}</span>
            </div>
            <div class="metric">
                <span class="metric-label">Efficiency:</span>
                <span class="metric-value">${calculateDataReduction()}%</span>
            </div>
            <div class="metric">
                <span class="metric-label">Accuracy:</span>
                <span class="metric-value">${metrics.avgAccuracy.toFixed(1)}m</span>
            </div>
        `;
    }

    /**
     * Hide widget
     */
    function hideWidget() {
        const widget = document.getElementById('tracker-monitor-widget');
        if (widget) {
            widget.remove();
        }
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    window.TrackerMonitor = {
        // Initialization
        initialize: initialize,

        // Metrics
        getMetrics: getMetrics,
        resetMetrics: resetMetrics,

        // Logs
        getLogs: getLogs,
        clearLogs: clearLogs,

        // Reports
        generateReport: generateReport,
        exportData: exportData,

        // UI
        createWidget: createWidget,
        hideWidget: hideWidget,

        // Callbacks
        setCallbacks: function(callbacks) {
            monitor.callbacks = { ...monitor.callbacks, ...callbacks };
        },

        // State
        isEnabled: function() {
            return monitor.enabled;
        }
    };

    console.log('[TrackerMonitor] Module loaded');

})();
