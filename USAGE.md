# How to Use the Driver Platform

## Simple Usage (No npm required!)

1. **Open the file:**
   - Navigate to `driver-platform/driver.html`
   - Double-click or open in any browser
   - No installation needed!

2. **First time setup:**
   - Select your bus ID (bus1, bus2, etc.) or enter custom
   - Your selection is automatically saved

3. **Start tracking:**
   - Click "Start Tracking" button
   - Grant location permission when prompted
   - Your location will appear on the map
   - Data is saved to Firebase automatically

## Using a Local Server (Optional)

If you encounter CORS issues, use a simple HTTP server:

```bash
# Python 3
python -m http.server 8000

# Node.js (if installed)
npx http-server

# Then open: http://localhost:8000/driver-platform/driver.html
```

## Features Guide

### 📍 Bus Selection
- First launch: Modal appears to select bus
- To change: Click "Change Bus" in top indicator or use dropdown in header

### 🗺️ Map
- Shows your current location (green marker)
- Shows route history (blue/green line)
- Tap marker to see speed/heading info
- Use "Filtered" button to toggle raw/filtered GPS view

### 🎯 Driving Focus Mode
- Click "Driving Focus" button
- Full-screen simplified UI
- Large speedometer
- Big action buttons
- Voice alerts toggle

### 👥 Student Alerts
- Automatically detects students in front of bus (within 50m, 60° cone)
- Alert banner appears at bottom
- Voice alert in focus mode
- Dismiss button to clear alerts

### 🔄 Multi-Bus Switching
- Use dropdown in header to switch buses
- Each bus has separate route history
- Automatically loads route history for selected bus

## Tips

- **Save to Home Screen:** On mobile, add to home screen for quick access
- **Location Accuracy:** Works best outdoors with clear sky view
- **Battery:** GPS tracking uses battery - use focus mode when driving to reduce UI updates
- **Internet Required:** For Firebase writes and map tiles

## Troubleshooting

**"Location not working"**
- Check browser location permissions
- Ensure you're using HTTPS or localhost
- Try refreshing the page

**"Firebase error"**
- Check internet connection
- Verify Firebase config in driver.js matches your project

**"Map blank"**
- Check internet connection (map tiles load from internet)
- Try refreshing the page

---

That's it! Simple and straightforward. 🚌











