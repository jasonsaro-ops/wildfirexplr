// --- WILDFIREXPLR Core Configuration & State ---
let countdownVal = 120;

const AIRNOW_API_KEY = "E5AFEF36-80F6-4A42-AE38-F3C56E3AEAC4"; 
const FIRMS_MAP_KEY = "215020163103e2209b2fb8253d20b037";

let globalWildfireCache = {};
let globalWildfireMapCache = {}; 
let globalAlertsCache = {};
let firmsMapMarkers = {}; 
let wildfireChartInstance = null;

let activeLeafletMap = null;
let firmsMarkersGroup = null;
let wfigsMarkersGroup = null;
let activePerimeter = null;

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

// --- Golden Layout Structural Grid ---
const config = {
    settings: { hasHeaders: true, reorderEnabled: true, showPopoutIcon: false, showMaximiseIcon: true, showCloseIcon: false },
    content: [{
        type: 'row',
        content: [
            {
                type: 'column',
                width: 42,
                content: [
                    { type: 'component', componentName: 'wildfireMap', title: 'MULTI-AGENCY ACTIVE FIRE / HOTSPOT MAP' },
                    { type: 'component', componentName: 'activeIncidentList', title: 'AUTHORITATIVE ACTIVE WILDFIRES (NIFC WFIGS)' }
                ]
            },
            {
                type: 'column',
                width: 30,
                content: [
                    { type: 'component', componentName: 'nwsAlerts', title: 'NWS FIRE WEATHER WARNING MATRIX' },
                    { type: 'component', componentName: 'fireAnalytics', title: 'NATIONAL ACREAGE & CONTAINMENT METRICS' }
                ]
            },
            {
                type: 'column',
                width: 28,
                content: [
                    { type: 'component', componentName: 'satelliteHotspots', title: 'NASA FIRMS SATELLITE THERMAL HOTSPOTS' },
                    { type: 'component', componentName: 'airQualityPanel', title: 'NATIONAL AIRNOW SMOKE & AQI METRICS' }
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
            <!-- Custom Map Controls -->
            <div id="mapControls" style="position:absolute; top:15px; right:15px; z-index:1000; background:rgba(22,27,34,0.9); border:1px solid #ff6600; padding:10px; border-radius:5px; width:220px; display:flex; flex-direction:column; gap:8px; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
                <div style="color:#ff9900; font-weight:bold; text-align:center; font-size:0.85rem;"><i class="fa-solid fa-satellite-dish"></i> WFIGS MAP CONTROLS</div>
                <select id="stateFilter" style="background:#0d1117; color:#00ffcc; border:1px solid #30363d; padding:6px; font-family:'Share Tech Mono', monospace; cursor:pointer;" onchange="applyStateFilter()">
                    <option value="ALL">SHOW ALL STATES</option>
                </select>
                <div style="display:flex; gap:5px;">
                    <button class="btn-control" style="color:#00ff55;" onclick="toggleAllWfigs(true)">ENABLE ALL</button>
                    <button class="btn-control" style="color:#ff5555;" onclick="toggleAllWfigs(false)">DISABLE</button>
                </div>
                <button class="btn-control" style="color:#00ffcc;" onclick="resetMapBounds()">RESET USA VIEW</button>
            </div>
            
            <div id="leafletMapContainer" style="width:100%; height:100%;"></div>
        </div>
    `);
    
    setTimeout(() => {
        if (!activeLeafletMap) {
            activeLeafletMap = L.map('leafletMapContainer', { zoomControl: false }).setView([39.8283, -98.5795], 4);
            L.control.zoom({ position: 'bottomright' }).addTo(activeLeafletMap);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 18 }).addTo(activeLeafletMap);

            firmsMarkersGroup = L.layerGroup().addTo(activeLeafletMap);
            wfigsMarkersGroup = L.layerGroup().addTo(activeLeafletMap);
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
                <div style="font-size:0.85rem; color:#ffcc00; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> NWS FIRE / RED FLAG WARNINGS</div>
                <button id="soundToggleBtn" onclick="toggleAlertSound()" class="btn-control" style="color:#8b949e; flex:0;" title="Toggle alert sound">
                    <i class="fa-solid fa-volume-mute"></i>
                </button>
            </div>
            <div id="alerts-container">Scanning NWS fire hazard warning feeds...</div>
        </div>`);
    container.on('open', fetchNWSAlerts);
});

layout.registerComponent('fireAnalytics', function(container) {
    container.getElement().html(`
        <div class="weather-component" style="display:flex; flex-direction:column; gap:10px;">
            <div id="fire-summary-stats" style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:6px;">
                <div style="background:#161b22; border:1px solid #30363d; border-radius:3px; padding:6px; text-align:center;"><div style="font-size:0.6rem; color:#8b949e;">TRACKED FIRES</div><div id="stat-count" style="font-size:1.2rem; color:#00ffcc; font-weight:bold;">--</div></div>
                <div style="background:#161b22; border:1px solid #30363d; border-radius:3px; padding:6px; text-align:center;"><div style="font-size:0.6rem; color:#8b949e;">ACREAGE BURNED</div><div id="stat-acres" style="font-size:1.2rem; color:#ff6600; font-weight:bold;">--</div></div>
                <div style="background:#161b22; border:1px solid #30363d; border-radius:3px; padding:6px; text-align:center;"><div style="font-size:0.6rem; color:#8b949e;">AVG CONTAINED</div><div id="stat-contained" style="font-size:1.2rem; color:#00ff55; font-weight:bold;">--</div></div>
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
            <div style="font-size:0.75rem; color:#ffcc00; font-weight:bold; margin-bottom:8px;"><i class="fa-solid fa-satellite"></i> NATIONAL FIRMS HOTSPOTS (CLICK TO CENTER ON MAP)</div>
            <div id="firms-hotspots" style="display:flex; flex-direction:column; gap:6px;">
                <span style="color:#8b949e; font-size:0.8rem;">Contacting NASA FIRMS satellite feed...</span>
            </div>
        </div>
    `);
    container.on('open', fetchFIRMSData);
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
    fetchWFIGSData();
    fetchNWSAlerts();
    fetchAirQualityData();
}

// --- NASA LANCE FIRMS API Map & Hotspots Handler ---
function fetchFIRMSData() {
    const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/-125,24,-66,50/1`;

    fetch(firmsUrl)
        .then(res => res.text())
        .then(csvText => {
            const container = $('#firms-hotspots');
            if (!csvText || csvText.startsWith('Error') || csvText.trim().split('\n').length < 2) {
                container.html('<span style="color:#ff5555; font-size:0.75rem;"><i class="fa-solid fa-triangle-exclamation"></i> FIRMS satellite feed unavailable or empty at this time.</span>');
                return;
            }

            const lines = csvText.trim().split('\n');
            const headers = lines[0].split(',');
            const latIdx = headers.indexOf('latitude'); const lonIdx = headers.indexOf('longitude');
            const dateIdx = headers.indexOf('acq_date'); const timeIdx = headers.indexOf('acq_time');
            const confIdx = headers.indexOf('confidence'); const frpIdx = headers.indexOf('frp');
            const satIdx = headers.indexOf('satellite');

            let hotspots = lines.slice(1).map((line, idx) => {
                const cols = line.split(',');
                return {
                    id: `firms-${idx}`, lat: parseFloat(cols[latIdx]), lon: parseFloat(cols[lonIdx]),
                    date: cols[dateIdx], time: cols[timeIdx], confidence: cols[confIdx] || 'N/A',
                    frp: parseFloat(cols[frpIdx]) || 0, sat: cols[satIdx] || 'Unknown'
                };
            }).filter(h => !isNaN(h.lat));

            hotspots.sort((a, b) => b.frp - a.frp);
            if (firmsMarkersGroup) firmsMarkersGroup.clearLayers();
            firmsMapMarkers = {};

            const fireIcon = L.divIcon({
                html: '<i class="fa-solid fa-fire"></i>', className: 'fire-icon',
                iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -12]
            });

            hotspots.slice(0, 300).forEach(h => {
                if (activeLeafletMap) {
                    const marker = L.marker([h.lat, h.lon], {icon: fireIcon});
                    marker.bindPopup(`
                        <div style="font-family:'Share Tech Mono';">
                            <strong style="color:#ff3300; font-size:1rem;"><i class="fa-solid fa-satellite"></i> FIRMS SENSOR</strong><br>
                            <hr style="border: 1px solid #30363d; margin: 6px 0;" />
                            <strong>Lat/Lon:</strong> ${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}<br>
                            <strong>Power:</strong> <span style="color:#ff9900; font-weight:bold;">${h.frp} MW</span><br>
                            <strong>Confidence:</strong> ${h.confidence}<br>
                            <strong>Acquired:</strong> ${h.date} @ ${h.time}Z
                        </div>
                    `);
                    firmsMapMarkers[h.id] = marker;
                    firmsMarkersGroup.addLayer(marker);
                }
            });

            let html = '';
            hotspots.slice(0, 100).forEach(h => {
                html += `
                    <div class="fire-card" onclick="openHotspotOnMap('${h.id}')">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="color:#ff3300; font-weight:bold; font-size:0.85rem;"><i class="fa-solid fa-fire"></i> FIRMS HOTSPOT ${h.id.split('-')[1]}</span>
                            <span style="color:#ffcc00; font-size:0.75rem; font-weight:bold;">FRP: ${h.frp} MW</span>
                        </div>
                        <div style="color:#8b949e; font-size:0.7rem; margin-top:4px;">
                            <strong>Loc:</strong> ${h.lat.toFixed(3)}, ${h.lon.toFixed(3)} | <strong>Conf:</strong> ${h.confidence}
                        </div>
                    </div>`;
            });
            container.html(html || '<span style="color:#00ff55; font-size:0.8rem;"><i class="fa-solid fa-check"></i> No active anomalies.</span>');
        }).catch(err => console.error("FIRMS Error:", err));
}

function openHotspotOnMap(id) {
    const marker = firmsMapMarkers[id];
    if (marker && activeLeafletMap) {
        activeLeafletMap.flyTo(marker.getLatLng(), 11, { duration: 1.5 });
        setTimeout(() => marker.openPopup(), 1500);
    }
}

// --- Authoritative NIFC WFIGS Data & Map Plotting ---
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
            if (wfigsMarkersGroup) wfigsMarkersGroup.clearLayers();
            
            // Preserve the existing map toggles state
            const currentStateFilter = document.getElementById('stateFilter') ? document.getElementById('stateFilter').value : 'ALL';
            
            let listHtml = ''; let totalAcres = 0; let totalContainedSum = 0; let containedCount = 0;
            const topIncidents = incidents.slice(0, 150);
            
            const wfigsIcon = L.divIcon({
                html: '<i class="fa-solid fa-shield-halved"></i>', className: 'wfigs-icon',
                iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -12]
            });

            let statesSet = new Set();

            topIncidents.forEach((item, idx) => {
                const attr = item.attributes;
                const fireKey = `wfigs-${idx}`;
                globalWildfireCache[fireKey] = attr;

                const name = attr.IncidentName || attr.ComplexName || 'Unnamed Incident';
                const size = attr.IncidentSize ? Math.round(attr.IncidentSize).toLocaleString() : 'Unknown';
                const contained = attr.PercentContained !== null && attr.PercentContained !== undefined ? attr.PercentContained + '%' : 'N/A';
                const state = attr.POOState || 'US';
                const county = attr.POOCounty || '';
                if (state !== 'US') statesSet.add(state);

                if (attr.IncidentSize) totalAcres += attr.IncidentSize;
                if (attr.PercentContained !== null && attr.PercentContained !== undefined) {
                    totalContainedSum += attr.PercentContained; containedCount++;
                }

                const lat = (item.geometry && item.geometry.y) ? item.geometry.y : null;
                const lon = (item.geometry && item.geometry.x) ? item.geometry.x : null;

                if (lat && lon) {
                    const marker = L.marker([lat, lon], {icon: wfigsIcon});
                    marker.bindPopup(`
                        <div style="font-family:'Share Tech Mono';">
                            <strong style="color:#00ffcc; font-size:1rem; text-transform:uppercase;"><i class="fa-solid fa-shield-halved"></i> ${name}</strong><br>
                            <hr style="border: 1px solid #30363d; margin: 6px 0;" />
                            <strong>State/County:</strong> ${state}, ${county || 'N/A'}<br>
                            <strong>Acreage:</strong> ${size} acres<br>
                            <strong>Containment:</strong> ${contained}<br>
                            <strong>Discovered:</strong> ${attr.FireDiscoveryDateTime ? new Date(attr.FireDiscoveryDateTime).toLocaleDateString() : 'N/A'}<br>
                            <strong>Type:</strong> ${attr.IncidentTypeCategory || 'WF'}
                        </div>
                    `, { className: 'wfigs-popup' });

                    globalWildfireMapCache[fireKey] = { marker: marker, state: state, lat: lat, lon: lon, enabled: true };
                    
                    // Respect the current filter when re-rendering
                    if (currentStateFilter === 'ALL' || currentStateFilter === state) {
                        wfigsMarkersGroup.addLayer(marker);
                    }
                }

                listHtml += `
                    <div class="fire-card wfigs-card" style="border-left-color: #00ffcc;" onclick="openWfigsOnMap('${fireKey}')" title="Click to view fire perimeter and details on map">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span style="color:#00ffcc; font-weight:bold; font-size:0.85rem;"><i class="fa-solid fa-shield-halved"></i> ${name.toUpperCase()} (${state})</span>
                            <span style="color:#00ff55; font-size:0.75rem; font-weight:bold;">${contained} Contained</span>
                        </div>
                        <div style="color:#8b949e; font-size:0.7rem; margin-top:3px;">
                            County: ${county || 'N/A'} | Size: <strong>${size} acres</strong>
                        </div>
                    </div>`;
            });

            // Update State Dropdown
            const selectEl = document.getElementById('stateFilter');
            if (selectEl) {
                const sortedStates = Array.from(statesSet).sort();
                let optionsHtml = `<option value="ALL">SHOW ALL STATES</option>`;
                sortedStates.forEach(s => { optionsHtml += `<option value="${s}" ${currentStateFilter === s ? 'selected' : ''}>${s}</option>`; });
                selectEl.innerHTML = optionsHtml;
            }

            $('#wildfire-list-target').html(listHtml || '<span style="color:#00ff55; font-size:0.8rem;"><i class="fa-solid fa-check"></i> NO ACTIVE WFIGS INCIDENTS DETECTED</span>');
            $('#stat-count').text(incidents.length);
            $('#stat-acres').text(Math.round(totalAcres).toLocaleString());
            $('#stat-contained').text(containedCount > 0 ? Math.round(totalContainedSum / containedCount) + '%' : 'N/A');

            renderWildfireChart(topIncidents.slice(0, 8));
        }).catch(err => {
            console.error("WFIGS feed error:", err);
            $('#wildfire-list-target').html('<span style="color:#ff5555; font-size:0.8rem;">INCIDENT WFIGS FEED TIMEOUT</span>');
        });
}

function openWfigsOnMap(key) {
    const item = globalWildfireMapCache[key];
    const attr = globalWildfireCache[key];
    if (!item || !attr || !activeLeafletMap) return;
    
    // Clear previous perimeter calculation
    if (activePerimeter) { activeLeafletMap.removeLayer(activePerimeter); activePerimeter = null; }
    
    // Calculate and draw perimeter ring (Area = pi * r^2. 1 acre = 4046.86 sq m)
    const acres = attr.IncidentSize || 0;
    if (acres > 0) {
        const radiusMeters = Math.sqrt((acres * 4046.86) / Math.PI);
        activePerimeter = L.circle([item.lat, item.lon], {
            color: '#00ffcc', fillColor: '#00ffcc', fillOpacity: 0.15, weight: 2, dashArray: '5, 5'
        }).addTo(activeLeafletMap);
    }
    
    // Ensure layer is active on map if it was filtered out
    if (!wfigsMarkersGroup.hasLayer(item.marker)) {
        wfigsMarkersGroup.addLayer(item.marker);
        item.enabled = true;
    }
    
    activeLeafletMap.flyTo([item.lat, item.lon], 12, { duration: 1.5 });
    setTimeout(() => item.marker.openPopup(), 1500);
}

// --- Map Controls ---
function applyStateFilter() {
    const state = document.getElementById('stateFilter').value;
    let bounds = [];
    wfigsMarkersGroup.clearLayers();
    
    Object.values(globalWildfireMapCache).forEach(item => {
        if (state === 'ALL' || item.state === state) {
            item.enabled = true;
            wfigsMarkersGroup.addLayer(item.marker);
            bounds.push([item.lat, item.lon]);
        } else {
            item.enabled = false;
        }
    });
    
    if (bounds.length > 0 && activeLeafletMap) {
        activeLeafletMap.fitBounds(L.latLngBounds(bounds), {padding: [50, 50]});
    }
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
}

function resetMapBounds() {
    if (activeLeafletMap) activeLeafletMap.setView([39.8283, -98.5795], 4);
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
            datasets: [{ label: 'Acreage', data: sizes, backgroundColor: 'rgba(0, 255, 204, 0.65)', borderColor: '#00ffcc', borderWidth: 1 }]
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
            } else { html = "<span style='color:#00ff55; font-size:0.8rem;'><i class='fa-solid fa-check'></i> NO ACTIVE FIRE WEATHER WARNINGS</span>"; }

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
        <i class="fa-solid fa-wind"></i> <strong>DATA SOURCE CONFIRMATION:</strong> Pulled securely from AirNow API for <strong>${info.state}</strong>.
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
