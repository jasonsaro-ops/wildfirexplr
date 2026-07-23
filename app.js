// --- WILDFIREXPLR Core Configuration & State ---
let mapCenterLat = 39.8283; // Default US Continental Center (Kansas)
let mapCenterLon = -98.5795;
let mapZoom = 4;
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

// Initialize Web Audio API for alert sirens
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
                    { type: 'component', componentName: 'wildfireMap', title: 'WINDY DYNAMIC RADAR, WIND & FIRE SMOKE TRACKING' },
                    { type: 'component', componentName: 'activeIncidentList', title: 'AUTHORITATIVE ACTIVE WILDFIRES (NIFC WFIGS / IRWIN)' }
                ]
            },
            {
                type: 'column',
                width: 30,
                content: [
                    { type: 'component', componentName: 'nwsAlerts', title: 'CRITICAL NWS FIRE WEATHER & HAZARD WARNINGS' },
                    { type: 'component', componentName: 'fireAnalytics', title: 'REGIONAL ACREAGE & CONTAINMENT METRICS' }
                ]
            },
            {
                type: 'column',
                width: 28,
                content: [
                    { type: 'component', componentName: 'satelliteHotspots', title: 'NASA FIRMS SATELLITE THERMAL HOTSPOTS (48HR)' },
                    { type: 'component', componentName: 'airQualityPanel', title: 'AIRNOW SMOKE & AIR QUALITY MATRIX' },
                    { type: 'component', componentName: 'hydrologyFeed', title: 'USGS STREAMFLOW & WATERSHED CONDITIONS' }
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
            <div style="position:absolute; top:12px; right:12px; z-index:999; display:flex; gap:6px;">
                <select id="windyLayerSelect" style="background: rgba(33, 38, 45, 0.95); color: #ff9900; border: 1px solid #ff6600; padding: 5px 8px; font-family: 'Share Tech Mono', monospace; font-size: 0.78rem; border-radius: 4px; cursor: pointer;">
                    <option value="fires" selected>Active Fires / Thermal</option>
                    <option value="wind">Wind Streamlines</option>
                    <option value="radar">Weather Radar</option>
                    <option value="satellite">Satellite Imagery</option>
                    <option value="temp">Temperature</option>
                    <option value="rain">Rain Accumulation</option>
                    <option value="thunder">Thunderstorms</option>
                    <option value="clouds">Cloud Cover</option>
                </select>
                <button id="recenterBtn" style="background:#21262d; border:1px solid #ff6600; color:#ff9900; padding:5px 10px; border-radius:4px; cursor:pointer; font-family:'Share Tech Mono'; font-size:0.75rem;"><i class="fa-solid fa-crosshairs"></i> RESET US</button>
            </div>
            <iframe id="windyIframe" src="https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=in&metricTemp=f&metricWind=mph&zoom=${mapZoom}&overlay=fires&product=gfs&level=surface&lat=${mapCenterLat}&lon=${mapCenterLon}" style="width:100%; height:100%; border:none;"></iframe>
        </div>
    `);
    
    setTimeout(() => {
        const select = container.getElement().find('#windyLayerSelect');
        const iframe = container.getElement().find('#windyIframe')[0];
        
        select.on('change', function() {
            const layer = this.value;
            iframe.src = `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=in&metricTemp=f&metricWind=mph&zoom=${mapZoom}&overlay=${layer}&product=gfs&level=surface&lat=${mapCenterLat}&lon=${mapCenterLon}`;
        });

        container.getElement().find('#recenterBtn').on('click', function() {
            mapCenterLat = 39.8283;
            mapCenterLon = -98.5795;
            mapZoom = 4;
            iframe.src = `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=in&metricTemp=f&metricWind=mph&zoom=${mapZoom}&overlay=${select.val()}&product=gfs&level=surface&lat=${mapCenterLat}&lon=${mapCenterLon}`;
            fetchAllData();
        });
    }, 200);
});

layout.registerComponent('activeIncidentList', function(container) {
    container.getElement().html(`<div class="weather-component" id="wildfire-list-target">Querying NIFC WFIGS interagency wildfire network...</div>`);
    container.on('open', fetchWildfireData);
});

layout.registerComponent('nwsAlerts', function(container) {
    container.getElement().html(`
        <div class="weather-component" style="position:relative;">
            <div style="margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #30363d; display:flex; justify-content:space-between; align-items:center;">
                <div style="font-size:0.85rem; color:#ffcc00; font-weight:bold;"><i class="fa-solid fa-triangle-exclamation"></i> NWS WARNING MATRIX</div>
                <button id="soundToggleBtn" onclick="toggleAlertSound()" style="background: #21262d; border: 1px solid #30363d; color: #8b949e; padding: 3px 8px; border-radius: 3px; cursor: pointer; font-family: 'Share Tech Mono', monospace; font-size: 0.7rem;" title="Toggle alert sound">
                    <i class="fa-solid fa-volume-mute"></i> SOUND OFF
                </button>
            </div>
            <div id="alerts-container">Scanning national NWS feeds...</div>
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
            <div style="font-size:0.75rem; color:#ffcc00; font-weight:bold; margin-bottom:8px;"><i class="fa-solid fa-satellite"></i> NATIONAL FIRMS THERMAL HOTSPOTS (48HR)</div>
            <div id="firms-hotspots" style="max-height:220px; overflow-y:auto;">
                <span style="color:#8b949e; font-size:0.8rem;">Contacting NASA FIRMS satellite feed...</span>
            </div>
        </div>
    `);
    container.on('open', fetchWildfireData);
});

layout.registerComponent('airQualityPanel', function(container) {
    container.getElement().html(`<div class="weather-component" id="aqi-container-target">Interrogating AirNow smoke sensor frames...</div>`);
    container.on('open', fetchAirQualityData);
});

layout.registerComponent('hydrologyFeed', function(container) {
    container.getElement().html(`<div class="weather-component" id="hydro-station-list">Interrogating USGS National Water Information System...</div>`);
    container.on('open', fetchUSGSHydrology);
});

layout.init();

// Initialize sound on first user touch
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

// --- Data Fetching & Processing Modules ---

function fetchAllData() {
    fetchWildfireData();
    fetchNWSAlerts();
    fetchAirQualityData();
    fetchUSGSHydrology();
}

function fetchWildfireData() {
    // Bounding box for US Nationwide or zoomed geographic extent
    const xmin = -125.0, ymin = 24.0, xmax = -66.0, ymax = 50.0;
    const wfigsUrl = `https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query?where=1%3D1&geometry=${xmin}%2C${ymin}%2C${xmax}%2C${ymax}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=IncidentName,IncidentTypeCategory,IncidentSize,PercentContained,FireDiscoveryDateTime,POOState,POOCounty,IncidentID,ComplexName,UniqueFireIdentifier&returnGeometry=true&f=json`;
    const firmsUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/${xmin},${ymin},${xmax},${ymax}/1`;

    const wfigsPromise = fetch(wfigsUrl).then(r => r.json()).catch(() => null);
    const firmsPromise = fetch(firmsUrl).then(r => r.text()).catch(() => null);

    Promise.all([wfigsPromise, firmsPromise]).then(([wfigsData, firmsCsv]) => {
        const feats = (wfigsData && wfigsData.features) ? wfigsData.features : [];
        const incidents = feats
            .map(f => ({ attributes: f.attributes, geometry: f.geometry }))
            .filter(item => item.attributes.IncidentTypeCategory !== 'RX'); // Exclude prescribed burns

        globalWildfireCache = {};
        let listHtml = '';
        let totalAcres = 0;
        let totalContainedSum = 0;
        let containedCount = 0;

        // Sort descending by size
        incidents.sort((a, b) => (b.attributes.IncidentSize || 0) - (a.attributes.IncidentSize || 0));

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

            listHtml += `
                <div class="fire-card" onclick="openFireDetails('${fireKey}')" ondblclick="zoomToFire(${attr.geometry ? attr.geometry.y : 39.8}, ${attr.geometry ? attr.geometry.x : -98.5})">
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

        // Render Chart
        renderWildfireChart(incidents.slice(0, 8));

        // Process FIRMS Hotspots
        parseFirmsHotspots(firmsCsv);
    }).catch(err => {
        console.error("Wildfire feed error:", err);
        $('#wildfire-list-target').html('<span style="color:#ff5555; font-size:0.8rem;"><i class="fa-solid fa-triangle-exclamation"></i> INCIDENT FEED TIMEOUT</span>');
    });
}

function zoomToFire(lat, lon) {
    if (!lat || !lon) return;
    mapCenterLat = lat;
    mapCenterLon = lon;
    mapZoom = 10;
    const iframe = document.getElementById('windyIframe');
    if (iframe) {
        iframe.src = `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=in&metricTemp=f&metricWind=mph&zoom=${mapZoom}&overlay=fires&product=gfs&level=surface&lat=${mapCenterLat}&lon=${mapCenterLon}`;
    }
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
        <i class="fa-solid fa-satellite-dish"></i> IRWIN / WFIGS synchronized data record. Double-click the incident card in the dashboard list to instantly geolocate and zoom the live tactical radar map coordinates to this fire perimeter.
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

    const hotspots = lines.slice(1, 12).map(line => {
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
            <div style="background:#161b22; border:1px solid #30363d; border-radius:3px; padding:5px 8px; margin-bottom:4px; font-size:0.7rem; display:flex; justify-content:space-between;">
                <span style="color:#ff9900; font-weight:bold;">${h.lat.toFixed(2)}, ${h.lon.toFixed(2)}</span>
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
            // Filter specifically for fire weather or severe weather warnings
            const fireAlerts = features.filter(f => {
                const event = f.properties.event || '';
                return event.includes('Fire Weather') || event.includes('Red Flag') || event.includes('Warning');
            }).slice(0, 15);

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
                html = "<span style='color:#00ff55; font-size:0.8rem;'>✓ NO ACTIVE FIRE WEATHER/RED FLAG WARNINGS NATIONWIDE</span>";
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
    openFloatingModal("NWS ADVISORY DETAILS", body);
}

function fetchAirQualityData() {
    // AirNow national sample query around Kansas center
    const url = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${mapCenterLat}&longitude=${mapCenterLon}&distance=50&API_KEY=${AIRNOW_API_KEY}`;
    fetch(url)
        .then(res => res.json())
        .then(data => {
            let html = `<div style="font-size:0.75rem; color:#ffcc00; font-weight:bold; margin-bottom:8px;"><i class="fa-solid fa-wind"></i> AIR QUALITY & SMOKE MATRIX</div>`;
            if (!data || data.length === 0) {
                html += `<div style="color:#8b949e; font-size:0.75rem;">No active particulate sensors reporting in sector.</div>`;
            } else {
                html += `<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">`;
                data.forEach(p => {
                    const color = p.AQI > 100 ? '#ff0000' : p.AQI > 50 ? '#ffcc00' : '#00ff55';
                    html += `
                        <div style="background:#161b22; border:1px solid #30363d; padding:6px; text-align:center; border-radius:3px;">
                            <div style="font-size:0.65rem; color:#8b949e;">${p.ParameterName}</div>
                            <div style="font-size:1.3rem; color:${color}; font-weight:bold;">${p.AQI}</div>
                            <div style="font-size:0.6rem; color:${color};">${p.Category ? p.Category.Name : ''}</div>
                        </div>`;
                });
                html += `</div>`;
            }
            $('#aqi-container-target').html(html);
        })
        .catch(() => $('#aqi-container-target').html('<span style="color:#ff5555; font-size:0.8rem;">AirNow feed unavailable</span>'));
}

function fetchUSGSHydrology() {
    // Sample USGS key hydrological stations monitoring watershed flow
    const gauges = [
        { id: "09380000", name: "Colorado River near Grand Canyon, AZ" },
        { id: "11447650", name: "Sacramento River at Sacramento, CA" }
    ];
    let html = '<div style="font-size:0.75rem; color:#00ffcc; font-weight:bold; margin-bottom:8px;"><i class="fa-solid fa-water"></i> WATERSHED STREAMFLOW CONDITIONS</div>';
    gauges.forEach(g => {
        html += `
            <div style="background:#161b22; border:1px solid #30363d; border-radius:3px; padding:6px 8px; margin-bottom:6px;">
                <div style="font-weight:bold; color:#fff; font-size:0.78rem;">${g.name}</div>
                <div style="color:#00ffcc; font-size:0.7rem; margin-top:2px;">USGS Gage-${g.id} · Normal Baseflow Range</div>
            </div>`;
    });
    $('#hydro-station-list').html(html);
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
