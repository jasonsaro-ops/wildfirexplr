// --- WILDFIREXPLR Core State & Configuration ---
let countdownVal = 120;

const AIRNOW_API_KEY = "E5AFEF36-80F6-4A42-AE38-F3C56E3AEAC4"; 
const FIRMS_MAP_KEY = "215020163103e2209b2fb8253d20b037";

let globalWildfireCache = {};
let globalWildfireMapCache = {}; 
let globalAlertsCache = {};
let globalEonetCache = {};
let globalPerimeterCache = {}; // keyed by IrwinID -> GeoJSON feature (real NIFC perimeter polygons)
let firmsMapMarkers = {}; 
let eonetMapMarkers = {};
let wildfireChartInstance = null;

let activeLeafletMap = null;
let firmsMarkersGroup = null;
let wfigsMarkersGroup = null;
let eonetMarkersGroup = null;
let perimetersLayerGroup = null;
let activePerimeter = null;

let layerVisibility = { wfigs: true, firms: true, eonet: true, perimeters: true };

let initialMapFit = false;

let alertSoundEnabled = false;
let previousAlertCount = 0;
let alertAudio = null;

function initAlertSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        alertAudio = audioContext;
    } catch (err) { console.log("Audio context deferred."); }
}

function playAlertSound() {
    if (!alertSoundEnabled || !alertAudio) return;
    try {
        const context = alertAudio;
        if (context.state === 'suspended') context.resume();
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.connect(gain); gain.connect(context.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.2, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.15);
        osc.start(context.currentTime); osc.stop(context.currentTime + 0.15);
    } catch (err) { console.error("Audio error:", err); }
}

// --- Golden Layout Grid Configuration ---
const config = {
    settings: { hasHeaders: true, reorderEnabled: true, showPopoutIcon: false, showMaximiseIcon: true, showCloseIcon: false },
    content: [{
        type: 'row',
        content: [
            {
                type: 'column',
                width: 44,
                content: [
                    { type: 'component', componentName: 'wildfireMap', title: 'MULTI-AGENCY ACTIVE FIRE MAP' },
                    { type: 'component', componentName: 'activeIncidentList', title: 'AUTHORITATIVE ACTIVE WILDFIRES (NIFC WFIGS)' }
                ]
            },
            {
                type: 'column',
                width: 28,
                content: [
                    { type: 'component', componentName: 'nwsAlerts', title: 'NWS RED FLAG / WEATHER WARNINGS' },
                    { type: 'component', componentName: 'fireAnalytics', title: 'NATIONAL ACREAGE & CONTAINMENT METRICS' }
                ]
            },
            {
                type: 'column',
                width: 28,
                content: [
                    { type: 'component', componentName: 'satelliteHotspots', title: 'NASA FIRMS & EONET THERMAL HOTSPOTS' },
                    { type: 'component', componentName: 'airQualityPanel', title: 'AIRNOW SATELLITE & SMOKE AQI METRICS' }
                ]
            }
        ]
    }]
};

const layout = new GoldenLayout(config, '#desktopLayoutContainer');

// --- Component Registrations ---
layout.registerComponent('wildfireMap', function(container) {
    container.getElement().html(`
        <div style="position:relative; width:100%; height:100%; background:#0d1117;">
            <div id="mapControls" style="position:absolute; top:8px; left:8px; right:8px; z-index:1000; background:rgba(13, 17, 23, 0.88); backdrop-filter:blur(6px); border:1px solid #ff6600; padding:6px 12px; border-radius:4px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
                <div style="display:flex; align-items:center; gap:6px; color:#ff9900; font-weight:bold; font-size:0.75rem;">
                    <i class="fa-solid fa-fire-flame-curved" style="color:#ff3300; font-size:0.9rem;"></i> 
                    <span>WFIGS CONTROLS:</span>
                </div>
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <select id="stateFilter" style="background:#161b22; color:#00ffcc; border:1px solid #30363d; padding:4px 8px; font-family:'Share Tech Mono', monospace; font-size:0.72rem; border-radius:3px; cursor:pointer;" onchange="applyStateFilter()">
                        <option value="ALL">ALL STATES</option>
                    </select>
                    <button class="btn-control" style="color:#00ff55; font-size:0.72rem;" onclick="toggleAllWfigs(true)"><i class="fa-solid fa-eye"></i> ENABLE ALL</button>
                    <button class="btn-control" style="color:#ff5555; font-size:0.72rem;" onclick="toggleAllWfigs(false)"><i class="fa-solid fa-eye-slash"></i> DISABLE ALL</button>
                    <button class="btn-control" style="color:#00ffcc; font-size:0.72rem;" onclick="resetMapBounds()"><i class="fa-solid fa-compress"></i> RESET USA</button>
                    <button id="toggleEonetBtn" class="btn-control" style="color:#ff6600; font-size:0.72rem;" onclick="togglePerimeterOrEonetLayer('eonet')"><i class="fa-solid fa-globe"></i> EONET</button>
                    <button id="togglePerimetersBtn" class="btn-control" style="color:#ff9900; font-size:0.72rem;" onclick="togglePerimeterOrEonetLayer('perimeters')"><i class="fa-solid fa-draw-polygon"></i> PERIMETERS</button>
                </div>
            </div>

            <div id="mapLegend" style="position:absolute; bottom:24px; left:8px; z-index:1000; background:rgba(13, 17, 23, 0.88); backdrop-filter:blur(6px); border:1px solid #30363d; padding:6px 10px; border-radius:4px; font-size:0.65rem; color:#8b949e; display:flex; flex-direction:column; gap:3px; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
                <div><i class="fa-solid fa-fire-flame-curved" style="color:#ff3300;"></i> NIFC WFIGS Incident</div>
                <div><i class="fa-solid fa-fire-flame-curved" style="color:#ff6600;"></i> NASA EONET Incident</div>
                <div><i class="fa-solid fa-fire-flame-curved" style="color:#ff3300; font-size:0.85em;"></i> NASA FIRMS Hotspot</div>
                <div><span style="display:inline-block; width:10px; height:10px; background:rgba(255,51,0,0.35); border:1px solid #ff3300; border-radius:2px;"></span> Fire Perimeter (NIFC)</div>
            </div>
            
            <div id="leafletMapContainer" style="width:100%; height:100%;"></div>
        </div>
    `);
    
    setTimeout(() => {
        if (!activeLeafletMap) {
            activeLeafletMap = L.map('leafletMapContainer', { zoomControl: false }).setView([39.8283, -98.5795], 4);
            L.control.zoom({ position: 'bottomright' }).addTo(activeLeafletMap);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(activeLeafletMap);

            // Perimeters added first so incident/hotspot markers always render visually on top
            perimetersLayerGroup = L.layerGroup().addTo(activeLeafletMap);
            firmsMarkersGroup = L.layerGroup().addTo(activeLeafletMap);
            wfigsMarkersGroup = L.layerGroup().addTo(activeLeafletMap);
            eonetMarkersGroup = L.layerGroup().addTo(activeLeafletMap);
        }
        fetchAllData();
    }, 250);
});

layout.registerComponent('activeIncidentList', function(container) {
    container.getElement().html(`<div class="weather-component" id="wildfire-list-target">Querying NIFC WFIGS interagency nationwide wildfire network...</div>`);
    container.on('open', fetchWFIGSData);
});

layout.registerComponent('nwsAlerts', function(container) {
    container.getElement().html(`
        <div class="weather-component" style="position:relative;">
            <div style="margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #30363d; display:flex; justify-content:space-between; align-items:center;">
                <div style="font-size:0.85rem; color:#ffcc00; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> NWS RED FLAG / WEATHER WARNINGS</div>
                <button id="soundToggleBtn" onclick="toggleAlertSound()" class="btn-control" style="color:#8b949e; padding:2px 6px;" title="Toggle alert audio">
                    <i class="fa-solid fa-volume-mute"></i>
                </button>
            </div>
            <div id="alerts-container">Scanning NWS hazard feeds...</div>
        </div>`);
    container.on('open', fetchNWSAlerts);
});

layout.registerComponent('fireAnalytics', function(container) {
    container.getElement().html(`
        <div class="weather-component" style="display:flex; flex-direction:column; gap:10px;">
            
            <div style="background:rgba(13, 17, 23, 0.88); border:1px solid #ff6600; padding:6px 12px; border-radius:4px; display:flex; align-items:center; justify-content:space-between; gap:6px; box-shadow: 0 4px 12px rgba(0,0,0,0.6);">
                <div style="display:flex; align-items:center; gap:6px; color:#ff9900; font-weight:bold; font-size:0.75rem;">
                    <i class="fa-solid fa-chart-pie" style="color:#ff3300; font-size:0.9rem;"></i> 
                    <span>METRICS FILTER:</span>
                </div>
                <select id="metricsStateFilter" style="background:#161b22; color:#00ffcc; border:1px solid #30363d; padding:4px 8px; font-family:'Share Tech Mono', monospace; font-size:0.72rem; border-radius:3px; cursor:pointer;" onchange="applyMetricsFilter()">
                    <option value="ALL">ALL STATES</option>
                </select>
            </div>

            <div id="fire-summary-stats" style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:6px;">
                <div class="stat-card" onclick="openMetricsDetailModal('count')" title="Click for Detailed Incident List">
                    <div style="font-size:0.58rem; color:#8b949e; font-weight:bold;">TRACKED FIRES <i class="fa-solid fa-circle-info" style="color:#ff9900;"></i></div>
                    <div id="stat-count" style="font-size:1.15rem; color:#00ffcc; font-weight:bold; margin-top:2px;">--</div>
                </div>
                <div class="stat-card" onclick="openMetricsDetailModal('acres')" title="Click for Acreage Breakdown by State">
                    <div style="font-size:0.58rem; color:#8b949e; font-weight:bold;">ACREAGE BURNED <i class="fa-solid fa-circle-info" style="color:#ff9900;"></i></div>
                    <div id="stat-acres" style="font-size:1.15rem; color:#ff6600; font-weight:bold; margin-top:2px;">--</div>
                </div>
                <div class="stat-card" onclick="openMetricsDetailModal('contained')" title="Click for Containment Distribution">
                    <div style="font-size:0.58rem; color:#8b949e; font-weight:bold;">AVG CONTAINED <i class="fa-solid fa-circle-info" style="color:#ff9900;"></i></div>
                    <div id="stat-contained" style="font-size:1.15rem; color:#00ff55; font-weight:bold; margin-top:2px;">--</div>
                </div>
            </div>
            <div style="min-height:180px; position:relative; background:#161b22; border: 1px solid #30363d; border-radius:4px; padding:10px;">
                <canvas id="wildfireChart"></canvas>
            </div>
        </div>
    `);
    container.on('open', fetchWFIGSData);
});

layout.registerComponent('satelliteHotspots', function(container) {
    container.getElement().html(`
        <div class="weather-component">
            <div style="font-size:0.75rem; color:#ffcc00; font-weight:bold; margin-bottom:8px;"><i class="fa-solid fa-satellite"></i> NASA FIRMS THERMAL HOTSPOTS</div>
            <div id="firms-hotspots" style="display:flex; flex-direction:column; gap:6px; margin-bottom:14px;">
                <span style="color:#8b949e; font-size:0.8rem;">Contacting NASA FIRMS satellite feed...</span>
            </div>
            <div style="font-size:0.75rem; color:#ff9900; font-weight:bold; margin-bottom:8px; padding-top:8px; border-top:1px solid #30363d;"><i class="fa-solid fa-globe"></i> NASA EONET US WILDFIRE EVENTS</div>
            <div id="eonet-hotspots" style="display:flex; flex-direction:column; gap:6px;">
                <span style="color:#8b949e; font-size:0.8rem;">Contacting NASA EONET v3 feed...</span>
            </div>
        </div>
    `);
    container.on('open', () => { fetchFIRMSData(); fetchEONETData(); });
});

layout.registerComponent('airQualityPanel', function(container) {
    container.getElement().html(`<div class="weather-component" id="aqi-container-target">Interrogating AirNow multi-state observation sensors...</div>`);
    container.on('open', fetchAirQualityData);
});

layout.on('stateChanged', () => { if (activeLeafletMap) activeLeafletMap.invalidateSize(); });
layout.init();

document.addEventListener('click', () => { if (!alertAudio) initAlertSound(); }, { once: true });

function toggleAlertSound() {
    if (!alertAudio) initAlertSound();
    alertSoundEnabled = !alertSoundEnabled;
    const btn = document.getElementById('soundToggleBtn');
    if (btn) {
        if (alertSoundEnabled) {
            btn.style.borderColor = '#00ff55'; btn.style.color = '#00ff55';
            btn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
            playAlertSound();
        } else {
            btn.style.borderColor = '#30363d'; btn.style.color = '#8b949e';
            btn.innerHTML = '<i class="fa-solid fa-volume-mute"></i>';
        }
    }
}

function fetchAllData() {
    fetchFIRMSData();
    fetchEONETData();
    fetchWFIGSData();
    fetchWFIGSPerimeters();
    fetchNWSAlerts();
    fetchAirQualityData();
}

// --- NASA FIRMS API ---
function fetchFIRMSData() {
    const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/-125,24,-66,50/1`;

    fetch(firmsUrl)
        .then(res => res.text())
        .then(csvText => {
            const container = $('#firms-hotspots');
            if (!csvText || csvText.startsWith('Error') || csvText.trim().split('\n').length < 2) {
                container.html('<span style="color:#ff5555; font-size:0.75rem;"><i class="fa-solid fa-triangle-exclamation"></i> FIRMS satellite feed unavailable or empty.</span>');
                return;
            }

            const lines = csvText.trim().split('\n');
            const headers = lines[0].split(',');
            const latIdx = headers.indexOf('latitude'); const lonIdx = headers.indexOf('longitude');
            const dateIdx = headers.indexOf('acq_date'); const timeIdx = headers.indexOf('acq_time');
            const confIdx = headers.indexOf('confidence'); const frpIdx = headers.indexOf('frp');

            let hotspots = lines.slice(1).map((line, idx) => {
                const cols = line.split(',');
                return {
                    id: `firms-${idx}`, lat: parseFloat(cols[latIdx]), lon: parseFloat(cols[lonIdx]),
                    date: cols[dateIdx], time: cols[timeIdx], confidence: cols[confIdx] || 'N/A',
                    frp: parseFloat(cols[frpIdx]) || 0
                };
            }).filter(h => !isNaN(h.lat));

            hotspots.sort((a, b) => b.frp - a.frp);
            if (firmsMarkersGroup) firmsMarkersGroup.clearLayers();
            firmsMapMarkers = {};

            // Explicitly styled DivIcon for satellite hotspots
            const redFlameIcon = L.divIcon({
                html: '<i class="fa-solid fa-fire-flame-curved" style="color:#ff3300; font-size:15px; text-shadow:0 0 4px #ff0000; display:block;"></i>',
                className: 'fire-icon-red',
                iconSize: [16, 16], iconAnchor: [8, 8], popupAnchor: [0, -10]
            });

            hotspots.slice(0, 300).forEach(h => {
                if (activeLeafletMap) {
                    const marker = L.marker([h.lat, h.lon], {icon: redFlameIcon});
                    marker.bindPopup(`
                        <div style="font-family:'Share Tech Mono';">
                            <strong style="color:#ff3300; font-size:1rem;"><i class="fa-solid fa-fire-flame-curved"></i> FIRMS HOTSPOT</strong><br>
                            <hr style="border: 1px solid #30363d; margin: 6px 0;" />
                            <strong>Lat/Lon:</strong> ${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}<br>
                            <strong>Radiative Power:</strong> <span style="color:#ff9900; font-weight:bold;">${h.frp} MW</span><br>
                            <strong>Confidence:</strong> ${h.confidence}<br>
                            <strong>Acquired:</strong> ${h.date} @ ${h.time}Z
                        </div>
                    `);
                    firmsMapMarkers[h.id] = marker;
                    firmsMarkersGroup.addLayer(marker);
                }
            });

            let html = '';
            hotspots.slice(0, 80).forEach(h => {
                html += `
                    <div class="fire-card" onclick="openHotspotOnMap('${h.id}')">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="color:#ff3300; font-weight:bold; font-size:0.82rem;"><i class="fa-solid fa-fire-flame-curved"></i> FIRMS HOTSPOT ${h.id.split('-')[1]}</span>
                            <span style="color:#ff9900; font-size:0.75rem; font-weight:bold;">${h.frp} MW</span>
                        </div>
                        <div style="color:#8b949e; font-size:0.7rem; margin-top:4px;">
                            Loc: ${h.lat.toFixed(3)}, ${h.lon.toFixed(3)} | Conf: ${h.confidence}
                        </div>
                    </div>`;
            });
            container.html(html || '<span style="color:#00ff55; font-size:0.8rem;"><i class="fa-solid fa-check"></i> No active satellite hotspots.</span>');
        }).catch(err => console.error("FIRMS Error:", err));
}

// --- NASA EONET v3 Data Handler ---
// Docs: https://eonet.gsfc.nasa.gov/docs/v3
// EONET is a global feed, so we constrain to a US bounding box server-side (bbox param)
// and then re-verify client-side against CONUS/Alaska/Hawaii boxes, since bbox only
// filters against each event's overall geometry extent, not a strict point-in-box test.
function fetchEONETData() {
    const eonetUrl = 'https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&days=30&limit=100&bbox=-180,72,-65,15';

    fetch(eonetUrl)
        .then(res => res.json())
        .then(data => {
            const listTarget = $('#eonet-hotspots');
            if (eonetMarkersGroup) eonetMarkersGroup.clearLayers();
            globalEonetCache = {};
            eonetMapMarkers = {};

            if (!data || !data.events || data.events.length === 0) {
                listTarget.html('<span style="color:#00ff55; font-size:0.8rem;"><i class="fa-solid fa-check"></i> No open US wildfire events in EONET.</span>');
                return;
            }

            // Rough US bounding boxes: CONUS, Alaska, Hawaii
            const usBoxes = [
                { minLat: 24.4, maxLat: 49.5, minLon: -125.1, maxLon: -66.9 },
                { minLat: 51.0, maxLat: 71.6, minLon: -179.9, maxLon: -129.9 },
                { minLat: 18.7, maxLat: 22.5, minLon: -160.5, maxLon: -154.5 }
            ];
            const isInUSA = (lat, lon) => usBoxes.some(b => lat >= b.minLat && lat <= b.maxLat && lon >= b.minLon && lon <= b.maxLon);

            const eonetIcon = L.divIcon({
                html: '<i class="fa-solid fa-fire-flame-curved" style="color:#ff6600; font-size:18px; text-shadow:0 0 6px #ff3300; display:block;"></i>',
                className: 'fire-icon-red',
                iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -10]
            });

            let usEvents = [];

            data.events.forEach(evt => {
                if (!evt.geometry || evt.geometry.length === 0) return;
                const geom = evt.geometry[evt.geometry.length - 1];
                let lat = null, lon = null;

                if (geom.type === 'Point' && geom.coordinates && geom.coordinates.length >= 2) {
                    lon = geom.coordinates[0]; lat = geom.coordinates[1];
                } else if (geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0] && geom.coordinates[0][0]) {
                    lon = geom.coordinates[0][0][0]; lat = geom.coordinates[0][0][1];
                } else if (Array.isArray(geom.coordinates) && geom.coordinates.length >= 2 && typeof geom.coordinates[0] === 'number') {
                    lon = geom.coordinates[0]; lat = geom.coordinates[1];
                }

                if (lat === null || lon === null || isNaN(lat) || isNaN(lon)) return;
                if (!isInUSA(lat, lon)) return;

                usEvents.push({ evt, lat, lon, date: geom.date });
            });

            let html = '';
            usEvents.forEach((item, idx) => {
                const { evt, lat, lon, date } = item;
                const key = evt.id || `eonet-${idx}`;
                const sourceAgency = evt.sources && evt.sources[0] ? evt.sources[0].id : 'EONET';
                const sourceUrl = evt.sources && evt.sources[0] ? evt.sources[0].url : (evt.link || '');
                const dateStr = date ? new Date(date).toLocaleDateString() : 'N/A';

                globalEonetCache[key] = { title: evt.title, date: dateStr, source: sourceAgency, sourceUrl, lat, lon };

                if (activeLeafletMap) {
                    const marker = L.marker([lat, lon], { icon: eonetIcon });
                    marker.bindPopup(`
                        <div style="font-family:'Share Tech Mono';">
                            <strong style="color:#ff6600; font-size:0.95rem;"><i class="fa-solid fa-globe"></i> NASA EONET INCIDENT</strong><br>
                            <hr style="border: 1px solid #30363d; margin: 6px 0;" />
                            <strong>Title:</strong> ${evt.title}<br>
                            <strong>Report Date:</strong> ${dateStr}<br>
                            <strong>Source Agency:</strong> ${sourceAgency}
                        </div>
                    `);
                    eonetMapMarkers[key] = marker;
                    if (layerVisibility.eonet) eonetMarkersGroup.addLayer(marker);
                }

                html += `
                    <div class="fire-card" style="border-left-color:#ff6600;" onclick="openEonetOnMap('${key}')">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="color:#ff9900; font-weight:bold; font-size:0.8rem;"><i class="fa-solid fa-globe"></i> ${evt.title}</span>
                        </div>
                        <div style="color:#8b949e; font-size:0.7rem; margin-top:4px;">
                            Source: ${sourceAgency} | Reported: ${dateStr}
                        </div>
                    </div>`;
            });

            listTarget.html(html || '<span style="color:#00ff55; font-size:0.8rem;"><i class="fa-solid fa-check"></i> No open US wildfire events in EONET.</span>');

        }).catch(err => {
            console.error("EONET fetch error:", err);
            $('#eonet-hotspots').html('<span style="color:#ff5555; font-size:0.75rem;"><i class="fa-solid fa-triangle-exclamation"></i> EONET v3 feed unreachable.</span>');
        });
}

function openEonetOnMap(key) {
    const marker = eonetMapMarkers[key];
    if (!marker || !activeLeafletMap) return;
    if (!eonetMarkersGroup.hasLayer(marker)) { eonetMarkersGroup.addLayer(marker); layerVisibility.eonet = true; syncToggleButtonState(); }
    activeLeafletMap.flyTo(marker.getLatLng(), 10, { duration: 1.5 });
    setTimeout(() => marker.openPopup(), 1500);
}

// --- NIFC WFIGS Interagency Fire Perimeters (ArcGIS FeatureServer, real polygon geometry) ---
function fetchWFIGSPerimeters() {
    const perimeterUrl = `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=attr_IncidentTypeCategory%3D'WF'&outFields=attr_IncidentName,attr_IncidentSize,attr_PercentContained,attr_POOState,attr_IrwinID&returnGeometry=true&f=geojson`;

    fetch(perimeterUrl)
        .then(r => r.json())
        .then(geo => {
            if (perimetersLayerGroup) perimetersLayerGroup.clearLayers();
            globalPerimeterCache = {};
            if (!geo || !geo.features) return;

            geo.features.forEach(feature => {
                const p = feature.properties || {};
                if (p.attr_IrwinID) globalPerimeterCache[p.attr_IrwinID] = feature;

                const acres = p.attr_IncidentSize ? Math.round(p.attr_IncidentSize).toLocaleString() : 'N/A';
                const contained = (p.attr_PercentContained !== null && p.attr_PercentContained !== undefined) ? p.attr_PercentContained + '%' : 'N/A';

                const layer = L.geoJSON(feature, {
                    style: { color: '#ff3300', weight: 1.5, fillColor: '#ff3300', fillOpacity: 0.18, dashArray: '3,3' }
                });
                layer.bindPopup(`
                    <div style="font-family:'Share Tech Mono';">
                        <strong style="color:#ff3300; font-size:0.95rem;"><i class="fa-solid fa-draw-polygon"></i> ${p.attr_IncidentName || 'Unnamed Perimeter'}</strong><br>
                        <hr style="border: 1px solid #30363d; margin: 6px 0;" />
                        <strong>State:</strong> ${p.attr_POOState || 'N/A'}<br>
                        <strong>Mapped Acreage:</strong> ${acres} acres<br>
                        <strong>Containment:</strong> ${contained}
                    </div>
                `);

                if (layerVisibility.perimeters) perimetersLayerGroup.addLayer(layer);
            });
        }).catch(err => console.error("WFIGS perimeter fetch error:", err));
}

// --- Layer visibility toggles for EONET markers & real fire perimeters ---
function togglePerimeterOrEonetLayer(which) {
    if (which === 'eonet') {
        layerVisibility.eonet = !layerVisibility.eonet;
        if (!activeLeafletMap || !eonetMarkersGroup) return;
        eonetMarkersGroup.clearLayers();
        if (layerVisibility.eonet) Object.values(eonetMapMarkers).forEach(m => eonetMarkersGroup.addLayer(m));
    } else if (which === 'perimeters') {
        layerVisibility.perimeters = !layerVisibility.perimeters;
        if (layerVisibility.perimeters) fetchWFIGSPerimeters();
        else if (perimetersLayerGroup) perimetersLayerGroup.clearLayers();
    }
    syncToggleButtonState();
}

function syncToggleButtonState() {
    const eBtn = document.getElementById('toggleEonetBtn');
    const pBtn = document.getElementById('togglePerimetersBtn');
    if (eBtn) { eBtn.style.opacity = layerVisibility.eonet ? '1' : '0.4'; }
    if (pBtn) { pBtn.style.opacity = layerVisibility.perimeters ? '1' : '0.4'; }
}

function openHotspotOnMap(id) {
    const marker = firmsMapMarkers[id];
    if (marker && activeLeafletMap) {
        activeLeafletMap.flyTo(marker.getLatLng(), 11, { duration: 1.5 });
        setTimeout(() => marker.openPopup(), 1500);
    }
}

// --- Authoritative NIFC WFIGS Active Fires Handler ---
function fetchWFIGSData() {
    const wfigsUrl = `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=IncidentTypeCategory%3D'WF'&outFields=*&returnGeometry=true&f=json`;
    
    fetch(wfigsUrl)
        .then(r => r.json())
        .then(wfigsData => {
            const feats = (wfigsData && wfigsData.features) ? wfigsData.features : [];
            const incidents = feats
                .map(f => ({ attributes: f.attributes, geometry: f.geometry }))
                .filter(item => item.attributes.IncidentSize > 0)
                .sort((a, b) => (b.attributes.IncidentSize || 0) - (a.attributes.IncidentSize || 0));

            globalWildfireCache = {};
            globalWildfireMapCache = {};
            if (wfigsMarkersGroup) wfigsMarkersGroup.clearLayers();
            
            const currentStateFilter = document.getElementById('stateFilter') ? document.getElementById('stateFilter').value : 'ALL';

            // Explicitly styled DivIcon ensures glowing red fire icons show up reliably for all incidents
            const wfigsRedIcon = L.divIcon({
                html: '<i class="fa-solid fa-fire-flame-curved" style="color:#ff3300; font-size:18px; text-shadow:0 0 6px rgba(255,51,0,0.9); display:block;"></i>',
                className: 'wfigs-icon-red',
                iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -10]
            });

            let statesSet = new Set();
            let bounds = [];

            incidents.forEach((item, idx) => {
                const attr = item.attributes;
                const fireKey = `wfigs-${idx}`;
                globalWildfireCache[fireKey] = attr;

                const name = attr.IncidentName || attr.ComplexName || 'Unnamed Incident';
                const size = attr.IncidentSize ? Math.round(attr.IncidentSize).toLocaleString() : 'Unknown';
                const contained = attr.PercentContained !== null && attr.PercentContained !== undefined ? attr.PercentContained + '%' : 'N/A';
                const state = attr.POOState || 'US';
                const county = attr.POOCounty || '';
                if (state !== 'US') statesSet.add(state);

                const lat = (item.geometry && item.geometry.y) ? item.geometry.y : null;
                const lon = (item.geometry && item.geometry.x) ? item.geometry.x : null;

                if (lat && lon) {
                    const marker = L.marker([lat, lon], {icon: wfigsRedIcon});
                    marker.bindPopup(`
                        <div style="font-family:'Share Tech Mono';">
                            <strong style="color:#ff3300; font-size:1rem; text-transform:uppercase;"><i class="fa-solid fa-fire-flame-curved"></i> ${name}</strong><br>
                            <hr style="border: 1px solid #30363d; margin: 6px 0;" />
                            <strong>State/County:</strong> ${state}, ${county || 'N/A'}<br>
                            <strong>Acreage:</strong> ${size} acres<br>
                            <strong>Containment:</strong> ${contained}<br>
                            <strong>Discovered:</strong> ${attr.FireDiscoveryDateTime ? new Date(attr.FireDiscoveryDateTime).toLocaleDateString() : 'N/A'}<br>
                            <strong>Agency/Type:</strong> ${attr.POOOwnerAgency || 'Interagency'} (${attr.IncidentTypeCategory || 'WF'})
                        </div>
                    `, { className: 'wfigs-popup' });

                    globalWildfireMapCache[fireKey] = { marker: marker, state: state, lat: lat, lon: lon, enabled: true };
                    
                    if (currentStateFilter === 'ALL' || currentStateFilter === state) {
                        wfigsMarkersGroup.addLayer(marker);
                        bounds.push([lat, lon]);
                    }
                }
            });

            // Populate Map Dropdown Options
            const selectElMap = document.getElementById('stateFilter');
            const sortedStates = Array.from(statesSet).sort();
            if (selectElMap) {
                let optionsHtmlMap = `<option value="ALL">ALL STATES</option>`;
                sortedStates.forEach(s => { optionsHtmlMap += `<option value="${s}" ${currentStateFilter === s ? 'selected' : ''}>${s}</option>`; });
                selectElMap.innerHTML = optionsHtmlMap;
            }

            // Populate Analytics/Metrics Dropdown
            const selectElMetrics = document.getElementById('metricsStateFilter');
            if (selectElMetrics) {
                const currentMetricsFilter = selectElMetrics.value || 'ALL';
                let optionsHtmlMetrics = `<option value="ALL">ALL STATES</option>`;
                sortedStates.forEach(s => { optionsHtmlMetrics += `<option value="${s}" ${currentMetricsFilter === s ? 'selected' : ''}>${s}</option>`; });
                selectElMetrics.innerHTML = optionsHtmlMetrics;
            }

            // Render Incident List Pane synchronized with Map Filter
            renderWFIGSList(currentStateFilter);
            
            // Auto-Fit all active markers to map bounds on initial load
            if (!initialMapFit && bounds.length > 0 && activeLeafletMap) {
                activeLeafletMap.fitBounds(L.latLngBounds(bounds), {padding: [50, 50]});
                initialMapFit = true;
            }

            const activeMetricsFilter = selectElMetrics ? selectElMetrics.value : 'ALL';
            updateMetricsDisplay(activeMetricsFilter);

        }).catch(err => {
            console.error("WFIGS feed error:", err);
            $('#wildfire-list-target').html('<span style="color:#ff5555; font-size:0.8rem;">INCIDENT WFIGS FEED TIMEOUT</span>');
        });
}

// --- Render Synchronized WFIGS Active Incident List ---
function renderWFIGSList(stateFilter = 'ALL') {
    const target = $('#wildfire-list-target');
    if (!target.length) return;

    let incidents = Object.keys(globalWildfireCache).map(key => ({
        key: key,
        attr: globalWildfireCache[key]
    }));

    // Filter list pane by selected state
    if (stateFilter !== 'ALL') {
        incidents = incidents.filter(item => (item.attr.POOState || 'US') === stateFilter);
    }

    // Sort by acreage footprint descending
    incidents.sort((a, b) => (b.attr.IncidentSize || 0) - (a.attr.IncidentSize || 0));

    if (incidents.length === 0) {
        target.html(`<span style="color:#00ff55; font-size:0.8rem;"><i class="fa-solid fa-check"></i> NO ACTIVE INCIDENTS REPORTED FOR ${stateFilter}</span>`);
        return;
    }

    let listHtml = '';
    incidents.forEach(item => {
        const attr = item.attr;
        const fireKey = item.key;
        const name = attr.IncidentName || attr.ComplexName || 'Unnamed Incident';
        const size = attr.IncidentSize ? Math.round(attr.IncidentSize).toLocaleString() : 'Unknown';
        const contained = attr.PercentContained !== null && attr.PercentContained !== undefined ? attr.PercentContained + '%' : 'N/A';
        const state = attr.POOState || 'US';
        const county = attr.POOCounty || '';

        listHtml += `
            <div class="fire-card wfigs-card" style="border-left-color: #ff3300;" onclick="openWfigsOnMap('${fireKey}')" title="Click to navigate to map position and view perimeter">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="color:#ff9900; font-weight:bold; font-size:0.85rem;"><i class="fa-solid fa-fire-flame-curved" style="color:#ff3300;"></i> ${name.toUpperCase()} (${state})</span>
                    <span style="color:#00ff55; font-size:0.75rem; font-weight:bold;">${contained} Contained</span>
                </div>
                <div style="color:#8b949e; font-size:0.7rem; margin-top:3px;">
                    County: ${county || 'N/A'} | Size: <strong style="color:#ff6600;">${size} acres</strong>
                </div>
            </div>`;
    });

    target.html(listHtml);
}

// --- Dynamic Map Controls & Filtering Logic ---
function applyStateFilter() {
    const state = document.getElementById('stateFilter').value;
    let bounds = [];
    wfigsMarkersGroup.clearLayers();
    
    // 1. Display state incidents on map
    Object.values(globalWildfireMapCache).forEach(item => {
        if (state === 'ALL' || item.state === state) {
            item.enabled = true;
            wfigsMarkersGroup.addLayer(item.marker);
            bounds.push([item.lat, item.lon]);
        } else {
            item.enabled = false;
        }
    });
    
    // 2. Zoom & pan map to fit state incidents
    if (bounds.length > 0 && activeLeafletMap) {
        activeLeafletMap.fitBounds(L.latLngBounds(bounds), {padding: [50, 50]});
    }

    // 3. Synchronize active incident list pane below map to show only selected state
    renderWFIGSList(state);
}

function toggleAllWfigs(show) {
    document.getElementById('stateFilter').value = 'ALL';
    wfigsMarkersGroup.clearLayers();
    let bounds = [];
    
    Object.values(globalWildfireMapCache).forEach(item => {
        item.enabled = show;
        if (show) {
            wfigsMarkersGroup.addLayer(item.marker);
            bounds.push([item.lat, item.lon]);
        }
    });
    
    if (show && bounds.length > 0 && activeLeafletMap) {
        activeLeafletMap.fitBounds(L.latLngBounds(bounds), {padding: [50, 50]});
    }

    renderWFIGSList('ALL');
}

function resetMapBounds() {
    document.getElementById('stateFilter').value = 'ALL';
    applyStateFilter();
    if (activeLeafletMap) activeLeafletMap.setView([39.8283, -98.5795], 4);
}

// --- Dynamic Metrics Panel Handlers ---
function applyMetricsFilter() {
    const state = document.getElementById('metricsStateFilter').value;
    updateMetricsDisplay(state);
}

function updateMetricsDisplay(stateFilter) {
    let items = Object.values(globalWildfireCache);
    let filteredItems = stateFilter === 'ALL' ? items : items.filter(i => i.POOState === stateFilter);
    
    let totalAcres = 0;
    let containedSum = 0;
    let containedCount = 0;

    filteredItems.forEach(attr => {
        if (attr.IncidentSize) totalAcres += attr.IncidentSize;
        if (attr.PercentContained !== null && attr.PercentContained !== undefined) {
            containedSum += attr.PercentContained; 
            containedCount++;
        }
    });

    $('#stat-count').text(filteredItems.length);
    $('#stat-acres').text(Math.round(totalAcres).toLocaleString());
    $('#stat-contained').text(containedCount > 0 ? Math.round(containedSum / containedCount) + '%' : 'N/A');

    let topForChart = [...filteredItems].sort((a,b) => (b.IncidentSize || 0) - (a.IncidentSize || 0)).slice(0, 8);
    let formattedForChart = topForChart.map(attr => ({ attributes: attr }));
    
    renderWildfireChart(formattedForChart);
}

function openWfigsOnMap(key) {
    const item = globalWildfireMapCache[key];
    const attr = globalWildfireCache[key];
    if (!item || !attr || !activeLeafletMap) return;
    
    if (activePerimeter) { activeLeafletMap.removeLayer(activePerimeter); activePerimeter = null; }

    // Prefer the authoritative NIFC mapped perimeter polygon (joined via IrwinID) over an estimate
    const realPerimeter = attr.IrwinID ? globalPerimeterCache[attr.IrwinID] : null;

    if (realPerimeter) {
        activePerimeter = L.geoJSON(realPerimeter, {
            style: { color: '#ff3300', fillColor: '#ff3300', fillOpacity: 0.3, weight: 2 }
        }).addTo(activeLeafletMap);
    } else {
        const acres = attr.IncidentSize || 0;
        if (acres > 0) {
            const radiusMeters = Math.sqrt((acres * 4046.86) / Math.PI);
            activePerimeter = L.circle([item.lat, item.lon], {
                color: '#ff3300', fillColor: '#ff3300', fillOpacity: 0.25, weight: 2, dashArray: '4, 4'
            }).addTo(activeLeafletMap);
        }
    }
    
    if (!wfigsMarkersGroup.hasLayer(item.marker)) {
        wfigsMarkersGroup.addLayer(item.marker);
        item.enabled = true;
    }

    if (realPerimeter && activePerimeter.getBounds && activePerimeter.getBounds().isValid()) {
        activeLeafletMap.flyToBounds(activePerimeter.getBounds(), { duration: 1.5, padding: [60, 60] });
    } else {
        activeLeafletMap.flyTo([item.lat, item.lon], 12, { duration: 1.5 });
    }
    setTimeout(() => item.marker.openPopup(), 1500);
}

// --- Interactive Detailed Modal for Clickable Metrics ---
function openMetricsDetailModal(type) {
    const currentStateFilter = document.getElementById('metricsStateFilter') ? document.getElementById('metricsStateFilter').value : 'ALL';
    const keys = Object.keys(globalWildfireCache);
    
    if (keys.length === 0) {
        openFloatingModal("METRICS REPORT", "<p>Wildfire dataset is currently syncing. Please wait a moment...</p>");
        return;
    }

    let allItems = keys.map(k => globalWildfireCache[k]);
    let items = currentStateFilter === 'ALL' ? allItems : allItems.filter(i => i.POOState === currentStateFilter);
    
    let stateMap = {};
    let containmentBins = { "0-25%": 0, "26-50%": 0, "51-75%": 0, "76-99%": 0, "100%": 0, "Unreported": 0 };
    let totalAcres = 0;

    items.forEach(item => {
        let st = item.POOState || 'US';
        let sz = item.IncidentSize || 0;
        let c = item.PercentContained;

        totalAcres += sz;
        if (!stateMap[st]) stateMap[st] = { count: 0, acres: 0 };
        stateMap[st].count += 1;
        stateMap[st].acres += sz;

        if (c === null || c === undefined) containmentBins["Unreported"]++;
        else if (c === 100) containmentBins["100%"]++;
        else if (c >= 76) containmentBins["76-99%"]++;
        else if (c >= 51) containmentBins["51-75%"]++;
        else if (c >= 26) containmentBins["26-50%"]++;
        else containmentBins["0-25%"]++;
    });

    let sortedStates = Object.keys(stateMap).sort((a,b) => stateMap[b].acres - stateMap[a].acres);
    let titlePrefix = currentStateFilter === 'ALL' ? "NATIONAL" : `${currentStateFilter} STATE`;

    let title = "";
    let html = "";

    if (type === 'acres') {
        title = `${titlePrefix} ACREAGE BURNED ANALYSIS`;
        html = `
            <div style="margin-bottom:15px; background:#0d1117; padding:12px; border-radius:4px; border:1px solid #ff6600;">
                <div style="font-size:0.95rem; color:#ff9900; font-weight:bold;"><i class="fa-solid fa-chart-pie"></i> TOTAL BURN AREA: ${Math.round(totalAcres).toLocaleString()} ACRES</div>
                <div style="font-size:0.75rem; color:#8b949e; margin-top:4px;">Reported burn acreage compiled across NIFC Interagency and State Geographic Areas.</div>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.8rem; text-align:left;">
                <thead>
                    <tr style="border-bottom:2px solid #30363d; color:#00ffcc;">
                        <th style="padding:8px;">STATE / REGION</th>
                        <th style="padding:8px;">ACTIVE FIRES</th>
                        <th style="padding:8px;">TOTAL ACRES BURNED</th>
                        <th style="padding:8px;">% OF FILTERED TOTAL</th>
                    </tr>
                </thead>
                <tbody>`;
        sortedStates.forEach(st => {
            let pct = totalAcres > 0 ? ((stateMap[st].acres / totalAcres) * 100).toFixed(1) : 0;
            html += `
                <tr style="border-bottom:1px solid #21262d;">
                    <td style="padding:8px; font-weight:bold; color:#ff9900;">${st}</td>
                    <td style="padding:8px;">${stateMap[st].count}</td>
                    <td style="padding:8px; color:#ff6600; font-weight:bold;">${Math.round(stateMap[st].acres).toLocaleString()}</td>
                    <td style="padding:8px;">${pct}%</td>
                </tr>`;
        });
        html += `</tbody></table>`;
    } else if (type === 'contained') {
        title = `${titlePrefix} FIRE CONTAINMENT DISTRIBUTION`;
        html = `
            <div style="margin-bottom:15px; background:#0d1117; padding:12px; border-radius:4px; border:1px solid #00ff55;">
                <div style="font-size:0.95rem; color:#00ff55; font-weight:bold;"><i class="fa-solid fa-shield-halved"></i> CONTAINMENT PROGRESSION BREAKDOWN</div>
                <div style="font-size:0.75rem; color:#8b949e; margin-top:4px;">Perimeter containment progress across tracked active wildland fires.</div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px; margin-bottom:15px;">`;
        
        Object.keys(containmentBins).forEach(bin => {
            html += `
                <div style="background:#0d1117; border:1px solid #30363d; padding:12px; border-radius:4px; text-align:center;">
                    <div style="font-size:0.7rem; color:#8b949e;">${bin} CONTAINED</div>
                    <div style="font-size:1.5rem; color:#00ffcc; font-weight:bold; margin:4px 0;">${containmentBins[bin]}</div>
                    <div style="font-size:0.65rem; color:#8b949e;">Fires</div>
                </div>`;
        });
        html += `</div>`;
    } else {
        title = `${titlePrefix} ACTIVE TRACKED INCIDENTS LISTING`;
        html = `
            <div style="margin-bottom:15px; background:#0d1117; padding:12px; border-radius:4px; border:1px solid #00ffcc;">
                <div style="font-size:0.95rem; color:#00ffcc; font-weight:bold;"><i class="fa-solid fa-fire-flame-curved" style="color:#ff3300;"></i> TOTAL TRACKED INCIDENTS: ${items.length}</div>
                <div style="font-size:0.75rem; color:#8b949e; margin-top:4px;">NIFC WFIGS active wildland fire incidents sorted by footprint size.</div>
            </div>
            <div style="max-height:350px; overflow-y:auto;">
                <table style="width:100%; border-collapse:collapse; font-size:0.8rem; text-align:left;">
                    <thead>
                        <tr style="border-bottom:2px solid #30363d; color:#00ffcc;">
                            <th style="padding:6px;">INCIDENT NAME</th>
                            <th style="padding:6px;">STATE</th>
                            <th style="padding:6px;">ACRES</th>
                            <th style="padding:6px;">CONTAINMENT</th>
                        </tr>
                    </thead>
                    <tbody>`;
        items.forEach(item => {
            html += `
                <tr style="border-bottom:1px solid #21262d;">
                    <td style="padding:6px; color:#ff9900; font-weight:bold;">${item.IncidentName || 'Unnamed'}</td>
                    <td style="padding:6px;">${item.POOState || 'US'}</td>
                    <td style="padding:6px; color:#ff6600;">${item.IncidentSize ? Math.round(item.IncidentSize).toLocaleString() : 'N/A'}</td>
                    <td style="padding:6px; color:#00ff55;">${item.PercentContained !== undefined && item.PercentContained !== null ? item.PercentContained + '%' : 'N/A'}</td>
                </tr>`;
        });
        html += `</tbody></table></div>`;
    }

    openFloatingModal(title, html);
}

function renderWildfireChart(topIncidents) {
    const ctx = document.getElementById('wildfireChart').getContext('2d');
    if (wildfireChartInstance) wildfireChartInstance.destroy();

    Chart.defaults.color = '#8b949e'; Chart.defaults.font.family = "'Share Tech Mono', monospace";
    const labels = topIncidents.map(i => i.attributes.IncidentName || 'Unnamed');
    const sizes = topIncidents.map(i => i.attributes.IncidentSize || 0);

    if (sizes.length === 0) return;
    wildfireChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{ label: 'Acreage', data: sizes, backgroundColor: 'rgba(255, 102, 0, 0.65)', borderColor: '#ff6600', borderWidth: 1 }]
        },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { grid: { color: '#21262d' } }, y: { grid: { color: '#21262d' }, ticks: { font: { size: 9 } } } }
        }
    });
}

function fetchNWSAlerts() {
    const container = $('#alerts-container');
    fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert')
        .then(res => res.json())
        .then(data => {
            const features = data.features || [];
            const fireAlerts = features.filter(f => (f.properties.event || '').toLowerCase().includes('fire weather') || (f.properties.event || '').toLowerCase().includes('red flag')).slice(0, 20);
            globalAlertsCache = {};
            let html = ''; let alertCount = fireAlerts.length;

            if (alertCount > 0) {
                fireAlerts.forEach(f => {
                    globalAlertsCache[f.properties.id] = f.properties;
                    html += `
                        <div class="fire-card" style="border-left-color: #ff3333;" onclick="openAlertDetails('${f.properties.id}')">
                            <div style="color: #ff5555; font-weight: bold; font-size:0.78rem;">${f.properties.event.toUpperCase()}</div>
                            <div style="color:#8b949e; font-size:0.7rem; margin-top:2px;">${f.properties.areaDesc}</div>
                        </div>`;
                });
            } else { html = "<span style='color:#00ff55; font-size:0.8rem;'><i class='fa-solid fa-check'></i> NO ACTIVE RED FLAG WARNINGS</span>"; }

            if (alertCount > previousAlertCount && alertCount > 0) playAlertSound();
            previousAlertCount = alertCount; container.html(html);
        }).catch(() => container.html('<span style="color:#ff5555; font-size:0.8rem;">ALERT FEED UNREACHABLE</span>'));
}

function openAlertDetails(id) {
    const alert = globalAlertsCache[id];
    if (!alert) return;
    let body = `<div style="color:#ff5555; font-weight:bold; margin-bottom:10px; border-bottom:1px solid #30363d; padding-bottom:8px;">${alert.headline || alert.event}</div>`;
    body += `<div style="color:#8b949e; margin-bottom:8px;"><strong>Affected Areas:</strong> ${alert.areaDesc}</div>`;
    body += `<div style="color:#fff; background:#0d1117; padding:12px; border-radius:4px; border:1px solid #21262d; font-family:monospace; font-size:0.85rem; white-space:pre-wrap;">${alert.description}</div>`;
    openFloatingModal("NWS FIRE ADVISORY DETAILS", body);
}

function fetchAirQualityData() {
    const sampleCoords = [
        { name: "California (West)", lat: 38.5816, lon: -121.4944, state: "California" },
        { name: "Colorado (Rockies)", lat: 39.7392, lon: -104.9903, state: "Colorado" },
        { name: "Texas (South)", lat: 30.2672, lon: -97.7431, state: "Texas" },
        { name: "New York (East)", lat: 40.7128, lon: -74.0060, state: "New York" }
    ];

    let promises = sampleCoords.map(loc => 
        fetch(`https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${loc.lat}&longitude=${loc.lon}&distance=75&API_KEY=${AIRNOW_API_KEY}`)
            .then(res => res.json()).then(data => ({ data, meta: loc })).catch(() => ({ data: [], meta: loc }))
    );

    Promise.all(promises).then(results => {
        let html = `<div style="font-size:0.75rem; color:#ffcc00; font-weight:bold; margin-bottom:8px;"><i class="fa-solid fa-wind"></i> CLICK AQI SENSOR CARD FOR DETAILS</div>`;
        html += `<div style="display:flex; flex-direction:column; gap:6px;">`;
        let hasData = false;
        
        results.forEach((item) => {
            if (item.data && item.data.length > 0) {
                hasData = true; const regionName = item.meta.name;
                html += `<div style="background:#161b22; border:1px solid #30363d; padding:8px; border-radius:3px;">`;
                html += `<div style="font-size:0.72rem; color:#00ffcc; font-weight:bold; margin-bottom:4px;">${regionName}</div>`;
                html += `<div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:4px;">`;
                
                item.data.forEach(p => {
                    const color = p.AQI > 150 ? '#ff0000' : p.AQI > 100 ? '#ff7e00' : p.AQI > 50 ? '#ffcc00' : '#00ff55';
                    const payloadString = encodeURIComponent(JSON.stringify({ region: regionName, state: item.meta.state, parameter: p.ParameterName, aqi: p.AQI, category: p.Category ? p.Category.Name : 'N/A', site: p.ReportingArea || 'Unknown Sensor' }));
                    html += `
                        <div class="aqi-interactive-card" style="text-align:center; border-radius:2px;" onclick="openAQIDetails('${payloadString}')">
                            <div style="font-size:0.6rem; color:#8b949e;">${p.ParameterName}</div>
                            <div style="font-size:1.1rem; color:${color}; font-weight:bold;">${p.AQI}</div>
                            <div style="font-size:0.55rem; color:${color};">${p.Category ? p.Category.Name : ''}</div>
                        </div>`;
                });
                html += `</div></div>`;
            }
        });

        if (!hasData) html += `<div style="color:#8b949e; font-size:0.75rem;">No active multi-state particulate feeds responding.</div>`;
        $('#aqi-container-target').html(html + `</div>`);
    }).catch(() => $('#aqi-container-target').html('<span style="color:#ff5555; font-size:0.8rem;">AirNow multi-state feed unavailable</span>'));
}

function openAQIDetails(encodedStr) {
    const info = JSON.parse(decodeURIComponent(encodedStr));
    let body = `<div style="color:#ff9900; font-weight:bold; font-size:1.1rem; margin-bottom:10px; border-bottom:1px solid #30363d; padding-bottom:8px;">Air Quality Monitor Report: ${info.region}</div>`;
    body += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px; font-size:0.85rem;">
        <div><strong>Reporting Area:</strong> ${info.site}</div><div><strong>Parameter:</strong> ${info.parameter}</div>
        <div><strong>AQI Index:</strong> <span style="color:#ff6600; font-weight:bold;">${info.aqi}</span></div><div><strong>Category:</strong> ${info.category}</div>
    </div>`;
    body += `<div style="color:#00ffcc; background:#161b22; padding:12px; border-radius:4px; border:1px solid #30363d; font-family:monospace; font-size:0.85rem;">
        <i class="fa-solid fa-wind"></i> <strong>DATA SOURCE CONFIRMATION:</strong> Pulled securely from EPA AirNow API for <strong>${info.state}</strong>.
    </div>`;
    openFloatingModal(`AQI TELEMETRY: ${info.parameter} (${info.region})`, body);
}

function openFloatingModal(title, textHTML) {
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalBody').innerHTML = textHTML;
    document.getElementById('hubFloatingModal').style.display = 'flex';
}
function closeFloatingModal() { document.getElementById('hubFloatingModal').style.display = 'none'; document.getElementById('modalBody').innerHTML = ''; }

setInterval(() => {
    countdownVal--;
    if (countdownVal <= 0) { countdownVal = 120; fetchAllData(); }
    const targetTimer = document.getElementById('countdown');
    if (targetTimer) targetTimer.innerText = countdownVal;
}, 1000);

window.addEventListener('resize', () => { layout.updateSize(); });
