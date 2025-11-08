# Firebase Database Schema Documentation

## Overview

This document describes the Firebase Realtime Database schema used by the V-Track Driver Platform.

## Schema Structure

### `/BusLocation/{busId}/{timestamp}/`

**Purpose:** Store real-time location updates from drivers.

**Path Pattern:** `/BusLocation/{busId}/{timestamp}/`

**Example Path:** `/BusLocation/bus1/1731829918350/`

**Data Structure:**
```json
{
  "latitude": 6.9271,
  "longitude": 79.8612,
  "speed": 45,
  "heading": 180,
  "ts": 1731829918350
}
```

**Fields:**
- `latitude` (number): Latitude coordinate in decimal degrees (-90 to 90)
- `longitude` (number): Longitude coordinate in decimal degrees (-180 to 180)
- `speed` (number): Speed in km/h (0 or positive)
- `heading` (number): Direction of travel in degrees (0-360, where 0 = North)
- `ts` (number): Timestamp in milliseconds (Unix epoch, same as key)

**Update Frequency:** Every 3-5 seconds when tracking is active

**Key Format:** Timestamp as string from `Date.now()` (e.g., "1731829918350")

**Notes:**
- Timestamp key ensures chronological ordering
- Each update creates a new child node (append-only pattern)
- Old timestamps remain for history tracking
- Can implement cleanup rules to remove timestamps older than X days

---

## Future Schema Extensions

The following schema additions are planned for future steps:

### `/buses/{busId}/location/` (Current location)
```json
{
  "lat": 6.9271,
  "lng": 79.8612,
  "ts": 1731829918350,
  "speed": 45,
  "heading": 180,
  "driverId": "driver123"
}
```

### `/buses/{busId}/history/{pushId}/`
```json
{
  "lat": 6.9271,
  "lng": 79.8612,
  "ts": 1731829918350
}
```

### `/routes/{routeId}/`
```json
{
  "polyline": [
    {"lat": 6.9271, "lng": 79.8612},
    {"lat": 6.9280, "lng": 79.8620}
  ],
  "stops": [
    {
      "id": "stop1",
      "lat": 6.9271,
      "lng": 79.8612,
      "name": "University Main Gate"
    }
  ]
}
```

### `/students/{studentId}/`
```json
{
  "lat": 6.9271,
  "lng": 79.8612,
  "ts": 1731829918350,
  "waiting": true,
  "lastClickedAt": 1731829918350
}
```

### `/alerts/{alertId}/`
```json
{
  "busId": "bus1",
  "studentId": "student123",
  "type": "proximity",
  "ts": 1731829918350,
  "status": "active"
}
```

---

## Security Rules

### Read Rules
- Bus locations: Public read (anyone can view bus positions)
- Future student data: Authenticated read only
- Alerts: Authenticated read only

### Write Rules
- Bus locations: Authenticated write OR timestamp validation
- Student data: Authenticated write only
- Alerts: System/authenticated write only

### Example Security Rules

```json
{
  "rules": {
    "BusLocation": {
      "$busId": {
        "$timestamp": {
          ".read": true,
          ".write": "$timestamp == now.toString()",
          ".validate": "newData.hasChildren(['latitude', 'longitude', 'speed', 'heading', 'ts']) && 
                        newData.child('latitude').isNumber() && 
                        newData.child('latitude').val() >= -90 && 
                        newData.child('latitude').val() <= 90 &&
                        newData.child('longitude').isNumber() && 
                        newData.child('longitude').val() >= -180 && 
                        newData.child('longitude').val() <= 180 &&
                        newData.child('speed').isNumber() && 
                        newData.child('speed').val() >= 0 &&
                        newData.child('heading').isNumber() && 
                        newData.child('heading').val() >= 0 && 
                        newData.child('heading').val() < 360 &&
                        newData.child('ts').isNumber()"
        }
      }
    }
  }
}
```

**Note:** The timestamp validation (`$timestamp == now.toString()`) prevents writing backdated data. This is a basic security measure. For production, implement Firebase Authentication.

---

## Data Retention

### Recommended Cleanup Strategies

1. **Time-based cleanup:** Remove timestamps older than 7 days
2. **Size-based cleanup:** Keep only last N points per bus
3. **Aggregation:** Archive old data to Cloud Storage monthly

### Firebase Functions Example (Future)

```javascript
// Cleanup old location data (older than 7 days)
exports.cleanupOldLocations = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async (context) => {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    // ... cleanup logic
  });
```

---

## Performance Considerations

1. **Read Optimization:**
   - Use `.limitToLast(1)` to get only latest location
   - Use `.orderByKey()` for chronological queries

2. **Write Optimization:**
   - Throttle writes (already implemented: 3-5 seconds)
   - Batch writes when offline (future: queue system)

3. **Indexing:**
   - Timestamp keys are naturally ordered
   - No additional indexes needed for time-based queries

---

## Migration Notes

If migrating from old schema format:

**Old Format (if exists):**
```
/BusLocation/{busId}/
  - latitude: number
  - longitude: number
  - timestamp: number
```

**New Format (Step 1):**
```
/BusLocation/{busId}/{timestamp}/
  - latitude: number
  - longitude: number
  - speed: number
  - heading: number
  - ts: number
```

Migration script (run once):
```javascript
// Migrate old format to new format
const oldRef = database.ref(`BusLocation/${busId}`);
const snapshot = await oldRef.once('value');
const oldData = snapshot.val();
if (oldData && oldData.timestamp) {
  const newRef = database.ref(`BusLocation/${busId}/${oldData.timestamp}`);
  await newRef.set({
    latitude: oldData.latitude,
    longitude: oldData.longitude,
    speed: oldData.speed || 0,
    heading: oldData.heading || 0,
    ts: oldData.timestamp
  });
}
```

---

## Version History

- **v1.0 (Step 1):** Initial schema with timestamp-based keys
  - Supports: latitude, longitude, speed, heading, timestamp
  - Write frequency: 3-5 seconds
  - Key format: timestamp string

---

Last Updated: Step 1 Implementation






