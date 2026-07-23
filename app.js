// --- WILDFIREXPLR Core Configuration & State ---
let countdownVal = 120;

const AIRNOW_API_KEY = "E5AFEF36-80F6-4A42-AE38-F3C56E3AEAC4"; 
const FIRMS_MAP_KEY = "215020163103e2209b2fb8253d20b037";

let globalWildfireCache = {};
let globalAlertsCache = {};
let globalAQICache = {};
let wildfireChartInstance = null;
let alertSoundEnabled = false;
let previousAlertCount = 0;
let alertAudio = null;

let activeLeafletMap = null;
let mapMarkersGroup = null;

function initAlertSound() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        alertAudio = audioContext;
    } catch (err) {
        console.log("Audio context deferred.");
    }
}

function playAlertSound() {
    if (!alertSoundEnabled || !alertAudio) return;
    try {
        const context = alertAudio;
        if (context.state === 'suspended') context.resume();
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.connect(gain);
        gain.connect(context.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.2, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.15);
        osc.start(context.currentTime);
        osc.stop(context.currentTime + 0.15);
    } catch (err) {
        console.error("Audio error:", err);
    }
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
                    { type: 'component', componentName: 'wildfireMap', title: 'NATIVE ACTIVE WILDFIRE MAP MATRIX' },
                    { type: 'component', componentName: 'activeIncidentList', title: 'AUTHORITATIVE ACTIVE WILDFIRES (NIFC WFIGS / IRWIN)' }
                ]
            },
            {
                type: 'column',
                width: 30,
                content: [
                    { type: 'component', componentName: 'nwsAlerts', title: 'NWS FIRE WEATHER & RED FLAG WARNING MATRIX' },
                    { type: 'component', componentName: 'fireAnalytics', title: 'NATIONAL ACREAGE & CONTAINMENT METRICS' }
                ]
            },
            {
                type: 'column',
                width: 28,
                content: [
                    { type: 'component', componentName: 'satelliteHotspots', title: 'NASA FIRMS SATELLITE THERMAL HOTSPOTS (48HR)' },
                    { type: 'component', componentName: 'airQualityPanel', title: 'NATIONAL MULTI-STATE AIRNOW SMOKE & AQI MATRIX' }
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
            <div id="leafletMapContainer" style="width:100%; height:100%;"></div>
        </div>
    `);
    
    setTimeout(() => {
        if (!activeLeafletMap) {
            activeLeafletMap = L.map('leafletMapContainer', { zoomControl: false }).setView([39.8283, -98.5795], 4);
            L.control.zoom({ position: 'bottomright' }).addTo(activeLeafletMap);

            L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                maxZoom: 18,
                attribution: '&copy; OpenStreetMap contributors & CARTO'
            }).addTo(activeLeafletMap);

            mapMarkersGroup = L.layerGroup().addTo(activeLeafletMap);
        }
        fetchAllData();
    }, 250);
});

layout.registerComponent('activeIncidentList', function(container) {
    container.getElement().html(`<div class="weather-component" id="wildfire-list-target">Querying NIFC WFIGS interagency nationwide wildfire network...</div>`);
    container.on('open', fetchWildfireData);
});

layout.registerComponent('nwsAlerts', function(container) {
    container.getElement().html(`
        <div class="weather-component" style="position:relative;">
            <div style="margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #30363d; display:flex; justify-content:space-between; align-items:center;">
                <div style="font-size:0.85rem; color:#ffcc00; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> NWS FIRE / RED FLAG WARNINGS</div>
                <button id="soundToggleBtn" onclick="toggleAlertSound()" style="background: #21262d; border: 1px solid #30363d; color: #8b949e; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-family: 'Share Tech Mono', monospace; font-size: 0.7rem;" title="Toggle alert sound">
                    <i class="fa-solid fa-volume-mute"></i> SOUND OFF
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
                <div style="background:#161b22; border:1px solid #30363d; border-radius:3px; padding:6px; text-align:center;"><div style="font-size:0.6rem; color:#8b949e;">TOTAL FIRES</div><div id="stat-count" style="font-size:1.2rem; color:#ff6600; font-weight:bold;">--</div></div>
                <div style="background:#161b22; border:1px solid #30363d; border-radius:3px; padding:6px; text-align:center;"><div style="font-size:0.6rem; color:#8b949e;">ACREAGE</div><div id="stat-acres" style="font-size:1.2rem; color:#ff6600; font-weight:bold;">--</div></div>
                <div style="background:#161b22; border:1px solid #30363d; border-radius:3px; padding:6px; text-align:center;"><div style="font-size:0.6rem; color:#8b949e;">CONTAINED</div><div id="stat-contained" style="font-size:1.2rem; color:#00ff55; font-weight:bold;">--</div></div>
            </div>
            <div style="min-height:180px; position:relative; background:#161b22; border: 1px solid #30363d; border-radius:4px; padding:10px;">
                <canvas id="wildfireChart"></canvas>
            </div>
        </div>
    `);
    container.on('open', fetchWildfireData);
});

layout.registerComponent('satelliteHotspots', function(container) {
    container.getElement().html(`
        <div class="weather-component">
            <div style="font-size:0.75rem; color:#ffcc00; font-weight:bold; margin-bottom:8px;"><i class="fa-solid fa-satellite"></i> NATIONAL FIRMS HOTSPOTS (CLICK COORDS TO MAP)</div>
            <div id="firms-hotspots" style="max-height:280px; overflow-y:auto;">
                <span style="color:#8b949e; font-size:0.8rem;">Contacting NASA FIRMS satellite feed...</span>
            </div>
        </div>
    `);
    container.on('open', fetchWildfireData);
});

layout.registerComponent('airQualityPanel', function(container) {
    container.getElement().html(`<div class="weather-component" id="aqi-container-target">Interrogating AirNow multi-state observation sensors...</div>`);
    container.on('open', fetchAirQualityData);
});

layout.init();

document.addEventListener('click', () => { if (!alertAudio) initAlertSound(); }, { once: true });

function toggleAlertSound() {
    if (!alertAudio) initAlertSound();
    alertSoundEnabled = !alertSoundEnabled;
    const btn = document.getElementById('soundToggleBtn');
    if (btn) {
        if (alertSoundEnabled) {
            btn.style.background = '#1a3a1a'; btn.style.borderColor = '#00ff55'; btn.style.color = '#00ff55';
            btn.innerHTML = '<i class="fa-solid fa-volume-high"></i> SOUND ON';
            playAlertSound();
        } else {
            btn.style.background = '#21262d'; btn.style.borderColor = '#30363d'; btn.style.color = '#8b949e';
            btn.innerHTML = '<i class="fa-solid fa-volume-mute"></i> SOUND OFF';
        }
    }
}

function fetchAllData() {
    fetchWildfireData();
    fetchNWSAlerts();
    fetchAirQualityData();
}

function fetchWildfireData() {
    // Authoritative NIFC WFIGS active incident feature server endpoint
    const wfigsUrl = `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=1%3D1&outFields=IncidentName,IncidentTypeCategory,IncidentSize,PercentContained,FireDiscoveryDateTime,POOState,POOCounty,IncidentID,ComplexName,UniqueFireIdentifier&returnGeometry=true&f=json`;
    const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/-125,24,-66,50/1`;

    const wfigsPromise = fetch(wfigsUrl).then(r => r.json()).catch(() => null);
    const firmsPromise = fetch(firmsUrl).then(r => r.text()).catch(() => null);

    Promise.all([wfigsPromise, firmsPromise]).then(([wfigsData, firmsCsv]) => {
        const feats = (wfigsData && wfigsData.features) ? wfigsData.features : [];
        const incidents = feats
            .map(f => ({ attributes: f.attributes, geometry: f.geometry }))
            .filter(item => item.attributes.IncidentTypeCategory !== 'RX');

        globalWildfireCache = {};
        let listHtml = '';
        let totalAcres = 0;
        let totalContainedSum = 0;
        let containedCount = 0;

        incidents.sort((a, b) => (b.attributes.IncidentSize || 0) - (a.attributes.IncidentSize || 0));

        if (mapMarkersGroup) mapMarkersGroup.clearLayers();

        incidents.forEach((item, idx) => {
            const attr = item.attributes;
            const fireKey = `fire-${idx}`;
            globalWildfireCache[fireKey] = attr;

            const name = attr.IncidentName || attr.ComplexName || 'Unnamed Incident';
            const size = attr.IncidentSize ? Math.round(attr.IncidentSize).toLocaleString() : 'Unknown';
            const contained = attr.PercentContained !== null && attr.PercentContained !== undefined ? attr.PercentContained + '%' : 'N/A';
            const state = attr.POOState || 'US';
            const county = attr.POOCounty || '';

            if (attr.IncidentSize) totalAcres += attr.IncidentSize;
            if (attr.PercentContained !== null && attr.PercentContained !== undefined) {
                totalContainedSum += attr.PercentContained;
                containedCount++;
            }

            const lat = (item.geometry && item.geometry.y) ? item.geometry.y : null;
            const lon = (item.geometry && item.geometry.x) ? item.geometry.x : null;

            if (lat && lon && activeLeafletMap) {
                const marker = L.circleMarker([lat, lon], {
                    radius: 6,
                    color: '#ff6600',
                    fillColor: '#ff9900',
                    fillOpacity: 0.8,
                    weight: 1
                });

                marker.bindPopup(`
                    <div style="font-family:'Share Tech Mono';">
                        <strong style="color:#ff9900;">${name.toUpperCase()} (${state})</strong><br>
                        Size: ${size} acres<br>
                        Containment: ${contained}<br>
                        County: ${county || 'N/A'}<br>
                        <a href="javascript:void(0)" onclick="openFireDetails('${fireKey}')" style="color:#00ffcc; text-decoration:underline;">View Details Matrix</a>
                    </div>
                `);
                mapMarkersGroup.addLayer(marker);
            }

            listHtml += `
                <div class="fire-card" onclick="openFireDetails('${fireKey}')" ondblclick="zoomToCoords(${lat}, ${lon}, 10)">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span style="color:#ff9900; font-weight:bold; font-size:0.85rem;"><i class="fa-solid fa-fire"></i> ${name.toUpperCase()} (${state})</span>
                        <span style="color:#00ff55; font-size:0.75rem; font-weight:bold;">${contained} Contained</span>
                    </div>
                    <div style="color:#8b949e; font-size:0.7rem; margin-top:3px;">
                        County: ${county || 'N/A'} | Size: <strong>${size} acres</strong> | ID: ${attr.UniqueFireIdentifier || 'N/A'}
                    </div>
                </div>`;
        });

        if (incidents.length === 0) {
            listHtml = '<span style="color:#00ff55; font-size:0.8rem;"><i class="fa-solid fa-check"></i> NO ACTIVE INCIDENTS REPORTED IN FEED</span>';
        }

        $('#wildfire-list-target').html(listHtml);
        $('#stat-count').text(incidents.length);
        $('#stat-acres').text(Math.round(totalAcres).toLocaleString());
        $('#stat-contained').text(containedCount > 0 ? Math.round(totalContainedSum / containedCount) + '%' : 'N/A');

        renderWildfireChart(incidents.slice(0, 8));
        parseFirmsHotspots(firmsCsv);
    }).catch(err => {
        console.error("Wildfire feed error:", err);
        $('#wildfire-list-target').html('<span style="color:#ff5555; font-size:0.8rem;"><i class="fa-solid fa-triangle-exclamation"></i> INCIDENT FEED TIMEOUT</span>');
    });
}

function zoomToCoords(lat, lon, zoomLevel) {
    if (!lat || !lon || !activeLeafletMap) return;
    activeLeafletMap.setView([lat, lon], zoomLevel || 11);
}

function openFireDetails(key) {
    const attr = globalWildfireCache[key];
    if (!attr) return;

    let body = `<div style="color:#ff9900; font-weight:bold; font-size:1.1rem; margin-bottom:10px; border-bottom:1px solid #30363d; padding-bottom:8px;">${attr.IncidentName || attr.ComplexName || 'Wildfire Incident'} (${attr.POOState || 'US'})</div>`;
    body += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px; font-size:0.85rem;">
        <div><strong>State / County:</strong> ${attr.POOState || 'N/A'}, ${attr.POOCounty || 'N/A'}</div>
        <div><strong>Incident Size:</strong> ${attr.IncidentSize ? Math.round(attr.IncidentSize).toLocaleString() + ' acres' : 'N/A'}</div>
        <div><strong>Containment:</strong> ${attr.PercentContained !== null && attr.PercentContained !== undefined ? attr.PercentContained + '%' : 'N/A'}</div>
        <div><strong>Discovery Date:</strong> ${attr.FireDiscoveryDateTime ? new Date(attr.FireDiscoveryDateTime).toLocaleString() : 'N/A'}</div>
        <div><strong>Unique ID:</strong> ${attr.UniqueFireIdentifier || 'N/A'}</div>
        <div><strong>Category:</strong> ${attr.IncidentTypeCategory || 'WF'}</div>
    </div>`;
    body += `<div style="color:#00ffcc; background:#161b22; padding:12px; border-radius:4px; border:1px solid #30363d; font-family:monospace; font-size:0.85rem;">
        <i class="fa-solid fa-satellite-dish"></i> IRWIN / WFIGS synchronized data record. Double-click the incident card in the list to instantly center the map to this fire's location.
    </div>`;

    openFloatingModal(`WILDFIRE INCIDENT MATRIX: ${attr.IncidentName || 'DETAILS'}`, body);
}

function renderWildfireChart(topIncidents) {
    const ctx = document.getElementById('wildfireChart').getContext('2d');
    if (wildfireChartInstance) wildfireChartInstance.destroy();

    Chart.defaults.color = '#8b949e';
    Chart.defaults.font.family = "'Share Tech Mono', monospace";

    const labels = topIncidents.map(i => i.attributes.IncidentName || 'Unnamed');
    const sizes = topIncidents.map(i => i.attributes.IncidentSize || 0);

    if (sizes.length === 0) return;

    wildfireChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Acreage',
                data: sizes,
                backgroundColor: 'rgba(255, 102, 0, 0.65)',
                borderColor: '#ff6600',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: '#21262d' }, title: { display: true, text: 'Acres Burned' } },
                y: { grid: { color: '#21262d' }, ticks: { font: { size: 9 } } }
            }
        }
    });
}

function parseFirmsHotspots(csvText) {
    const container = $('#firms-hotspots');
    if (!csvText || csvText.trim().split('\n').length < 2) {
        container.html('<span style="color:#00ff55; font-size:0.75rem;"><i class="fa-solid fa-check"></i> No thermal hotspots reported in 48h window</span>');
        return;
    }

    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');
    const latIdx = headers.indexOf('latitude');
    const lonIdx = headers.indexOf('longitude');
    const dateIdx = headers.indexOf('acq_date');
    const timeIdx = headers.indexOf('acq_time');
    const confIdx = headers.indexOf('confidence');

    const hotspots = lines.slice(1, 15).map(line => {
        const cols = line.split(',');
        return {
            lat: parseFloat(cols[latIdx]),
            lon: parseFloat(cols[lonIdx]),
            date: cols[dateIdx],
            time: cols[timeIdx],
            confidence: cols[confIdx]
        };
    }).filter(h => !isNaN(h.lat));

    let html = '';
    hotspots.forEach(h => {
        const timeStr = (h.time || '').padStart(4, '0');
        html += `
            <div style="background:#161b22; border:1px solid #30363d; border-radius:3px; padding:6px 8px; margin-bottom:5px; font-size:0.72rem; display:flex; justify-content:space-between; align-items:center;">
                <span style="color:#ff9900; font-weight:bold; cursor:pointer; text-decoration:underline;" onclick="zoomToCoords(${h.lat}, ${h.lon}, 11)" title="Click to view hotspot area on map">
                    <i class="fa-solid fa-location-dot"></i> ${h.lat.toFixed(2)}, ${h.lon.toFixed(2)}
                </span>
                <span style="color:#8b949e;">${h.date} ${timeStr.slice(0,2)}:${timeStr.slice(2)} UTC · Conf: ${h.confidence}</span>
            </div>`;
    });
    container.html(html);
}

function fetchNWSAlerts() {
    const container = $('#alerts-container');
    fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert')
        .then(res => res.json())
        .then(data => {
            const features = data.features || [];
            const fireAlerts = features.filter(f => {
                const event = (f.properties.event || '').toLowerCase();
                return event.includes('fire weather') || event.includes('red flag');
            }).slice(0, 20);

            globalAlertsCache = {};
            let html = '';
            let alertCount = fireAlerts.length;

            if (alertCount > 0) {
                fireAlerts.forEach(f => {
                    const props = f.properties;
                    globalAlertsCache[props.id] = props;
                    html += `
                        <div class="fire-card" style="border-left-color: #ff3333;" onclick="openAlertDetails('${props.id}')">
                            <div style="color: #ff5555; font-weight: bold; font-size:0.78rem;">${props.event.toUpperCase()}</div>
                            <div style="color:#8b949e; font-size:0.7rem; margin-top:2px;">${props.areaDesc}</div>
                        </div>`;
                });
            } else {
                html = "<span style='color:#00ff55; font-size:0.8rem;'>✓ NO ACTIVE FIRE WEATHER OR RED FLAG WARNINGS NATIONWIDE</span>";
            }

            if (alertCount > previousAlertCount && alertCount > 0) playAlertSound();
            previousAlertCount = alertCount;
            container.html(html);
        })
        .catch(() => container.html('<span style="color:#ff5555; font-size:0.8rem;">ALERT FEED UNREACHABLE</span>'));
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
        { name: "California (West)", lat: 38.5816, lon: -121.4944 },
        { name: "Colorado (Rockies)", lat: 39.7392, lon: -104.9903 },
        { name: "Texas (South)", lat: 30.2672, lon: -97.7431 },
        { name: "New York (East)", lat: 40.7128, lon: -74.0060 }
    ];

    let promises = sampleCoords.map(loc => 
        fetch(`https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${loc.lat}&longitude=${loc.lon}&distance=75&API_KEY=${AIRNOW_API_KEY}`)
            .then(res => res.json())
            .catch(() => [])
    );

    Promise.all(promises).then(results => {
        let html = `<div style="font-size:0.75rem; color:#ffcc00; font-weight:bold; margin-bottom:8px;"><i class="fa-solid fa-wind"></i> MULTI-STATE AIRNOW SMOKE & AQI MONITORING (CLICK TO VIEW)</div>`;
        html += `<div style="display:flex; flex-direction:column; gap:6px;">`;
        
        let hasData = false;
        results.forEach((data, index) => {
            if (data && data.length > 0) {
                hasData = true;
                const regionName = sampleCoords[index].name;
                html += `<div style="background:#161b22; border:1px solid #30363d; padding:8px; border-radius:3px;">`;
                html += `<div style="font-size:0.72rem; color:#00ffcc; font-weight:bold; margin-bottom:4px;">${regionName}</div>`;
                html += `<div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:4px;">`;
                data.forEach(p => {
                    const color = p.AQI > 150 ? '#ff0000' : p.AQI > 100 ? '#ff7e00' : p.AQI > 50 ? '#ffcc00' : '#00ff55';
                    const payloadString = encodeURIComponent(JSON.stringify({ region: regionName, parameter: p.ParameterName, aqi: p.AQI, category: p.Category ? p.Category.Name : 'N/A', site: p.ReportingArea || 'Unknown Sensor' }));
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

        if (!hasData) {
            html += `<div style="color:#8b949e; font-size:0.75rem;">No active multi-state particulate feeds responding.</div>`;
        }
        html += `</div>`;
        $('#aqi-container-target').html(html);
    }).catch(() => $('#aqi-container-target').html('<span style="color:#ff5555; font-size:0.8rem;">AirNow multi-state feed unavailable</span>'));
}

function openAQIDetails(encodedStr) {
    const info = JSON.parse(decodeURIComponent(encodedStr));
    let body = `<div style="color:#ff9900; font-weight:bold; font-size:1.1rem; margin-bottom:10px; border-bottom:1px solid #30363d; padding-bottom:8px;">Air Quality Monitor Report: ${info.region}</div>`;
    body += `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-bottom:12px; font-size:0.85rem;">
        <div><strong>Reporting Area / Sensor:</strong> ${info.site}</div>
        <div><strong>Pollutant Parameter:</strong> ${info.parameter}</div>
        <div><strong>AQI Index Value:</strong> <span style="color:#ff6600; font-weight:bold;">${info.aqi}</span></div>
        <div><strong>Air Quality Category:</strong> ${info.category}</div>
    </div>`;
    body += `<div style="color:#00ffcc; background:#161b22; padding:12px; border-radius:4px; border:1px solid #30363d; font-family:monospace; font-size:0.85rem;">
        <i class="fa-solid fa-wind"></i> This metric is pulled directly from AirNow regional reporting sensor arrays monitoring atmospheric particle pollution and smoke density across ${info.region}.
    </div>`;
    openFloatingModal(`AQI TELEMETRY: ${info.parameter} (${info.region})`, body);
}

function openFloatingModal(title, textHTML) {
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalBody').innerHTML = textHTML;
    document.getElementById('hubFloatingModal').style.display = 'flex';
}
function closeFloatingModal() { 
    document.getElementById('hubFloatingModal').style.display = 'none'; 
    document.getElementById('modalBody').innerHTML = ''; 
}

// Global Core Sync Timer
setInterval(() => {
    countdownVal--;
    if (countdownVal <= 0) {
        countdownVal = 120;
        fetchAllData();
    }
    const targetTimer = document.getElementById('countdown');
    if (targetTimer) targetTimer.innerText = countdownVal;
}, 1000);

window.addEventListener('resize', () => { layout.updateSize(); });
