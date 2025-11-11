/**
 * Offline Queue Manager
 *
 * Handles offline data queuing and synchronization for V-Track driver platform
 * Features:
 * - Automatic queue management
 * - localStorage persistence
 * - Auto-sync when online
 * - Connection monitoring
 * - Queue size limits
 *
 * @version 1.0
 * @author V-Track Team
 */

(function() {
    'use strict';

    // ============================================================
    // CONFIGURATION
    // ============================================================

    const CONFIG = {
        MAX_QUEUE_SIZE: 1000,           // Maximum queued items
        SYNC_BATCH_SIZE: 10,            // Items to sync per batch
        SYNC_INTERVAL: 1000,            // 1 second between batches
        MAX_RETRY_ATTEMPTS: 5,          // Max retry attempts per item
        CONNECTION_CHECK_INTERVAL: 5000, // Check connection every 5s
        STORAGE_KEY: 'vtrack_offline_queue',
        STATS_KEY: 'vtrack_offline_stats'
    };

    // ============================================================
    // STATE MANAGEMENT
    // ============================================================

    const state = {
        queue: [],
        isOnline: navigator.onLine,
        isSyncing: false,
        syncInProgress: false,

        stats: {
            totalQueued: 0,
            totalSynced: 0,
            totalFailed: 0,
            lastSyncTime: null,
            queuedSince: null
        },

        listeners: {
            onOnline: null,
            onOffline: null,
            onSyncStart: null,
            onSyncComplete: null,
            onQueueUpdate: null
        }
    };

    // ============================================================
    // INITIALIZATION
    // ============================================================

    /**
     * Initialize offline manager
     */
    function initialize() {
        console.log('[OfflineManager] Initializing...');

        // Load persisted queue and stats
        loadQueue();
        loadStats();

        // Setup event listeners
        setupEventListeners();

        // Start connection monitoring
        startConnectionMonitoring();

        // If online, try to sync existing queue
        if (state.isOnline && state.queue.length > 0) {
            console.log(`[OfflineManager] Found ${state.queue.length} queued items, syncing...`);
            syncQueue();
        }

        console.log('[OfflineManager] Initialized successfully');
        console.log(`[OfflineManager] Queue size: ${state.queue.length}, Online: ${state.isOnline}`);
    }

    /**
     * Setup event listeners
     */
    function setupEventListeners() {
        // Browser online/offline events
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Firebase connection monitoring
        if (window.firebase && window.firebase.database) {
            const connectedRef = firebase.database().ref('.info/connected');
            connectedRef.on('value', (snapshot) => {
                const isConnected = snapshot.val() === true;
                if (isConnected && !state.isOnline) {
                    handleOnline();
                } else if (!isConnected && state.isOnline) {
                    handleOffline();
                }
            });
        }

        // Handle page unload - save queue
        window.addEventListener('beforeunload', () => {
            saveQueue();
            saveStats();
        });

        // Visibility change - sync when tab becomes visible
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && state.isOnline && state.queue.length > 0) {
                syncQueue();
            }
        });
    }

    /**
     * Handle online event
     */
    function handleOnline() {
        console.log('[OfflineManager] Connection restored');
        state.isOnline = true;

        hideOfflineIndicator();

        if (state.listeners.onOnline) {
            state.listeners.onOnline();
        }

        // Start syncing queue
        if (state.queue.length > 0) {
            console.log(`[OfflineManager] ${state.queue.length} items queued, starting sync...`);
            syncQueue();
        }
    }

    /**
     * Handle offline event
     */
    function handleOffline() {
        console.log('[OfflineManager] Connection lost');
        state.isOnline = false;

        showOfflineIndicator();

        if (state.listeners.onOffline) {
            state.listeners.onOffline();
        }
    }

    // ============================================================
    // QUEUE MANAGEMENT
    // ============================================================

    /**
     * Add item to queue
     */
    function queueUpdate(busId, timestamp, data, type = 'location') {
        const entry = {
            id: `${busId}_${timestamp}_${Date.now()}`,
            busId: busId,
            timestamp: timestamp,
            data: data,
            type: type,
            queued: Date.now(),
            attempts: 0
        };

        // Add to queue
        state.queue.push(entry);
        state.stats.totalQueued++;

        // Update queued since
        if (!state.stats.queuedSince) {
            state.stats.queuedSince = Date.now();
        }

        // Enforce queue size limit
        if (state.queue.length > CONFIG.MAX_QUEUE_SIZE) {
            const removed = state.queue.shift();
            console.warn('[OfflineManager] Queue full, removed oldest entry:', removed.id);
            state.stats.totalFailed++;
        }

        // Save to localStorage
        saveQueue();
        saveStats();

        console.log(`[OfflineManager] Queued ${type} update (${state.queue.length} in queue)`);

        // Update UI
        updateQueueIndicator();

        // Notify listener
        if (state.listeners.onQueueUpdate) {
            state.listeners.onQueueUpdate(state.queue.length);
        }

        // Try to sync if online
        if (state.isOnline && !state.syncInProgress) {
            syncQueue();
        }
    }

    /**
     * Sync queue to Firebase
     */
    async function syncQueue() {
        if (!state.isOnline || state.queue.length === 0) {
            return;
        }

        if (state.syncInProgress) {
            console.log('[OfflineManager] Sync already in progress');
            return;
        }

        state.syncInProgress = true;

        console.log(`[OfflineManager] Starting sync of ${state.queue.length} items`);

        if (state.listeners.onSyncStart) {
            state.listeners.onSyncStart(state.queue.length);
        }

        let successCount = 0;
        let failCount = 0;

        // Process queue in batches
        while (state.queue.length > 0 && state.isOnline) {
            const batch = state.queue.slice(0, CONFIG.SYNC_BATCH_SIZE);

            for (const entry of batch) {
                if (!state.isOnline) {
                    console.log('[OfflineManager] Connection lost, pausing sync');
                    break;
                }

                try {
                    await syncEntry(entry);

                    // Remove from queue on success
                    const index = state.queue.findIndex(e => e.id === entry.id);
                    if (index !== -1) {
                        state.queue.splice(index, 1);
                    }

                    successCount++;
                    state.stats.totalSynced++;

                    console.log(`[OfflineManager] Synced: ${entry.id} (${state.queue.length} remaining)`);

                } catch (error) {
                    console.error('[OfflineManager] Sync failed for entry:', entry.id, error);

                    entry.attempts++;

                    if (entry.attempts >= CONFIG.MAX_RETRY_ATTEMPTS) {
                        console.warn(`[OfflineManager] Max retries reached, removing: ${entry.id}`);
                        const index = state.queue.findIndex(e => e.id === entry.id);
                        if (index !== -1) {
                            state.queue.splice(index, 1);
                        }
                        failCount++;
                        state.stats.totalFailed++;
                    } else {
                        // Move to end of queue for retry
                        const index = state.queue.findIndex(e => e.id === entry.id);
                        if (index !== -1) {
                            const item = state.queue.splice(index, 1)[0];
                            state.queue.push(item);
                        }
                    }

                    // Stop batch on error to avoid overwhelming Firebase
                    break;
                }

                // Small delay between writes
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Save progress
            saveQueue();
            saveStats();
            updateQueueIndicator();

            // Delay between batches
            if (state.queue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, CONFIG.SYNC_INTERVAL));
            }
        }

        state.syncInProgress = false;
        state.stats.lastSyncTime = Date.now();

        if (state.queue.length === 0) {
            state.stats.queuedSince = null;
        }

        saveStats();

        console.log(`[OfflineManager] Sync complete: ${successCount} succeeded, ${failCount} failed`);

        if (state.listeners.onSyncComplete) {
            state.listeners.onSyncComplete(successCount, failCount);
        }

        updateQueueIndicator();
    }

    /**
     * Sync single entry to Firebase
     */
    async function syncEntry(entry) {
        if (!window.firebase || !window.firebase.database) {
            throw new Error('Firebase not available');
        }

        const db = window.firebase.database();

        // Different paths based on type
        switch (entry.type) {
            case 'location':
                await db.ref(`BusLocation/${entry.busId}/${entry.timestamp}`).set(entry.data);
                break;

            case 'currentLocation':
                await db.ref(`drivers/${entry.busId}/currentLocation`).set(entry.data);
                break;

            case 'trip':
                await db.ref(`trips/${entry.busId}/${entry.timestamp}`).set(entry.data);
                break;

            default:
                console.warn('[OfflineManager] Unknown entry type:', entry.type);
        }
    }

    // ============================================================
    // PERSISTENCE
    // ============================================================

    /**
     * Save queue to localStorage
     */
    function saveQueue() {
        try {
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.queue));
        } catch (error) {
            console.error('[OfflineManager] Failed to save queue:', error);

            // If storage full, remove oldest items
            if (error.name === 'QuotaExceededError') {
                console.warn('[OfflineManager] Storage quota exceeded, clearing old items');
                state.queue = state.queue.slice(-100); // Keep only last 100
                try {
                    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.queue));
                } catch (e) {
                    console.error('[OfflineManager] Still failed to save queue');
                }
            }
        }
    }

    /**
     * Load queue from localStorage
     */
    function loadQueue() {
        try {
            const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (saved) {
                state.queue = JSON.parse(saved);
                console.log(`[OfflineManager] Loaded ${state.queue.length} queued items from storage`);
            }
        } catch (error) {
            console.error('[OfflineManager] Failed to load queue:', error);
            state.queue = [];
        }
    }

    /**
     * Save stats to localStorage
     */
    function saveStats() {
        try {
            localStorage.setItem(CONFIG.STATS_KEY, JSON.stringify(state.stats));
        } catch (error) {
            console.error('[OfflineManager] Failed to save stats:', error);
        }
    }

    /**
     * Load stats from localStorage
     */
    function loadStats() {
        try {
            const saved = localStorage.getItem(CONFIG.STATS_KEY);
            if (saved) {
                state.stats = { ...state.stats, ...JSON.parse(saved) };
            }
        } catch (error) {
            console.error('[OfflineManager] Failed to load stats:', error);
        }
    }

    /**
     * Clear queue and stats
     */
    function clearQueue() {
        state.queue = [];
        state.stats = {
            totalQueued: 0,
            totalSynced: 0,
            totalFailed: 0,
            lastSyncTime: null,
            queuedSince: null
        };

        saveQueue();
        saveStats();
        updateQueueIndicator();

        console.log('[OfflineManager] Queue cleared');
    }

    // ============================================================
    // UI INDICATORS
    // ============================================================

    /**
     * Show offline indicator
     */
    function showOfflineIndicator() {
        let indicator = document.getElementById('offlineIndicator');

        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'offlineIndicator';
            indicator.style.cssText = `
                position: fixed;
                top: 10px;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(135deg, #ef4444, #dc2626);
                color: white;
                padding: 12px 24px;
                border-radius: 8px;
                font-weight: 600;
                font-size: 0.95rem;
                z-index: 10001;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                display: flex;
                align-items: center;
                gap: 10px;
                animation: slideDown 0.3s ease;
            `;

            const style = document.createElement('style');
            style.textContent = `
                @keyframes slideDown {
                    from { transform: translateX(-50%) translateY(-100%); opacity: 0; }
                    to { transform: translateX(-50%) translateY(0); opacity: 1; }
                }
            `;
            document.head.appendChild(style);

            document.body.appendChild(indicator);
        }

        updateQueueIndicator();
        indicator.style.display = 'flex';
    }

    /**
     * Hide offline indicator
     */
    function hideOfflineIndicator() {
        const indicator = document.getElementById('offlineIndicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    /**
     * Update queue indicator text
     */
    function updateQueueIndicator() {
        const indicator = document.getElementById('offlineIndicator');
        if (indicator) {
            const queueSize = state.queue.length;
            if (queueSize > 0) {
                indicator.innerHTML = `
                    <span style="font-size: 1.2rem;">📡</span>
                    <span>OFFLINE - ${queueSize} update${queueSize > 1 ? 's' : ''} queued</span>
                `;
            } else {
                indicator.innerHTML = `
                    <span style="font-size: 1.2rem;">📡</span>
                    <span>OFFLINE MODE</span>
                `;
            }
        }
    }

    // ============================================================
    // CONNECTION MONITORING
    // ============================================================

    /**
     * Start connection monitoring
     */
    function startConnectionMonitoring() {
        setInterval(() => {
            // Check if online status changed
            const currentlyOnline = navigator.onLine;

            if (currentlyOnline !== state.isOnline) {
                if (currentlyOnline) {
                    handleOnline();
                } else {
                    handleOffline();
                }
            }

            // Try to sync if online and have queue
            if (state.isOnline && state.queue.length > 0 && !state.syncInProgress) {
                syncQueue();
            }

        }, CONFIG.CONNECTION_CHECK_INTERVAL);
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    window.OfflineManager = {
        // Initialization
        initialize: initialize,

        // Queue management
        queueUpdate: queueUpdate,
        syncQueue: syncQueue,
        clearQueue: clearQueue,

        // UI
        showOfflineIndicator: showOfflineIndicator,
        hideOfflineIndicator: hideOfflineIndicator,

        // Getters
        getQueue: () => [...state.queue],
        getQueueSize: () => state.queue.length,
        isOnline: () => state.isOnline,
        isSyncing: () => state.syncInProgress,
        getStats: () => ({ ...state.stats }),

        // Listeners
        on: (event, callback) => {
            if (state.listeners.hasOwnProperty(`on${event.charAt(0).toUpperCase()}${event.slice(1)}`)) {
                state.listeners[`on${event.charAt(0).toUpperCase()}${event.slice(1)}`] = callback;
            }
        },

        // Status
        getStatus: () => ({
            queueSize: state.queue.length,
            isOnline: state.isOnline,
            isSyncing: state.syncInProgress,
            stats: state.stats,
            oldestEntry: state.queue.length > 0 ? state.queue[0].queued : null
        })
    };

    console.log('[OfflineManager] Module loaded v1.0');

})();
