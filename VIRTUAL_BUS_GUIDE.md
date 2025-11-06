# 🚌 Virtual Bus Simulator - Complete Guide

## 📋 Overview

The **Virtual Bus Simulator** is a powerful testing tool that simulates a real bus moving along predefined routes, generating authentic GPS coordinates and sending them to Firebase through the Smart Tracker system.

Perfect for:
- ✅ Testing the Smart Tracker without a real bus
- ✅ Demonstrating the system to stakeholders
- ✅ Debugging GPS tracking logic
- ✅ Visualizing route efficiency
- ✅ Training and presentations

## 🎯 Key Features

### 1. **Realistic Movement**
- Moves along predefined waypoints
- Smooth interpolation between points
- Realistic speed variation (20-80 km/h)
- GPS noise simulation (mimics real GPS accuracy)
- Proper heading/bearing calculation

### 2. **Multiple Routes**
- **Test Loop** - Quick circular route (9 waypoints, ~2km)
- **Pokhara City** - Lakeside to Airport (13 waypoints, ~5km)
- **Campus Route** - Campus loop with multiple stops (17 waypoints, ~8km)
- **Highway Route** - Long distance simulation (9 waypoints, ~25km)

### 3. **Smart Tracker Integration**
- Sends location updates through Smart Tracker
- Respects all filtering rules
- Writes to Firebase automatically
- Shows efficiency in real-time

### 4. **Traffic Simulation**
- Optional traffic conditions
- Random speed variations
- Simulates traffic jams (30-60% speed)
- Realistic driving patterns

### 5. **Live Visualization**
- Interactive map with Leaflet
- Animated bus marker
- Route polyline display
- Waypoint markers
- Real-time statistics

## 🚀 Quick Start

### 1. Open the Live Demo

```bash
# Navigate to the demo page
open driver-platform/html/tracker-demo-live.html
```

### 2. Configure Simulation

1. **Enter Bus ID** - e.g., "virtual-bus-01"
2. **Select Route** - Choose from dropdown
3. **Set Speed** - Use slider (20-80 km/h)
4. **Enable Traffic** - Optional realistic variation
5. **Click Start** - Begin simulation

### 3. Watch It Work!

The virtual bus will:
- ✅ Move along the route
- ✅ Generate GPS coordinates
- ✅ Send to Firebase via Smart Tracker
- ✅ Update map in real-time
- ✅ Show live statistics

## 📊 Available Routes

### Test Loop (Quick Testing)
```
Duration: ~3 minutes at 40 km/h
Distance: ~2 km
Waypoints: 9 stops
Shape: Circular loop
Use case: Quick testing and debugging
```

**Route Path:**
```
Start → North → Northeast → East → 
Southeast → South → Southwest → West → Return
```

### Pokhara City Route
```
Duration: ~8 minutes at 40 km/h
Distance: ~5 km
Waypoints: 13 stops
Route: Lakeside → Mahendrapool → Airport
Use case: Realistic city route simulation
```

**Route Path:**
```
Lakeside → Lakeside North → Barahi Temple → 
Center Point → Bagar → New Road → Mahendrapool → 
Chipledhunga → Srijana Chowk → Prithvi Chowk → 
Zero KM → Airport Road → Near Airport
```

### Campus Route
```
Duration: ~12 minutes at 40 km/h
Distance: ~8 km
Waypoints: 17 stops
Route: Campus loop with multiple student pickup points
Use case: School/college bus simulation
```

### Highway Route
```
Duration: ~30 minutes at 60 km/h
Distance: ~25 km
Waypoints: 9 stops
Route: City to highway with rest stops
Use case: Long-distance tracking simulation
```

## ⚙️ Configuration Options

### Speed Control

```javascript
// Set speed programmatically
VirtualBus.setSpeed(50); // 50 km/h

// Speed limits
Minimum: 20 km/h
Maximum: 80 km/h
Default: 40 km/h
```

### Traffic Simulation

```javascript
// Enable traffic conditions
VirtualBus.enableTraffic(true);

// Traffic effects:
// 10% chance: Heavy traffic (30-60% speed)
// 10% chance: Moderate traffic (60-80% speed)
// 80% chance: Normal traffic (90-110% speed)
```

### Update Interval

```javascript
// Change how often position updates
VirtualBus.setUpdateInterval(500); // 500ms

// Default: 1000ms (1 second)
// Faster = more GPS points
// Slower = more efficient
```

## 💻 API Reference

### Initialization

```javascript
// Initialize with route and bus ID
VirtualBus.initialize('pokhara_city', 'bus1', {
    onPositionUpdate: (locationData, stats) => {
        console.log('Position:', locationData);
        console.log('Stats:', stats);
    },
    onWaypointReached: (waypoint, stopCount) => {
        console.log('Reached:', waypoint.name);
    },
    onRouteComplete: (stats) => {
        console.log('Route complete!', stats);
    }
});
```

### Control Methods

```javascript
// Start simulation
VirtualBus.start();

// Stop simulation
VirtualBus.stop();

// Check if running
const isRunning = VirtualBus.isRunning();
```

### Configuration Methods

```javascript
// Set bus speed (km/h)
VirtualBus.setSpeed(60);

// Enable/disable traffic
VirtualBus.enableTraffic(true);

// Change update frequency
VirtualBus.setUpdateInterval(2000);
```

### Query Methods

```javascript
// Get all available routes
const routes = VirtualBus.getRoutes();
// Returns: [{ key, name, description, waypoints, color }, ...]

// Get specific route
const route = VirtualBus.getRoute('pokhara_city');

// Get current position
const position = VirtualBus.getCurrentPosition();
// Returns: { lat, lon }

// Get statistics
const stats = VirtualBus.getStats();
// Returns: { distanceTraveled, timeElapsed, stopsVisited, updatesGenerated }
```

### Direct Firebase Write (Testing)

```javascript
// Write directly to Firebase (bypass Smart Tracker)
VirtualBus.writeDirectToFirebase({
    latitude: 28.2150,
    longitude: 83.9886,
    speed: 40,
    heading: 180
});
```

## 📈 Understanding the Statistics

### GPS Updates vs Firebase Writes

```
GPS Updates: Total position updates generated
Firebase Writes: Actual writes to database
Efficiency: (Writes / Updates) × 100%

Example after 10 minutes:
- GPS Updates: 600
- Firebase Writes: 120
- Efficiency: 20% (80% reduction!)
```

### Distance Calculation

```javascript
// Uses Haversine formula
// Accurate to within meters
// Displayed in kilometers

Distance Traveled = Sum of all segment distances
Typical speeds:
- Urban: 20-40 km/h
- Highway: 50-80 km/h
```

### Stops Visited

```javascript
// Increments each time bus reaches a waypoint
// Useful for tracking route progress
// Resets when route completes and loops
```

## 🎨 UI Components

### Map View

```
Features:
- Animated bus marker (🚌)
- Route polyline (dashed line)
- Waypoint markers (blue circles)
- Popup info on click
- Auto-zoom to route
```

### Real-time Stats

```
Current Speed - Live bus speed
Heading - Direction in degrees (0-360)
Distance Traveled - Total journey distance
Stops Visited - Waypoints reached
Firebase Writes - Database operations
GPS Updates - Total position updates
Efficiency - Write reduction percentage
```

### Activity Log

```
Color-coded entries:
🔵 Info - General information
🟢 Success - Successful operations
🟡 Warning - Important events
```

### Waypoints List

```
Features:
- Shows all stops on route
- Highlights current waypoint
- Grays out completed stops
- Scrollable list
```

## 🧪 Testing Scenarios

### Scenario 1: Stationary Bus (Idle Detection)

```javascript
// Test Smart Tracker's duplicate detection
VirtualBus.initialize('test_loop', 'test-bus');
VirtualBus.setSpeed(0); // Stationary
VirtualBus.start();

// Wait 5 minutes
// Expected: Only 1-2 Firebase writes
// Smart Tracker should send heartbeats only
```

### Scenario 2: Fast Moving Bus

```javascript
// Test high-frequency updates
VirtualBus.initialize('highway_route', 'test-bus');
VirtualBus.setSpeed(80); // Maximum speed
VirtualBus.start();

// Expected: Updates every ~3 seconds
// Firebase writes match GPS frequency
```

### Scenario 3: Traffic Conditions

```javascript
// Test variable speed handling
VirtualBus.initialize('pokhara_city', 'test-bus');
VirtualBus.setSpeed(40);
VirtualBus.enableTraffic(true);
VirtualBus.start();

// Speed will vary: 12-44 km/h
// Smart Tracker adapts intervals
```

### Scenario 4: Complete Route Loop

```javascript
// Test full route completion
VirtualBus.initialize('campus_route', 'test-bus', {
    onRouteComplete: (stats) => {
        console.log('Route completed!');
        console.log('Distance:', stats.distanceTraveled);
        console.log('Time:', stats.timeElapsed);
        console.log('Stops:', stats.stopsVisited);
    }
});
VirtualBus.start();

// Will loop back to start automatically
```

## 🔥 Firebase Integration

### Data Written to Firebase

```json
BusLocation/
  virtual-bus-01/
    1731682391394/
      latitude: 28.215176984699085
      longitude: 83.98871119857192
      speed: 45
      heading: 180
      ts: 1731682391394
```

### Real-time Verification

```javascript
// Listen to Firebase updates
firebase.database()
    .ref('BusLocation/virtual-bus-01')
    .on('child_added', (snapshot) => {
        console.log('New location:', snapshot.val());
    });
```

### Cleanup

```javascript
// Remove test data
firebase.database()
    .ref('BusLocation/virtual-bus-01')
    .remove()
    .then(() => console.log('Test data removed'));
```

## 🐛 Troubleshooting

### Issue: Bus Not Moving

**Check:**
```javascript
// Is simulation running?
console.log('Running:', VirtualBus.isRunning());

// Is route initialized?
const pos = VirtualBus.getCurrentPosition();
console.log('Position:', pos);
```

**Solution:**
```javascript
// Reinitialize
VirtualBus.stop();
VirtualBus.initialize('test_loop', 'bus1');
VirtualBus.start();
```

### Issue: No Firebase Writes

**Check:**
```javascript
// Is Firebase initialized?
console.log('Firebase:', window.firebase);

// Is SmartTracker loaded?
console.log('SmartTracker:', window.SmartTracker);
```

**Solution:**
```javascript
// Ensure scripts loaded in correct order:
// 1. firebase.js
// 2. smart-tracker.js
// 3. virtual-bus-simulator.js
```

### Issue: Map Not Updating

**Check:**
```javascript
// Is Leaflet loaded?
console.log('Leaflet:', typeof L !== 'undefined');

// Check callback registration
VirtualBus.initialize('test_loop', 'bus1', {
    onPositionUpdate: (data) => {
        console.log('Position update:', data);
    }
});
```

### Issue: Speed Too Fast/Slow

**Solution:**
```javascript
// Adjust speed
VirtualBus.setSpeed(40); // Set to desired km/h

// Check update interval
VirtualBus.setUpdateInterval(1000); // 1 second
```

## 🎯 Best Practices

### For Testing

1. **Use Test Loop** for quick iterations
2. **Enable traffic** for realistic scenarios
3. **Monitor console** for detailed logs
4. **Check Firebase** to verify data structure
5. **Reset between tests** for clean data

### For Demonstrations

1. **Use Pokhara City** for realistic demo
2. **Set speed to 40 km/h** for good pacing
3. **Enable traffic** for variety
4. **Show activity log** to highlight Smart Tracker
5. **Explain efficiency** metrics

### For Development

1. **Start with Test Loop** for debugging
2. **Use direct Firebase writes** to isolate issues
3. **Monitor SmartTracker stats** for behavior
4. **Test edge cases** (very slow, very fast, stopped)
5. **Verify GPS filtering** works correctly

## 📊 Performance Tips

### Optimize Update Frequency

```javascript
// For testing (faster)
VirtualBus.setUpdateInterval(500); // 0.5s

// For realistic (default)
VirtualBus.setUpdateInterval(1000); // 1s

// For efficiency demo (slower)
VirtualBus.setUpdateInterval(2000); // 2s
```

### Reduce Map Redraws

```javascript
// Update map less frequently than GPS
let updateCount = 0;
VirtualBus.initialize('route', 'bus', {
    onPositionUpdate: (data) => {
        updateCount++;
        if (updateCount % 5 === 0) {
            updateMap(data); // Update every 5th position
        }
    }
});
```

### Memory Management

```javascript
// Stop simulation when not needed
window.addEventListener('beforeunload', () => {
    if (VirtualBus.isRunning()) {
        VirtualBus.stop();
    }
});

// Clear old data periodically
setTimeout(() => {
    // Cleanup after demo
    VirtualBus.stop();
    cleanupFirebase();
}, 3600000); // 1 hour
```

## 🔐 Security Considerations

### Firebase Rules

```json
{
  "rules": {
    "BusLocation": {
      "virtual-bus-01": {
        ".write": true,  // Allow for testing
        ".read": true
      }
    }
  }
}
```

### Production Use

```javascript
// Use authentication in production
// Don't use "virtual-bus-*" IDs in production
// Separate test and production Firebase instances
// Clean up test data regularly
```

## 📚 Additional Resources

### Related Files

- `js/virtual-bus-simulator.js` - Core simulator code
- `html/tracker-demo-live.html` - Live demo interface
- `js/smart-tracker.js` - GPS tracking engine
- `SMART_TRACKER_GUIDE.md` - Tracker documentation

### Example Routes

```javascript
// Add custom route
const CUSTOM_ROUTE = {
    name: 'My Custom Route',
    description: 'Description here',
    waypoints: [
        { lat: 28.2096, lon: 83.9856, name: 'Start' },
        { lat: 28.2106, lon: 83.9866, name: 'Stop 1' },
        { lat: 28.2116, lon: 83.9876, name: 'Stop 2' }
        // Add more waypoints...
    ],
    color: '#ff6b6b'
};

// Add to ROUTES object in virtual-bus-simulator.js
```

## 🎉 Summary

The Virtual Bus Simulator provides:

✨ **Realistic GPS simulation** - Authentic coordinates and movement  
🗺️ **Multiple routes** - Test different scenarios  
⚡ **Smart Tracker integration** - Full tracking system test  
📊 **Live statistics** - Real-time performance metrics  
🎨 **Visual feedback** - Interactive map and UI  
🔧 **Configurable** - Adjust speed, traffic, routes  
🧪 **Testing ready** - Perfect for development  

**Perfect for testing, demos, and development!** 🚀

---

## 🆘 Quick Reference

```javascript
// Initialize
VirtualBus.initialize('pokhara_city', 'bus1');

// Configure
VirtualBus.setSpeed(40);
VirtualBus.enableTraffic(true);

// Control
VirtualBus.start();
VirtualBus.stop();

// Query
VirtualBus.getCurrentPosition();
VirtualBus.getStats();
VirtualBus.isRunning();
```

---

**Version:** 1.0  
**Last Updated:** November 6, 2024  
**Status:** ✅ Production Ready

**Start simulating realistic bus routes today!** 🚌