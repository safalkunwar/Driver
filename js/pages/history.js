(function() {
    if (!window.VTApp) return;
    const busId = VTApp.getBusId();
    if (!busId) return;

    document.addEventListener('DOMContentLoaded', function() {
        // Ensure a map exists
        if (window.VTMapAPI && VTMapAPI.initDriverMap) VTMapAPI.initDriverMap();
        const map = (window.VTMapAPI && VTMapAPI._state) ? VTMapAPI._state.map : null;
        if (!map) return;

        // Prefer RouteHistory (same as user dashboard), fallback to BusLocation
        if (window.VTFirebase && VTFirebase.getRouteHistory) {
            VTFirebase.getRouteHistory(busId, (routePoints) => {
                const valid = (routePoints || []).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
                if (valid.length >= 2) {
                    const latlngs = valid.map(p => [p.latitude, p.longitude]);
                    const poly = L.polyline(latlngs, { color:'#1a73e8', weight:4, opacity:0.8, dashArray:'5, 5' }).addTo(map);
                    map.fitBounds(poly.getBounds(), { padding:[20,20] });
                } else {
                    // Fallback to last 500 bus points
                    const db = VTApp.getDb();
                    if (!db) return;
                    db.ref(`BusLocation/${busId}`).limitToLast(500).once('value', (snap) => {
                        const data = snap.val() || {};
                        const points = Object.keys(data).map(t => ({ ts:+t, ...data[t] })).sort((a,b)=>a.ts-b.ts);
                        const v2 = points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
                        if (v2.length < 2) return;
                        const latlngs = v2.map(p => [p.latitude, p.longitude]);
                        const poly = L.polyline(latlngs, { color:'#1a73e8', weight:4, opacity:0.8, dashArray:'5, 5' }).addTo(map);
                        map.fitBounds(poly.getBounds(), { padding:[20,20] });
                    });
                }
            });
        }
    });
})();


