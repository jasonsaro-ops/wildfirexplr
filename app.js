// --- WILDFIREXPLR Core Configuration & State ---
let mapCenterLat = 39.8283; 
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

// --- Golden Layout Structural Grid (Streamlined without USGS) ---
const config = {
    settings: { hasHeaders: true, reorderEnabled: true, showPopoutIcon: false, showMaximiseIcon: true, showCloseIcon: false },
    content: [{
        type: 'row',
        content: [
            {
                type: 'column',
                width: 42,
                content: [
                    { type: 'component', componentName: 'wildfireMap', title: 'WINDY INTERACTIVE DYNAMIC FIRE & SMOKE TRACKING' },
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
            <div style="position:absolute; top:12px; right:12px; z-index:999; display:flex; gap:6px;">
                <select id="windyLayerSelect" style="background: rgba(33, 38, 45, 0.95); color: #ff9900; border: 1px solid #ff6600; padding: 5px 8px; font-family: 'Share Tech Mono', monospace; font-size: 0.78rem; border-radius: 4px; cursor: pointer;">
                    <option value="fires" selected>Active Fires / Thermal</option>
                    <option value="wind">Wind Streamlines</option>
                    <option value="radar">Weather Radar</option>
                    <option value="satellite">Satellite Imagery</option>
                    <option value="temp">Temperature</option>
                    <option value="rain">Rain Accumulation</option>
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
    // Broad nationwide query for WFIGS active incidents
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

            const lat = (item.geometry && item.geometry.y) ? item.geometry.y : 39.8;
            const lon = (item.geometry && item.geometry.x) ? item.geometry.x : -98.5;

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
    if (!lat || !lon) return;
    mapCenterLat = lat;
    mapCenterLon = lon;
    mapZoom = zoomLevel || 10;
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
        <i class="fa-solid fa-satellite-dish"></i> IRWIN / WFIGS synchronized data record. Double-click the incident card in the list to instantly zoom the map to this fire's location.
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
            // Concentrated strictly on Fire Weather Warnings and Red Flag Warnings nationwide
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
    // Multi-state representative monitoring coordinates covering Western, Central, and Eastern US fire/smoke zones
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
        let html = `<div style="font-size:0.75rem; color:#ffcc00; font-weight:bold; margin-bottom:8px;"><i class="fa-solid fa-wind"></i> MULTI-STATE AIRNOW SMOKE & AQI MONITORING</div>`;
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
                    html += `
                        <div style="background:#0d1117; border:1px solid #21262d; padding:4px; text-align:center; border-radius:2px;">
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
