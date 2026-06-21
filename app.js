/* ═══════════════════════════════════════════════════════════
   GridLock 2.0 – Main Application Logic
   Event-Driven Congestion Management for Bengaluru
   ═══════════════════════════════════════════════════════════ */

// ── Global State ─────────────────────────────────────────
let DATA = null;
let dashboardMap = null;
let diversionMap = null;
let charts = {};
let currentPage = 'dashboard';
let explorerPage = 1;
const ROWS_PER_PAGE = 50;

// ── Chart.js Global Config ───────────────────────────────
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(71, 85, 105, 0.2)';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.plugins.legend.labels.usePointStyle = true;
Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
Chart.defaults.animation.duration = 800;

const CHART_COLORS = [
    '#6366f1', '#8b5cf6', '#a78bfa', '#3b82f6', '#06b6d4',
    '#10b981', '#22c55e', '#eab308', '#f59e0b', '#f97316',
    '#ef4444', '#ec4899', '#d946ef', '#64748b', '#78716c'
];

// ── Toast notification system ────────────────────────────
const toastContainer = document.createElement('div');
toastContainer.id = 'toast-container';
document.body.appendChild(toastContainer);

function showToast(msg, type = 'info', duration = 3000) {
    const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        toast.style.transition = '0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ── Live Clock ──────────────────────────────────────────
function startLiveClock() {
    const clockEl = document.getElementById('live-clock');
    if (!clockEl) return;
    function tick() {
        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('en-IN', { hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST';
    }
    tick();
    setInterval(tick, 1000);
}

const GRADIENT_PAIRS = [
    ['#6366f1', '#818cf8'],
    ['#8b5cf6', '#a78bfa'],
    ['#3b82f6', '#60a5fa'],
    ['#10b981', '#34d399'],
    ['#f59e0b', '#fbbf24'],
    ['#ef4444', '#f87171'],
];

// ── Loading Screen ───────────────────────────────────────
function updateLoader(progress, text) {
    const bar = document.getElementById('loader-progress');
    const txt = document.getElementById('loader-text');
    if (bar) bar.style.width = progress + '%';
    if (txt) txt.textContent = text;
}

// Track which pages have been rendered already
const renderedPages = {};

// ── Initialize App ───────────────────────────────────────
async function initApp() {
    updateLoader(10, 'Loading dataset...');
    
    try {
        // Try loading preprocessed JSON first
        let response = await fetch('processed_data.json');
        if (response.ok) {
            DATA = await response.json();
            updateLoader(50, 'Data loaded, building interface...');
        } else {
            // Fallback: parse CSV directly in browser
            updateLoader(20, 'JSON not found, parsing CSV...');
            DATA = await parseCSVDirectly();
            updateLoader(50, 'CSV parsed, building interface...');
        }
    } catch (e) {
        console.warn('Loading preprocessed data failed, parsing CSV...', e);
        updateLoader(20, 'Parsing CSV directly...');
        DATA = await parseCSVDirectly();
        updateLoader(50, 'CSV parsed, building interface...');
    }

    updateLoader(60, 'Rendering dashboard...');
    populateFilters();
    
    updateLoader(75, 'Drawing charts...');
    renderDashboard();
    
    updateLoader(85, 'Setting up interactions...');
    setupEventListeners();
    
    updateLoader(100, 'Ready!');
    
    // Add live clock to top bar
    {
        const topBarRight = document.querySelector('.top-bar-right');
        if (topBarRight && !document.getElementById('live-clock')) {
            const clockEl = document.createElement('div');
            clockEl.id = 'live-clock';
            clockEl.className = 'live-clock';
            clockEl.textContent = '00:00:00 IST';
            topBarRight.appendChild(clockEl);
            startLiveClock();
        }
    }

    // Show UI immediately
    setTimeout(() => {
        document.getElementById('loading-screen').classList.add('fade-out');
        document.getElementById('app').classList.remove('hidden');
        // Init dashboard map after UI is visible (deferred)
        requestAnimationFrame(() => initDashboardMap());
    }, 300);
}

// ── CSV Parser (fallback if JSON not available) ──────────
async function parseCSVDirectly() {
    const csvFile = 'Astram event data_anonymized - Astram event data_anonymizedb40ac87.csv';
    const response = await fetch(csvFile);
    const text = await response.text();
    const lines = text.replace(/\r\r\n/g, '\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const headers = parseCSVLine(lines[0]);
    
    const events = [];
    const hourly = new Array(24).fill(0);
    const dow = { 'Monday': 0, 'Tuesday': 0, 'Wednesday': 0, 'Thursday': 0, 'Friday': 0, 'Saturday': 0, 'Sunday': 0 };
    const monthly = {};
    const corridorMap = {};
    const junctionMap = {};
    const zoneMap = {};
    const causeStats = {};
    
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const vals = parseCSVLine(lines[i]);
        if (vals.length < headers.length) continue;
        
        const row = {};
        headers.forEach((h, idx) => { row[h.trim()] = (vals[idx] || '').trim(); });
        
        const lat = parseFloat(row.latitude) || 0;
        const lng = parseFloat(row.longitude) || 0;
        if (lat === 0 && lng === 0) continue;
        
        const event = {
            id: row.id || `EVT${i}`,
            event_type: row.event_type || 'unplanned',
            lat, lng,
            cause: row.event_cause || 'others',
            requires_road_closure: row.requires_road_closure === 'TRUE',
            start_datetime: row.start_datetime ? row.start_datetime.replace(' ', 'T').replace('+00', 'Z') : '',
            corridor: row.corridor || 'Non-corridor',
            priority: row.priority || 'Low',
            zone: (row.zone && row.zone !== 'NULL') ? row.zone : '',
            junction: (row.junction && row.junction !== 'NULL') ? row.junction : '',
            address: row.address || '',
            status: row.status || 'closed',
            description: row.description || '',
            end_datetime: row.end_datetime || '',
            veh_type: row.veh_type || '',
        };
        events.push(event);
        
        // Hourly (convert UTC to IST)
        if (event.start_datetime && event.start_datetime !== 'NULL') {
            try {
                const dtStr = event.start_datetime.replace(' ', 'T').replace('+00', 'Z');
                const dt = new Date(dtStr);
                if (!isNaN(dt)) {
                    const istHour = (dt.getUTCHours() + 5 + Math.floor((dt.getUTCMinutes() + 30) / 60)) % 24;
                    hourly[istHour]++;
                    
                    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                    // Approx IST date
                    const istDate = new Date(dt.getTime() + 5.5 * 3600 * 1000);
                    dow[days[istDate.getDay()]]++;
                    
                    const monthKey = istDate.getFullYear() + '-' + String(istDate.getMonth() + 1).padStart(2, '0');
                    monthly[monthKey] = (monthly[monthKey] || 0) + 1;
                }
            } catch (e) {}
        }
        
        // Corridors
        const corr = event.corridor;
        if (!corridorMap[corr]) corridorMap[corr] = { name: corr, total_events: 0, road_closures: 0, high_priority_count: 0, causes: {}, junctions: new Set() };
        corridorMap[corr].total_events++;
        if (event.requires_road_closure) corridorMap[corr].road_closures++;
        if (event.priority === 'High') corridorMap[corr].high_priority_count++;
        corridorMap[corr].causes[event.cause] = (corridorMap[corr].causes[event.cause] || 0) + 1;
        if (event.junction) corridorMap[corr].junctions.add(event.junction);
        
        // Junctions
        if (event.junction) {
            if (!junctionMap[event.junction]) junctionMap[event.junction] = { name: event.junction, lat: 0, lng: 0, event_count: 0, causes: {}, corridor: corr };
            junctionMap[event.junction].event_count++;
            junctionMap[event.junction].lat = lat;
            junctionMap[event.junction].lng = lng;
            junctionMap[event.junction].causes[event.cause] = (junctionMap[event.junction].causes[event.cause] || 0) + 1;
        }
        
        // Zones
        if (event.zone) {
            if (!zoneMap[event.zone]) zoneMap[event.zone] = { name: event.zone, event_count: 0, causes: {} };
            zoneMap[event.zone].event_count++;
            zoneMap[event.zone].causes[event.cause] = (zoneMap[event.zone].causes[event.cause] || 0) + 1;
        }
        
        // Cause stats
        if (!causeStats[event.cause]) causeStats[event.cause] = { count: 0, road_closures: 0, high_count: 0, durations: [] };
        causeStats[event.cause].count++;
        if (event.requires_road_closure) causeStats[event.cause].road_closures++;
        if (event.priority === 'High') causeStats[event.cause].high_count++;
    }
    
    // Build final structure
    const corridors = Object.values(corridorMap).map(c => ({
        name: c.name,
        total_events: c.total_events,
        road_closures: c.road_closures,
        high_priority_count: c.high_priority_count,
        top_causes: Object.entries(c.causes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ cause: k, count: v })),
        junctions: Array.from(c.junctions)
    })).sort((a, b) => b.total_events - a.total_events);
    
    const junctions = Object.values(junctionMap).sort((a, b) => b.event_count - a.event_count).map(j => ({
        name: j.name, lat: j.lat, lng: j.lng, event_count: j.event_count, corridor: j.corridor,
        top_causes: Object.entries(j.causes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => ({ cause: k, count: v }))
    }));
    
    const zones = Object.values(zoneMap).sort((a, b) => b.event_count - a.event_count).map(z => ({
        name: z.name, event_count: z.event_count,
        breakdown_by_cause: z.causes
    }));
    
    const cause_severity = {};
    Object.entries(causeStats).forEach(([cause, stats]) => {
        cause_severity[cause] = {
            count: stats.count,
            road_closure_rate: stats.count > 0 ? (stats.road_closures / stats.count) : 0,
            priority_high_rate: stats.count > 0 ? (stats.high_count / stats.count) : 0,
        };
    });
    
    // Build diversion graph
    const nodes = junctions.filter(j => j.lat && j.lng).map((j, i) => ({
        id: i, name: j.name, lat: j.lat, lng: j.lng, corridor: j.corridor
    }));
    
    const edges = [];
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const dist = haversine(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng);
            const sameCorridor = nodes[i].corridor === nodes[j].corridor;
            const threshold = sameCorridor ? 3.0 : 1.5;
            if (dist <= threshold) {
                edges.push({ from: nodes[i].id, to: nodes[j].id, distance_km: Math.round(dist * 100) / 100, corridor: sameCorridor ? nodes[i].corridor : 'cross-corridor' });
            }
        }
    }
    
    // Hotspots (grid clustering)
    const grid = {};
    events.forEach(e => {
        const key = `${Math.round(e.lat / 0.005) * 0.005}_${Math.round(e.lng / 0.005) * 0.005}`;
        if (!grid[key]) grid[key] = { lat: 0, lng: 0, count: 0, sumLat: 0, sumLng: 0 };
        grid[key].count++;
        grid[key].sumLat += e.lat;
        grid[key].sumLng += e.lng;
    });
    const hotspots = Object.values(grid)
        .map(g => ({ lat: g.sumLat / g.count, lng: g.sumLng / g.count, count: g.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 30);
    
    return {
        summary: {
            total_events: events.length,
            planned: events.filter(e => e.event_type === 'planned').length,
            unplanned: events.filter(e => e.event_type === 'unplanned').length,
            road_closures: events.filter(e => e.requires_road_closure).length,
            active: events.filter(e => e.status === 'active').length,
        },
        hourly_distribution: hourly,
        day_of_week_distribution: dow,
        monthly_distribution: monthly,
        corridors, junctions, zones, events,
        planned_events: events.filter(e => e.event_type === 'planned'),
        road_closure_events: events.filter(e => e.requires_road_closure),
        cause_severity,
        diversion_graph: { nodes, edges },
        hotspots,
    };
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current);
    return result;
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Populate Filter Dropdowns ────────────────────────────
function populateFilters() {
    if (!DATA) return;
    
    // Corridors
    const corridorNames = DATA.corridors.filter(c => c.name !== 'Non-corridor').map(c => c.name).sort();
    const corridorSelects = ['pred-corridor', 'div-corridor', 'explorer-corridor-filter'];
    corridorSelects.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        if (id.includes('filter')) {
            // Already has "All" option
        } else {
            sel.innerHTML = '';
        }
        corridorNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
    });
    
    // Causes for map filter
    const causes = [...new Set(DATA.events.map(e => e.cause))].sort();
    const causeFilter = document.getElementById('map-filter-cause');
    const explorerCauseFilter = document.getElementById('explorer-cause-filter');
    causes.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c.replace(/_/g, ' ');
        causeFilter.appendChild(opt.cloneNode(true));
        if (explorerCauseFilter) explorerCauseFilter.appendChild(opt);
    });
    
    // Update corridor-specific junctions
    updateJunctionOptions('pred-corridor', 'pred-junction');
    updateJunctionOptions('div-corridor', 'div-junction');
}

function updateJunctionOptions(corridorSelectId, junctionSelectId) {
    const corridorSel = document.getElementById(corridorSelectId);
    const junctionSel = document.getElementById(junctionSelectId);
    if (!corridorSel || !junctionSel || !DATA) return;
    
    const corridor = corridorSel.value;
    const corr = DATA.corridors.find(c => c.name === corridor);
    junctionSel.innerHTML = '<option value="">— Select —</option>';
    if (corr && corr.junctions) {
        corr.junctions.sort().forEach(j => {
            const opt = document.createElement('option');
            opt.value = j;
            opt.textContent = j;
            junctionSel.appendChild(opt);
        });
    }
}

// ── Dashboard Rendering ──────────────────────────────────
function renderDashboard() {
    if (!DATA) return;
    
    // Inject a Datetime Picker into the Dashboard header if it doesn't exist
    let topBarRight = document.querySelector('.top-bar-right');
    if (topBarRight && !document.getElementById('dashboard-date-filter')) {
        const dateContainer = document.createElement('div');
        dateContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-right: 16px; background: var(--bg-secondary); padding: 4px 12px; border-radius: 8px; border: 1px solid var(--border-color);';
        dateContainer.innerHTML = `
            <span style="font-size: 13px; color: var(--text-secondary);">Simulate Time:</span>
            <input type="datetime-local" id="dashboard-date-filter" min="2023-11-09T00:00" max="2024-04-08T23:59" value="2024-03-15T18:00" style="background: transparent; border: none; color: var(--text-primary); font-family: inherit; font-size: 13px; outline: none; cursor: pointer;">
        `;
        topBarRight.insertBefore(dateContainer, document.getElementById('search-box'));
        
        document.getElementById('dashboard-date-filter').addEventListener('change', (e) => {
            renderDashboardStats(e.target.value);
        });
    }

    renderDashboardStats(document.getElementById('dashboard-date-filter')?.value || "2024-03-15T18:00");
    
    // Charts
    renderHourlyChart();
    renderCorridorChart();
    renderCauseChart();
    renderDOWChart();
    renderMonthlyChart();
    setTimeout(() => renderWeeklyHeatmap(), 100);
}

function renderDashboardStats(selectedDatetime) {
    if (!DATA) return;
    
    // Filter events based on selected datetime (default to a known busy day if empty)
    const targetDt = new Date(selectedDatetime || "2024-03-15T18:00");
    const targetDateStr = targetDt.toISOString().split('T')[0];
    
    // Find events matching the chosen date
    const dailyEvents = DATA.events.filter(e => {
        if (!e.start_datetime) return false;
        return e.start_datetime.startsWith(targetDateStr);
    });
    
    // Estimate active events within a 4-hour window of the selected time
    const activeEvents = dailyEvents.filter(e => {
        const eDt = new Date(e.start_datetime);
        const diffHours = Math.abs(targetDt - eDt) / 36e5;
        return diffHours <= 4;
    });
    
    const roadClosuresOnDate = dailyEvents.filter(e => e.requires_road_closure).length;
    
    // Stat cards
    animateCounter('val-total-events', DATA.summary.total_events);
    animateCounter('val-road-closures', roadClosuresOnDate);
    
    // Change "Active Events" label
    const activeEventsLabel = document.querySelector('#stat-active-events .stat-label');
    if (activeEventsLabel) activeEventsLabel.textContent = 'Active at Time';
    animateCounter('val-active-events', activeEvents.length);
    
    animateCounter('val-corridors', DATA.corridors.filter(c => c.name !== 'Non-corridor').length);
    
    // Update map with the selected datetime
    renderMapMarkers('all', 'all', targetDt);
}

function animateCounter(elementId, target) {
    const el = document.getElementById(elementId);
    if (!el || isNaN(target)) return;
    
    if (el.animationInterval) clearInterval(el.animationInterval);
    
    let current = 0;
    const step = Math.ceil(target / 40) || 1;
    el.animationInterval = setInterval(() => {
        current += step;
        if (current >= target) {
            current = target;
            clearInterval(el.animationInterval);
        }
        el.textContent = current.toLocaleString();
    }, 25);
}

function createGradient(ctx, color1, color2, vertical = true) {
    const gradient = ctx.createLinearGradient(0, 0, vertical ? 0 : ctx.canvas.width, vertical ? ctx.canvas.height : 0);
    gradient.addColorStop(0, color1);
    gradient.addColorStop(1, color2);
    return gradient;
}

function renderHourlyChart() {
    const ctx = document.getElementById('hourly-chart')?.getContext('2d');
    if (!ctx) return;
    
    const data = DATA.hourly_distribution;
    const gradient = createGradient(ctx, 'rgba(99, 102, 241, 0.6)', 'rgba(99, 102, 241, 0.05)');
    const borderGradient = createGradient(ctx, '#6366f1', '#8b5cf6', false);
    
    if (charts.hourly) charts.hourly.destroy();
    charts.hourly = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
            datasets: [{
                label: 'Events',
                data: data,
                backgroundColor: gradient,
                borderColor: '#6366f1',
                borderWidth: 1,
                borderRadius: 4,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    borderColor: 'rgba(99, 102, 241, 0.3)',
                    borderWidth: 1,
                    titleFont: { weight: '600' },
                    callbacks: {
                        title: ctx => `${ctx[0].label} IST`,
                        label: ctx => `${ctx.parsed.y} events`
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { maxRotation: 0, font: { size: 10 } } },
                y: { grid: { color: 'rgba(71, 85, 105, 0.1)' }, beginAtZero: true }
            }
        }
    });
}

function renderCorridorChart() {
    const ctx = document.getElementById('corridor-chart')?.getContext('2d');
    if (!ctx) return;
    
    const top10 = DATA.corridors.filter(c => c.name !== 'Non-corridor').slice(0, 10);
    
    if (charts.corridor) charts.corridor.destroy();
    charts.corridor = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: top10.map(c => c.name.length > 18 ? c.name.slice(0, 18) + '…' : c.name),
            datasets: [
                {
                    label: 'Total Events',
                    data: top10.map(c => c.total_events),
                    backgroundColor: 'rgba(99, 102, 241, 0.6)',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    borderRadius: 4,
                },
                {
                    label: 'Road Closures',
                    data: top10.map(c => c.road_closures),
                    backgroundColor: 'rgba(239, 68, 68, 0.6)',
                    borderColor: '#ef4444',
                    borderWidth: 1,
                    borderRadius: 4,
                }
            ]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top' },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    borderColor: 'rgba(99, 102, 241, 0.3)',
                    borderWidth: 1,
                }
            },
            scales: {
                x: { grid: { color: 'rgba(71, 85, 105, 0.1)' }, beginAtZero: true },
                y: { grid: { display: false }, ticks: { font: { size: 11 } } }
            }
        }
    });
}

function renderCauseChart() {
    const ctx = document.getElementById('cause-chart')?.getContext('2d');
    if (!ctx) return;
    
    const causeData = Object.entries(DATA.cause_severity)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10);
    
    if (charts.cause) charts.cause.destroy();
    charts.cause = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: causeData.map(([k]) => k.replace(/_/g, ' ')),
            datasets: [{
                data: causeData.map(([, v]) => v.count),
                backgroundColor: CHART_COLORS.slice(0, causeData.length),
                borderColor: 'rgba(10, 14, 23, 0.8)',
                borderWidth: 2,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '55%',
            plugins: {
                legend: { position: 'right', labels: { padding: 12, font: { size: 11 } } },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    borderColor: 'rgba(99, 102, 241, 0.3)',
                    borderWidth: 1,
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
                            return `${ctx.parsed} events (${((ctx.parsed / total) * 100).toFixed(1)}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderDOWChart() {
    const ctx = document.getElementById('dow-chart')?.getContext('2d');
    if (!ctx) return;
    
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    let values = [0, 0, 0, 0, 0, 0, 0];

    // Bulletproof fallback: Calculate DOW dynamically from raw events
    if (DATA && DATA.events) {
        DATA.events.forEach(event => {
            if (event.start_datetime && event.start_datetime !== 'NULL') {
                const dt = new Date(event.start_datetime);
                if (!isNaN(dt)) {
                    // JavaScript getDay() returns 0 for Sunday. 
                    // We adjust it so 0 = Monday, 6 = Sunday to match your chart labels.
                    const dayIndex = (dt.getDay() + 6) % 7;
                    values[dayIndex]++;
                }
            }
        });
    }
    
    const gradient = createGradient(ctx, 'rgba(139, 92, 246, 0.5)', 'rgba(139, 92, 246, 0.02)');
    
    if (charts.dow) charts.dow.destroy();
    charts.dow = new Chart(ctx, {
        type: 'line',
        data: {
            labels: days.map(d => d.slice(0, 3)),
            datasets: [{
                label: 'Events',
                data: values,
                borderColor: '#8b5cf6',
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#8b5cf6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    borderColor: 'rgba(139, 92, 246, 0.3)',
                    borderWidth: 1,
                }
            },
            scales: {
                x: { grid: { display: false } },
                y: { grid: { color: 'rgba(71, 85, 105, 0.1)' }, beginAtZero: true }
            }
        }
    });
}

function renderMonthlyChart() {
    const ctx = document.getElementById('monthly-chart')?.getContext('2d');
    if (!ctx) return;
    
    const months = Object.keys(DATA.monthly_distribution).sort();
    const values = months.map(m => DATA.monthly_distribution[m]);
    
    const gradient = createGradient(ctx, 'rgba(59, 130, 246, 0.4)', 'rgba(59, 130, 246, 0.02)');
    
    if (charts.monthly) charts.monthly.destroy();
    charts.monthly = new Chart(ctx, {
        type: 'line',
        data: {
            labels: months.map(m => { 
                const [y, mo] = m.split('-'); 
                return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo, 10) - 1] + ' ' + y.slice(2); 
            }),
            datasets: [{
                label: 'Events',
                data: values,
                borderColor: '#3b82f6',
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#3b82f6',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 6,
                pointHoverRadius: 9,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    borderColor: 'rgba(59, 130, 246, 0.3)',
                    borderWidth: 1,
                }
            },
            scales: {
                x: { grid: { display: false } },
                y: { grid: { color: 'rgba(71, 85, 105, 0.1)' }, beginAtZero: true }
            }
        }
    });
}

// ── Maps (Lazy Initialization) ───────────────────────────
function initDashboardMap() {
    if (dashboardMap) return; // already initialized
    dashboardMap = L.map('dashboard-map', {
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true, // Canvas renderer is MUCH faster than SVG for many markers
    }).setView([12.97, 77.59], 12);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
    }).addTo(dashboardMap);
    
    renderMapMarkers();
    setTimeout(() => {
        dashboardMap.invalidateSize();
        addMapLegend();
        setupLayerToggle();
    }, 200);
}

function addMapLegend() {
    if (!dashboardMap) return;
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = function() {
        const div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML = `
            <h4>Event Causes</h4>
            <div class="map-legend-item"><div class="map-legend-dot" style="background:#f59e0b"></div>Vehicle Breakdown</div>
            <div class="map-legend-item"><div class="map-legend-dot" style="background:#ef4444"></div>Accident / Protest</div>
            <div class="map-legend-item"><div class="map-legend-dot" style="background:#6366f1"></div>Construction</div>
            <div class="map-legend-item"><div class="map-legend-dot" style="background:#3b82f6"></div>Water Logging</div>
            <div class="map-legend-item"><div class="map-legend-dot" style="background:#ec4899"></div>Public Event</div>
            <div class="map-legend-item"><div class="map-legend-dot" style="background:#22c55e"></div>Tree Fall</div>
            <div class="map-legend-item"><div class="map-legend-dot" style="background:#f97316"></div>Pot Holes</div>
        `;
        return div;
    };
    legend.addTo(dashboardMap);
}

function setupLayerToggle() {
    document.querySelectorAll('.layer-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentMapLayer = btn.dataset.layer;
            const causeFilter = document.getElementById('map-filter-cause')?.value || 'all';
            const typeFilter = document.getElementById('map-filter-type')?.value || 'all';
            const dt = new Date(document.getElementById('dashboard-date-filter')?.value || '2024-03-15T18:00');
            renderMapMarkers(causeFilter, typeFilter, dt);
            showToast(`Map view: ${btn.textContent.trim()}`, 'info', 1500);
        });
    });
}

function renderWeeklyHeatmap() {
    if (!DATA || !DATA.weekly_heatmap) return;
    const canvas = document.getElementById('weekly-heatmap-canvas');
    if (!canvas) return;

    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const matrix = DATA.weekly_heatmap;

    const CELL_W = 38;
    const CELL_H = 28;
    const LABEL_W = 38;
    const LABEL_H = 24;
    const PAD = 8;

    const totalW = LABEL_W + 24 * CELL_W + PAD * 2;
    const totalH = LABEL_H + 7 * CELL_H + PAD * 2;

    canvas.width = totalW;
    canvas.height = totalH;
    canvas.style.height = totalH + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, totalW, totalH);

    function heatColor(v) {
        const stops = [
            [0.0,  [10, 14, 23]],
            [0.15, [30, 27, 75]],
            [0.35, [99, 102, 241]],
            [0.55, [139, 92, 246]],
            [0.75, [249, 115, 22]],
            [1.0,  [239, 68, 68]],
        ];
        for (let i = 1; i < stops.length; i++) {
            if (v <= stops[i][0]) {
                const t = (v - stops[i-1][0]) / (stops[i][0] - stops[i-1][0]);
                const [r1,g1,b1] = stops[i-1][1];
                const [r2,g2,b2] = stops[i][1];
                return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
            }
        }
        return `rgb(239,68,68)`;
    }

    ctx.font = '9px Inter, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    for (let h = 0; h < 24; h++) {
        if (h % 3 === 0) {
            ctx.fillText(h + 'h', LABEL_W + h * CELL_W + CELL_W / 2 + PAD, LABEL_H - 4 + PAD);
        }
    }

    ctx.textAlign = 'right';
    ctx.font = '10px Inter, sans-serif';
    for (let d = 0; d < 7; d++) {
        const y = LABEL_H + d * CELL_H + PAD;
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(DAYS[d], LABEL_W - 4 + PAD, y + CELL_H / 2 + 4);
        for (let h = 0; h < 24; h++) {
            const x = LABEL_W + h * CELL_W + PAD;
            const val = matrix[d] ? (matrix[d][h] || 0) : 0;
            ctx.fillStyle = heatColor(val);
            ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
            if (val > 0.55) {
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                ctx.font = '8px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(Math.round(val * 100) + '%', x + CELL_W / 2, y + CELL_H / 2 + 3);
                ctx.font = '10px Inter, sans-serif';
                ctx.textAlign = 'right';
            }
        }
    }

    // Tooltip on hover
    canvas.onmousemove = function(e) {
        const rect = canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const my = (e.clientY - rect.top) * (canvas.height / rect.height);
        const col = Math.floor((mx - LABEL_W - PAD) / CELL_W);
        const row = Math.floor((my - LABEL_H - PAD) / CELL_H);
        if (col >= 0 && col < 24 && row >= 0 && row < 7 && matrix[row]) {
            const val = matrix[row][col] || 0;
            canvas.title = `${DAYS[row]} ${col}:00–${col+1}:00 — Congestion Risk: ${Math.round(val * 100)}%`;
        } else {
            canvas.title = '';
        }
    };
}

function initDiversionMap() {
    if (diversionMap) return; // already initialized
    diversionMap = L.map('diversion-map', {
        zoomControl: true,
        attributionControl: false,
        preferCanvas: true,
    }).setView([12.97, 77.59], 12);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
    }).addTo(diversionMap);
    
    renderDiversionGraph();
    setTimeout(() => diversionMap.invalidateSize(), 200);
}

let mapMarkerLayer = null;
let mapHeatLayer = null;
let mapClusterLayer = null;
let currentMapLayer = 'heatmap';

function renderMapMarkers(causeFilter = 'all', typeFilter = 'all', targetDt = null) {
    if (!dashboardMap || !DATA) return;

    if (mapMarkerLayer) { dashboardMap.removeLayer(mapMarkerLayer); mapMarkerLayer = null; }
    if (mapHeatLayer) { dashboardMap.removeLayer(mapHeatLayer); mapHeatLayer = null; }
    if (mapClusterLayer) { dashboardMap.removeLayer(mapClusterLayer); mapClusterLayer = null; }

    const causeColors = {
        vehicle_breakdown: '#f59e0b', accident: '#ef4444', construction: '#6366f1',
        public_event: '#ec4899', procession: '#d946ef', vip_movement: '#a78bfa',
        tree_fall: '#22c55e', water_logging: '#3b82f6', pot_holes: '#f97316',
        congestion: '#ef4444', protest: '#dc2626', road_conditions: '#64748b', others: '#94a3b8',
    };

    let filtered = DATA.events;
    if (causeFilter !== 'all') filtered = filtered.filter(e => e.cause === causeFilter);
    if (typeFilter !== 'all') filtered = filtered.filter(e => e.event_type === typeFilter);
    if (targetDt) {
        const targetDateStr = targetDt.toISOString().split('T')[0];
        filtered = filtered.filter(e => e.start_datetime && e.start_datetime.startsWith(targetDateStr));
    }

    if (filtered.length === 0 && targetDt) {
        const hotspots = (DATA.hotspots || []).slice(0, 15);
        const fallbackLayer = L.layerGroup();
        hotspots.forEach(h => {
            L.circle([h.lat, h.lng], { radius: 200, fillColor: '#6366f1', fillOpacity: 0.15, stroke: false }).addTo(fallbackLayer);
        });
        mapMarkerLayer = fallbackLayer;
        fallbackLayer.addTo(dashboardMap);
        return;
    }

    // Build HEATMAP layer (Leaflet.heat)
    if (typeof L.heatLayer === 'function') {
        const heatPoints = filtered.map(e => [
            e.lat, e.lng,
            e.requires_road_closure ? 1.0 : (e.priority === 'High' ? 0.6 : 0.3)
        ]);
        mapHeatLayer = L.heatLayer(heatPoints, {
            radius: 18, blur: 22, maxZoom: 16, max: 1.0,
            gradient: { 0.1: '#3b82f6', 0.4: '#8b5cf6', 0.6: '#f59e0b', 0.8: '#f97316', 1.0: '#ef4444' },
        });
    }

    // Build CLUSTER layer
    const MAX_CLUSTER = 2000;
    if (typeof L.markerClusterGroup === 'function') {
        const clusterGroup = L.markerClusterGroup({
            chunkedLoading: true,
            maxClusterRadius: 50,
            showCoverageOnHover: false,
            iconCreateFunction: function(cluster) {
                const count = cluster.getChildCount();
                let cls = 'small', size = 36;
                if (count >= 100) { cls = 'large'; size = 52; }
                else if (count >= 20) { cls = 'medium'; size = 44; }
                return L.divIcon({
                    html: `<div style="width:${size}px;height:${size}px;line-height:${size}px;text-align:center;border-radius:50%;font-size:${size > 40 ? 13 : 11}px;">${count}</div>`,
                    className: `marker-cluster marker-cluster-${cls}`,
                    iconSize: [size, size]
                });
            }
        });
        const step = filtered.length > MAX_CLUSTER ? Math.ceil(filtered.length / MAX_CLUSTER) : 1;
        for (let i = 0; i < filtered.length; i += step) {
            const event = filtered[i];
            const color = causeColors[event.cause] || '#94a3b8';
            const marker = L.circleMarker([event.lat, event.lng], {
                radius: event.requires_road_closure ? 9 : 5,
                fillColor: color,
                fillOpacity: event.requires_road_closure ? 0.9 : 0.7,
                stroke: event.requires_road_closure,
                color: event.requires_road_closure ? '#fff' : color,
                weight: 2,
            });
            marker.on('click', function() {
                this.bindPopup(`
                    <div class="popup-title">${event.cause.replace(/_/g, ' ').toUpperCase()}</div>
                    <div class="popup-detail">
                        <strong>Corridor:</strong> ${event.corridor}<br>
                        ${event.junction ? `<strong>Junction:</strong> ${event.junction}<br>` : ''}
                        <strong>Type:</strong> ${event.event_type} | <strong>Priority:</strong> ${event.priority}<br>
                        <strong>Road Closure:</strong> ${event.requires_road_closure ? '\U0001f534 Yes' : '\U0001f7e2 No'}<br>
                        <strong>Status:</strong> ${event.status}
                    </div>
                `).openPopup();
            });
            clusterGroup.addLayer(marker);
        }
        mapClusterLayer = clusterGroup;
    }

    if (currentMapLayer === 'heatmap' || currentMapLayer === 'both') {
        if (mapHeatLayer) mapHeatLayer.addTo(dashboardMap);
    }
    if (currentMapLayer === 'clusters' || currentMapLayer === 'both') {
        if (mapClusterLayer) mapClusterLayer.addTo(dashboardMap);
    }
}

let diversionGraphLayer = null;
let currentDiversionHighlightLayer = null;

function renderDiversionGraph() {
    if (!diversionMap || !DATA || !DATA.diversion_graph) return;
    
    if (diversionGraphLayer) diversionMap.removeLayer(diversionGraphLayer);
    if (currentDiversionHighlightLayer) diversionMap.removeLayer(currentDiversionHighlightLayer);
    
    const layer = L.layerGroup();
    const { nodes, edges } = DATA.diversion_graph;
    
    // Only draw SAME-CORRIDOR edges (skip cross-corridor to reduce count drastically)
    // Sample edges: max 300 for performance
    const sameCorridorEdges = edges.filter(e => e.corridor !== 'cross-corridor');
    const edgeStep = sameCorridorEdges.length > 300 ? Math.ceil(sameCorridorEdges.length / 300) : 1;
    
    for (let i = 0; i < sameCorridorEdges.length; i += edgeStep) {
        const edge = sameCorridorEdges[i];
        const from = nodes.find(n => n.id === edge.from);
        const to = nodes.find(n => n.id === edge.to);
        if (!from || !to) continue;
        
        L.polyline([[from.lat, from.lng], [to.lat, to.lng]], {
            color: 'rgba(99, 102, 241, 0.35)',
            weight: 1.5,
        }).addTo(layer);
    }
    
    // Draw nodes — only junction nodes (skip if > 200, show top 150 by connection count)
    const nodeConnections = {};
    edges.forEach(e => {
        nodeConnections[e.from] = (nodeConnections[e.from] || 0) + 1;
        nodeConnections[e.to] = (nodeConnections[e.to] || 0) + 1;
    });
    const sortedNodes = [...nodes].sort((a, b) => (nodeConnections[b.id] || 0) - (nodeConnections[a.id] || 0)).slice(0, 150);
    
    sortedNodes.forEach(node => {
        const marker = L.circleMarker([node.lat, node.lng], {
            radius: 4,
            fillColor: '#6366f1',
            fillOpacity: 0.85,
            stroke: true,
            color: '#fff',
            weight: 1,
        });
        
        marker.on('click', function() {
            const conns = nodeConnections[node.id] || 0;
            this.bindPopup(`
                <div class="popup-title">${node.name}</div>
                <div class="popup-detail">
                    <strong>Corridor:</strong> ${node.corridor}<br>
                    <strong>Connections:</strong> ${conns}
                </div>
            `).openPopup();
        });
        
        marker.addTo(layer);
    });
    
    diversionGraphLayer = layer;
    layer.addTo(diversionMap);
}

// ── Impact Predictor ─────────────────────────────────────
function calculateImpactScore(params) {
    const causeScores = {
        public_event: 1.0, protest: 0.95, procession: 0.9, vip_movement: 0.85,
        accident: 0.8, construction: 0.7, water_logging: 0.6, tree_fall: 0.55,
        congestion: 0.5, vehicle_breakdown: 0.45, pot_holes: 0.35, road_conditions: 0.3, others: 0.25,
    };
    
    const eventTypeScore = params.event_type === 'planned' ? 1.0 : 0.7;
    const causeScore = causeScores[params.cause] || 0.3;
    const roadClosureScore = params.road_closure ? 1.0 : 0.3;
    const priorityScore = params.priority === 'High' ? 1.0 : 0.4;
    
    // Corridor importance from data
    const corr = DATA.corridors.find(c => c.name === params.corridor);
    const maxEvents = DATA.corridors[0]?.total_events || 1;
    const corridorImportance = corr ? Math.min(corr.total_events / maxEvents, 1.0) : 0.3;
    
    // Time of day multiplier
    const hour = params.hour;
    let timeMultiplier = 0.5;
    if ((hour >= 8 && hour <= 11) || (hour >= 17 && hour <= 20)) timeMultiplier = 1.0;
    else if ((hour >= 7 && hour <= 12) || (hour >= 16 && hour <= 21)) timeMultiplier = 0.8;
    
    // Duration factor
    const durationFactor = Math.min(params.duration / 24, 1.0);
    
    const bss = (
        0.15 * eventTypeScore +
        0.25 * causeScore +
        0.20 * roadClosureScore +
        0.12 * priorityScore +
        0.13 * corridorImportance +
        0.08 * timeMultiplier +
        0.07 * durationFactor
    );
    
    return Math.round(bss * 100) / 100;
}

function renderBSSRadar(params, bss) {
    const ctx = document.getElementById('bss-radar-chart')?.getContext('2d');
    if (!ctx) return;

    const causeScores = {
        public_event: 1.0, protest: 0.95, procession: 0.9, vip_movement: 0.85,
        accident: 0.8, construction: 0.7, water_logging: 0.6, tree_fall: 0.55,
        congestion: 0.5, vehicle_breakdown: 0.45, pot_holes: 0.35, road_conditions: 0.3, others: 0.25,
    };
    const corr = DATA.corridors.find(c => c.name === params.corridor);
    const maxEv = DATA.corridors[0]?.total_events || 1;
    const corrImportance = corr ? Math.min(corr.total_events / maxEv, 1.0) : 0.3;
    const h = params.hour;
    const timeMult = ((h >= 8 && h <= 11) || (h >= 17 && h <= 20)) ? 1.0 : ((h >= 6 && h <= 12) || (h >= 15 && h <= 21)) ? 0.8 : 0.5;

    const factors = [
        Math.round((causeScores[params.cause] || 0.3) * 100),
        Math.round((params.road_closure ? 1.0 : 0.3) * 100),
        Math.round((params.event_type === 'planned' ? 1.0 : 0.7) * 100),
        Math.round((params.priority === 'High' ? 1.0 : 0.4) * 100),
        Math.round(corrImportance * 100),
        Math.round(timeMult * 100),
        Math.round(Math.min(params.duration / 24, 1.0) * 100),
    ];
    const labels = ['Cause Risk', 'Road Closure', 'Event Type', 'Priority', 'Corridor Load', 'Time of Day', 'Duration'];

    if (charts.bssRadar) charts.bssRadar.destroy();
    charts.bssRadar = new Chart(ctx, {
        type: 'radar',
        data: {
            labels,
            datasets: [{
                label: 'BSS Factors',
                data: factors,
                backgroundColor: 'rgba(99,102,241,0.18)',
                borderColor: '#6366f1',
                borderWidth: 2,
                pointBackgroundColor: '#8b5cf6',
                pointRadius: 4,
                pointHoverRadius: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    min: 0, max: 100,
                    ticks: { stepSize: 25, color: '#64748b', font: { size: 9 }, backdropColor: 'transparent' },
                    grid: { color: 'rgba(71,85,105,0.2)' },
                    pointLabels: { color: '#94a3b8', font: { size: 10 } },
                    angleLines: { color: 'rgba(71,85,105,0.2)' },
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(17,24,39,0.95)',
                    callbacks: { label: ctx => `${ctx.label}: ${ctx.raw}%` }
                }
            }
        }
    });
}

function getBarricadeCategory(bss) {
    if (bss >= 0.8) return { level: 'Full Closure', class: 'badge-critical', type: 'Jersey barriers + Complete road block + Multi-point', equipment: 'Jersey barriers ×8, Metal barricades ×12, Cones ×20, Sign boards ×6, Blinkers ×8' };
    if (bss >= 0.6) return { level: 'Partial Closure', class: 'badge-high', type: 'Cones + Movable barriers + Lane restriction', equipment: 'Metal barricades ×6, Cones ×15, Sign boards ×4, Blinkers ×4' };
    if (bss >= 0.4) return { level: 'Warning Zone', class: 'badge-medium', type: 'Sign boards + Blinkers + Traffic marshals', equipment: 'Sign boards ×4, Blinkers ×6, Warning tape ×50m' };
    return { level: 'Monitor Only', class: 'badge-low', type: 'Surveillance + Alert patrols', equipment: 'Walkie-talkie ×2' };
}

function getManpowerNeeds(params) {
    const baseCount = {
        public_event: 8, protest: 12, procession: 10, vip_movement: 6,
        construction: 4, accident: 3, vehicle_breakdown: 2, tree_fall: 3,
        water_logging: 3, congestion: 4, pot_holes: 2, road_conditions: 2, others: 2,
    };
    
    const base = baseCount[params.cause] || 3;
    const severityMultiplier = 1.0 + (params.bss * 2.5);
    const durationFactor = params.duration > 12 ? 1.5 : params.duration > 6 ? 1.2 : 1.0;
    const closureFactor = params.road_closure ? 1.4 : 1.0;
    
    const total = Math.round(base * severityMultiplier * durationFactor * closureFactor);
    
    // Shift breakdown (8-hour shifts)
    const shifts = Math.ceil(params.duration / 8);
    
    return {
        total_per_shift: total,
        shifts: shifts,
        total_officers: total, // On duty at any time
        breakdown: {
            'Traffic Control': Math.round(total * 0.4),
            'Crowd Management': Math.round(total * 0.25),
            'Emergency Response': Math.round(total * 0.2),
            'Surveillance': Math.round(total * 0.15),
        }
    };
}

function simulateEvent() {
    const causes = ['public_event', 'procession', 'vip_movement', 'construction', 'protest', 'accident', 'vehicle_breakdown', 'tree_fall', 'water_logging', 'pot_holes', 'road_conditions', 'congestion'];
    const corridors = Array.from(document.getElementById('pred-corridor').options).map(o => o.value).filter(v => v !== '');
    const priorities = ['High', 'Low'];
    const types = ['planned', 'unplanned'];
    
    document.getElementById('pred-event-type').value = types[Math.floor(Math.random() * types.length)];
    document.getElementById('pred-cause').value = causes[Math.floor(Math.random() * causes.length)];
    if (corridors.length > 0) {
        document.getElementById('pred-corridor').value = corridors[Math.floor(Math.random() * corridors.length)];
        updateJunctionOptions('pred-corridor', 'pred-junction');
    }
    document.getElementById('pred-priority').value = priorities[Math.floor(Math.random() * priorities.length)];
    document.getElementById('pred-road-closure').value = Math.random() > 0.7 ? 'true' : 'false';
    document.getElementById('pred-duration').value = (Math.floor(Math.random() * 8) + 1) * 0.5; // 0.5 to 4.5 hours
    
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('pred-datetime').value = now.toISOString().slice(0,16);
    
    document.getElementById('impact-form').dispatchEvent(new Event('submit'));
}

function renderPrediction(params) {
    const bss = calculateImpactScore(params);
    const category = getBarricadeCategory(bss);
    const manpower = getManpowerNeeds({ ...params, bss });
    
    // Show results
    document.getElementById('predictor-results').style.display = '';
    
    // Render BSS Radar Chart
    renderBSSRadar(params, bss);

    // Animate score ring
    const scoreFill = document.getElementById('score-fill');
    const scoreValue = document.getElementById('score-value');
    const scoreLabel = document.getElementById('score-label');
    
    const circumference = 2 * Math.PI * 85;
    const offset = circumference * (1 - bss);
    
    // Set gradient
    const svg = scoreFill.closest('svg');
    if (!svg.querySelector('defs')) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const grad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
        grad.id = 'scoreGradient';
        const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop1.setAttribute('offset', '0%');
        const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stop2.setAttribute('offset', '100%');
        
        if (bss >= 0.8) { stop1.setAttribute('stop-color', '#ef4444'); stop2.setAttribute('stop-color', '#f97316'); }
        else if (bss >= 0.6) { stop1.setAttribute('stop-color', '#f97316'); stop2.setAttribute('stop-color', '#eab308'); }
        else if (bss >= 0.4) { stop1.setAttribute('stop-color', '#eab308'); stop2.setAttribute('stop-color', '#22c55e'); }
        else { stop1.setAttribute('stop-color', '#22c55e'); stop2.setAttribute('stop-color', '#10b981'); }
        
        grad.appendChild(stop1);
        grad.appendChild(stop2);
        defs.appendChild(grad);
        svg.insertBefore(defs, svg.firstChild);
    }
    
    scoreFill.style.strokeDasharray = circumference;
    setTimeout(() => { scoreFill.style.strokeDashoffset = offset; }, 100);
    
    // Animate counter
    if (window.scoreInterval) clearInterval(window.scoreInterval);
    
    let counter = 0;
    const target = Math.round(bss * 100);
    window.scoreInterval = setInterval(() => {
        counter += 2;
        if (counter >= target) { counter = target; clearInterval(window.scoreInterval); }
        scoreValue.textContent = counter;
    }, 20);
    
    scoreLabel.textContent = category.level;
    scoreLabel.className = 'score-label';
    
    // Response Plan
    const planContent = document.getElementById('response-plan-content');
    
    // Estimate affected population based on corridor event density × traffic volume factor
    const corridorData = DATA.corridors.find(c => c.name === params.corridor);
    const corridorEventDensity = corridorData ? corridorData.total_events : 10;
    const trafficVolumeFactor = ((params.hour >= 8 && params.hour <= 11) || (params.hour >= 17 && params.hour <= 20)) ? 3.2 : ((params.hour >= 7 && params.hour <= 12) || (params.hour >= 16 && params.hour <= 21)) ? 2.4 : 1.5;
    const affectedPop = Math.round(corridorEventDensity * trafficVolumeFactor * 120 * (params.road_closure ? 1.8 : 1.0));
    
    // Communication channels based on severity
    const commChannels = [];
    if (bss >= 0.3) commChannels.push({ icon: '📡', name: 'VMS Boards', detail: 'Variable Message Signs on corridor entry points' });
    if (bss >= 0.4) commChannels.push({ icon: '📻', name: 'Traffic Radio', detail: 'FM 107.1 Bengaluru Traffic advisory' });
    if (bss >= 0.5) commChannels.push({ icon: '📱', name: 'Social Media Alerts', detail: 'BTP Twitter/X, WhatsApp broadcast, Google Maps alert' });
    if (bss >= 0.7) commChannels.push({ icon: '🚨', name: 'Emergency Broadcast', detail: 'SMS blast to registered commuters in area' });
    if (bss >= 0.8) commChannels.push({ icon: '📺', name: 'Local News Ticker', detail: 'Breaking news banner on local TV channels' });
    
    // Timeline milestones
    const eventHour = params.hour;
    const duration = params.duration || 4;
    const fmt = (h) => { const hh = Math.floor(((h % 24) + 24) % 24); const mm = Math.round((h - Math.floor(h)) * 60); return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`; };
    const timeline = [
        { time: fmt(eventHour - 2), label: 'T-2h: Preparation', desc: 'Deploy barricades, brief officers, activate VMS boards', icon: '🔧' },
        { time: fmt(eventHour - 1), label: 'T-1h: Pre-positioning', desc: 'Officers at junctions, diversion signs up, radio advisory starts', icon: '🚔' },
        { time: fmt(eventHour), label: 'T-0: Event Start', desc: 'Full deployment active, real-time monitoring begins', icon: '🟢' },
        { time: fmt(eventHour + duration / 2), label: `T+${(duration/2).toFixed(0)}h: Mid-event Check`, desc: 'Assess crowd/traffic, adjust deployment if needed', icon: '📊' },
        { time: fmt(eventHour + duration), label: `T+${duration}h: Event End`, desc: 'Begin wind-down, partial barrier removal', icon: '🏁' },
        { time: fmt(eventHour + duration + 1), label: `T+${duration+1}h: Normalization`, desc: 'All barriers removed, traffic flow restored, debrief', icon: '✅' },
    ];
    
    planContent.innerHTML = `
        <div class="plan-section">
            <h4>🚧 Barricading Plan</h4>
            <p><strong>Level:</strong> <span class="badge ${category.class}">${category.level}</span></p>
            <p><strong>Type:</strong> ${category.type}</p>
            <p><strong>Equipment:</strong> ${category.equipment}</p>
        </div>
        <div class="plan-section">
            <h4>👮 Manpower Deployment</h4>
            <p><strong>Officers per shift:</strong> ${manpower.total_per_shift}</p>
            <p><strong>Shifts needed:</strong> ${manpower.shifts}</p>
            <ul>
                ${Object.entries(manpower.breakdown).map(([k, v]) => `<li>${k}: ${v} officers</li>`).join('')}
            </ul>
        </div>
        <div class="plan-section">
            <h4>🔀 Diversion Recommendation</h4>
            <p>${params.road_closure ? '⚠️ Road closure required — activate diversion routes for ' + params.corridor : '✅ No full closure — advisory diversions recommended'}</p>
            <p><strong>Affected corridor:</strong> ${params.corridor}</p>
            ${params.junction ? `<p><strong>Blocked junction:</strong> ${params.junction}</p>` : ''}
        </div>
        <div class="plan-section" style="border-top: 1px solid rgba(99,102,241,0.15); padding-top: 16px;">
            <h4>👥 Estimated Affected Population</h4>
            <p style="font-size: 28px; font-weight: 700; color: ${affectedPop > 50000 ? '#ef4444' : affectedPop > 20000 ? '#f97316' : '#22c55e'}; margin: 8px 0;">${affectedPop.toLocaleString()} <span style="font-size: 14px; color: var(--text-secondary); font-weight: 400;">commuters impacted</span></p>
            <p style="font-size: 12px; color: var(--text-muted);">Based on corridor event density (${corridorEventDensity} events) × traffic volume factor (${trafficVolumeFactor}×) × avg. vehicle density</p>
        </div>
        <div class="plan-section" style="border-top: 1px solid rgba(99,102,241,0.15); padding-top: 16px;">
            <h4>📢 Suggested Communication Channels</h4>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
                ${commChannels.map(ch => `
                    <div style="display: flex; align-items: center; gap: 12px; background: rgba(99,102,241,0.06); padding: 10px 14px; border-radius: 8px; border-left: 3px solid rgba(99,102,241,0.4);">
                        <span style="font-size: 20px;">${ch.icon}</span>
                        <div>
                            <div style="font-weight: 600; font-size: 13px; color: var(--text-primary);">${ch.name}</div>
                            <div style="font-size: 11px; color: var(--text-muted);">${ch.detail}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="plan-section" style="border-top: 1px solid rgba(99,102,241,0.15); padding-top: 16px;">
            <h4>🕐 Event Timeline & Milestones</h4>
            <div style="margin-top: 12px; position: relative; padding-left: 24px;">
                <div style="position: absolute; left: 10px; top: 6px; bottom: 6px; width: 2px; background: linear-gradient(to bottom, #6366f1, #22c55e); border-radius: 1px;"></div>
                ${timeline.map((t, i) => `
                    <div style="position: relative; margin-bottom: 16px; padding-left: 20px;">
                        <div style="position: absolute; left: -18px; top: 3px; width: 12px; height: 12px; border-radius: 50%; background: ${i === 2 ? '#22c55e' : i === timeline.length - 1 ? '#6366f1' : '#475569'}; border: 2px solid var(--bg-primary); box-shadow: 0 0 0 2px ${i === 2 ? '#22c55e44' : 'transparent'};"></div>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <span style="font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #6366f1; min-width: 48px;">${t.time}</span>
                            <span style="font-size: 14px;">${t.icon}</span>
                            <strong style="font-size: 13px; color: var(--text-primary);">${t.label}</strong>
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-left: 76px; margin-top: 2px;">${t.desc}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    // Historical comparison
    const histDiv = document.getElementById('historical-comparison');
    const similarEvents = DATA.events.filter(e => e.cause === params.cause && e.corridor === params.corridor);
    const closureRate = similarEvents.length > 0 ? (similarEvents.filter(e => e.requires_road_closure).length / similarEvents.length * 100).toFixed(1) : 0;
    const highPriorityRate = similarEvents.length > 0 ? (similarEvents.filter(e => e.priority === 'High').length / similarEvents.length * 100).toFixed(1) : 0;
    
    histDiv.innerHTML = `
        <div class="hist-item">
            <span class="hist-label">Similar events in history</span>
            <span class="hist-value">${similarEvents.length}</span>
        </div>
        <div class="hist-item">
            <span class="hist-label">Historical road closure rate</span>
            <span class="hist-value">${closureRate}%</span>
        </div>
        <div class="hist-item">
            <span class="hist-label">High priority rate</span>
            <span class="hist-value">${highPriorityRate}%</span>
        </div>
        <div class="hist-item">
            <span class="hist-label">Corridor total events</span>
            <span class="hist-value">${DATA.corridors.find(c => c.name === params.corridor)?.total_events || 'N/A'}</span>
        </div>
        <div class="hist-item">
            <span class="hist-label">BSS Score</span>
            <span class="hist-value" style="color: ${bss >= 0.8 ? '#ef4444' : bss >= 0.6 ? '#f97316' : bss >= 0.4 ? '#eab308' : '#22c55e'}">${(bss * 100).toFixed(0)}%</span>
        </div>
        <div class="hist-item">
            <span class="hist-label">Est. affected population</span>
            <span class="hist-value" style="color: ${affectedPop > 50000 ? '#ef4444' : affectedPop > 20000 ? '#f97316' : '#22c55e'}">${affectedPop.toLocaleString()}</span>
        </div>
    `;
}

// ── Diversion Planner ────────────────────────────────────
function findDiversions(corridor, junction) {
    if (!DATA || !DATA.diversion_graph) return;
    
    const { nodes, edges } = DATA.diversion_graph;
    const resultsDiv = document.getElementById('diversion-results');
    
    // Find nodes in the blocked corridor (and optionally specific junction)
    const blockedNodes = nodes.filter(n => n.corridor === corridor && (!junction || n.name === junction));
    const blockedNodeIds = new Set(blockedNodes.map(n => n.id));
    
    if (blockedNodes.length === 0) {
        resultsDiv.innerHTML = '<p style="color: var(--text-muted);">No junctions found for this corridor in the graph. This corridor may not have mapped junctions.</p>';
        return;
    }
    
    // Find alternative routes: adjacent corridors connected to this one
    const connectedCorridors = new Map();
    edges.forEach(edge => {
        const fromNode = nodes.find(n => n.id === edge.from);
        const toNode = nodes.find(n => n.id === edge.to);
        if (!fromNode || !toNode) return;
        
        if (blockedNodeIds.has(edge.from) && !blockedNodeIds.has(edge.to)) {
            const key = toNode.corridor;
            if (!connectedCorridors.has(key)) connectedCorridors.set(key, []);
            connectedCorridors.get(key).push({
                from: fromNode.name,
                to: toNode.name,
                distance: edge.distance_km,
            });
        }
        if (blockedNodeIds.has(edge.to) && !blockedNodeIds.has(edge.from)) {
            const key = fromNode.corridor;
            if (!connectedCorridors.has(key)) connectedCorridors.set(key, []);
            connectedCorridors.get(key).push({
                from: toNode.name,
                to: fromNode.name,
                distance: edge.distance_km,
            });
        }
    });
    
    if (connectedCorridors.size === 0) {
        resultsDiv.innerHTML = '<p style="color: var(--text-muted);">No cross-corridor diversions found. Consider broader network analysis.</p>';
        return;
    }
    
    // Calculate severity rating for each alternative corridor based on historical events
    const corridorSeverity = {};
    connectedCorridors.forEach((connections, corridorName) => {
        const altCorrData = DATA.corridors.find(c => c.name === corridorName);
        const eventCount = altCorrData ? altCorrData.total_events : 0;
        const maxCorridorEvents = DATA.corridors[0]?.total_events || 1;
        const ratio = eventCount / maxCorridorEvents;
        let severity, color, label;
        if (ratio >= 0.5) { severity = 'high'; color = '#ef4444'; label = '🔴 High Event History'; }
        else if (ratio >= 0.2) { severity = 'moderate'; color = '#f59e0b'; label = '🟡 Moderate Event History'; }
        else { severity = 'low'; color = '#22c55e'; label = '🟢 Low Event History'; }
        // Estimated capacity: inversely proportional to historical events
        const capacityScore = Math.max(10, Math.round((1 - ratio) * 100));
        corridorSeverity[corridorName] = { severity, color, label, eventCount, capacityScore };
    });
    
    let html = `<h4 style="margin-bottom:12px; color: var(--success);">✅ ${connectedCorridors.size} Alternative Corridor(s) Found</h4>`;
    
    let routeIdx = 0;
    connectedCorridors.forEach((connections, corridorName) => {
        routeIdx++;
        const avgDist = (connections.reduce((s, c) => s + c.distance, 0) / connections.length).toFixed(2);
        const estDelay = (parseFloat(avgDist) * 2.5).toFixed(0); // rough estimate
        const sev = corridorSeverity[corridorName];
        
        html += `
            <div class="diversion-route" style="border-left: 4px solid ${sev.color};">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <h4 style="margin: 0;">Route ${routeIdx}: via ${corridorName}</h4>
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <span style="font-size: 11px; padding: 3px 10px; border-radius: 12px; background: ${sev.color}22; color: ${sev.color}; font-weight: 600; border: 1px solid ${sev.color}44;">${sev.label}</span>
                        <span style="font-size: 11px; padding: 3px 10px; border-radius: 12px; background: rgba(99,102,241,0.1); color: #818cf8; font-weight: 600;">Capacity: ${sev.capacityScore}%</span>
                    </div>
                </div>
                <p style="margin-top: 8px;"><strong>Connection points:</strong></p>
                <ul style="padding-left:18px; font-size:12px; color: var(--text-secondary);">
                    ${connections.slice(0, 3).map(c => `<li>${c.from} → ${c.to} (${c.distance} km)</li>`).join('')}
                    ${connections.length > 3 ? `<li>...and ${connections.length - 3} more</li>` : ''}
                </ul>
                <div class="route-meta">
                    <span>📏 Avg. distance: ${avgDist} km</span>
                    <span>⏱️ Est. extra time: ~${estDelay} min</span>
                    <span>🔗 ${connections.length} connection(s)</span>
                    <span style="color: ${sev.color};">📊 Historical events: ${sev.eventCount}</span>
                </div>
            </div>
        `;
    });
    
    resultsDiv.innerHTML = html;
    
    // Highlight on map
    highlightDiversionOnMap(corridor, blockedNodes, connectedCorridors, nodes, edges);
}

function highlightDiversionOnMap(blockedCorridor, blockedNodes, connectedCorridors, nodes, edges) {
    if (!diversionMap) return;

    // Reset map
    renderDiversionGraph();

    if (currentDiversionHighlightLayer) {
        diversionMap.removeLayer(currentDiversionHighlightLayer);
    }
    const highlightGroup = L.layerGroup().addTo(diversionMap);
    currentDiversionHighlightLayer = highlightGroup;

    // Highlight blocked corridor in red (using real road geometry via OSRM)
    const blockedNodeIds = new Set(blockedNodes.map(n => n.id));
    const redSegments = [];
    edges.forEach(edge => {
        const from = nodes.find(n => n.id === edge.from);
        const to = nodes.find(n => n.id === edge.to);
        if (!from || !to) return;
        if (blockedNodeIds.has(edge.from) && blockedNodeIds.has(edge.to)) {
            redSegments.push([from, to]);
        }
    });

    // Fetch & draw blocked segments in red
    redSegments.forEach(([from, to]) => {
        fetchRoadRoute(from.lat, from.lng, to.lat, to.lng).then(coords => {
            L.polyline(coords, {
                color: '#ef4444',
                weight: 5,
                opacity: 0.9,
            }).addTo(highlightGroup);
        });
    });

    // Highlight blocked junctions
    blockedNodes.forEach(n => {
        L.circleMarker([n.lat, n.lng], {
            radius: 10,
            fillColor: '#ef4444',
            fillOpacity: 0.95,
            stroke: true,
            color: '#fff',
            weight: 2,
        }).bindTooltip(`🚫 Blocked: ${n.name}`, { permanent: false, direction: 'top' }).addTo(highlightGroup);
    });

    // Highlight alternative routes in green using real road geometry
    const allAltCoords = [];
    connectedCorridors.forEach((connections) => {
        connections.forEach(conn => {
            const fromNode = nodes.find(n => n.name === conn.from);
            const toNode = nodes.find(n => n.name === conn.to);
            if (fromNode && toNode) {
                allAltCoords.push([fromNode.lat, fromNode.lng]);
                allAltCoords.push([toNode.lat, toNode.lng]);
                fetchRoadRoute(fromNode.lat, fromNode.lng, toNode.lat, toNode.lng).then(coords => {
                    L.polyline(coords, {
                        color: '#10b981',
                        weight: 5,
                        opacity: 0.95,
                        dashArray: '10 5',
                    }).addTo(highlightGroup);
                });
                L.circleMarker([toNode.lat, toNode.lng], {
                    radius: 8,
                    fillColor: '#10b981',
                    fillOpacity: 0.9,
                    stroke: true,
                    color: '#fff',
                    weight: 2,
                }).bindTooltip(`✅ Via: ${toNode.name}`, { permanent: false, direction: 'top' }).addTo(highlightGroup);
            }
        });
    });

    // Fit bounds to all relevant coords
    const boundsCoords = [
        ...blockedNodes.map(n => [n.lat, n.lng]),
        ...allAltCoords,
    ];
    if (boundsCoords.length > 0) {
        diversionMap.fitBounds(boundsCoords, { padding: [50, 50] });
    }
}

/**
 * Fetch a real road-following route between two lat/lng points
 * using the free OSRM demo server. Falls back to straight line if offline.
 * @returns {Promise<Array<[lat, lng]>>}
 */
async function fetchRoadRoute(lat1, lng1, lat2, lng2) {
    const fallback = [[lat1, lng1], [lat2, lng2]];
    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson&steps=false`;
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return fallback;
        const data = await res.json();
        if (!data.routes || data.routes.length === 0) return fallback;
        // GeoJSON coords are [lng, lat] — flip to [lat, lng] for Leaflet
        return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    } catch (e) {
        return fallback;
    }
}

// ── Barricading Page ─────────────────────────────────────
function renderBarricadingPage() {
    if (!DATA) return;
    
    // Calculate BSS for road closure events
    const events = DATA.road_closure_events.length > 0 ? DATA.road_closure_events : DATA.events.filter(e => e.requires_road_closure || e.priority === 'High').slice(0, 200);
    
    const tbody = document.getElementById('barricading-tbody');
    const bssDistribution = { 'Full Closure': 0, 'Partial Closure': 0, 'Warning Zone': 0, 'Monitor Only': 0 };
    const causeBSS = {};
    
    events.slice(0, 100).forEach(event => {
        const bss = calculateImpactScore({
            event_type: event.event_type,
            cause: event.cause,
            road_closure: event.requires_road_closure,
            priority: event.priority,
            corridor: event.corridor,
            hour: 10, // Default
            duration: 4,
        });
        
        const category = getBarricadeCategory(bss);
        bssDistribution[category.level]++;
        
        if (!causeBSS[event.cause]) causeBSS[event.cause] = { full: 0, partial: 0, warning: 0, monitor: 0 };
        if (category.level === 'Full Closure') causeBSS[event.cause].full++;
        else if (category.level === 'Partial Closure') causeBSS[event.cause].partial++;
        else if (category.level === 'Warning Zone') causeBSS[event.cause].warning++;
        else causeBSS[event.cause].monitor++;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">${event.id}</td>
            <td>${event.corridor}</td>
            <td>${event.cause.replace(/_/g, ' ')}</td>
            <td><strong style="color: ${bss >= 0.8 ? '#ef4444' : bss >= 0.6 ? '#f97316' : bss >= 0.4 ? '#eab308' : '#22c55e'}">${(bss * 100).toFixed(0)}%</strong></td>
            <td><span class="badge ${category.class}">${category.level}</span></td>
            <td style="font-size: 11px;">${category.type}</td>
            <td style="font-size: 11px; max-width: 200px; white-space: normal;">${category.equipment}</td>
        `;
        tbody.appendChild(row);
    });
    
    // BSS Distribution Chart
    const ctx1 = document.getElementById('bss-distribution-chart')?.getContext('2d');
    if (ctx1) {
        if (charts.bssDist) charts.bssDist.destroy();
        charts.bssDist = new Chart(ctx1, {
            type: 'doughnut',
            data: {
                labels: Object.keys(bssDistribution),
                datasets: [{
                    data: Object.values(bssDistribution),
                    backgroundColor: ['#ef4444', '#f97316', '#eab308', '#22c55e'],
                    borderColor: 'rgba(10, 14, 23, 0.8)',
                    borderWidth: 2,
                    hoverOffset: 8,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '50%',
                plugins: {
                    legend: { position: 'bottom', labels: { padding: 12, font: { size: 11 } } },
                }
            }
        });
    }
    
    // Barricade by Cause Chart
    const ctx2 = document.getElementById('barricade-cause-chart')?.getContext('2d');
    if (ctx2) {
        const causeLabels = Object.keys(causeBSS).slice(0, 8);
        if (charts.barricadeCause) charts.barricadeCause.destroy();
        charts.barricadeCause = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: causeLabels.map(c => c.replace(/_/g, ' ')),
                datasets: [
                    { label: 'Full Closure', data: causeLabels.map(c => causeBSS[c].full), backgroundColor: '#ef4444', borderRadius: 3 },
                    { label: 'Partial', data: causeLabels.map(c => causeBSS[c].partial), backgroundColor: '#f97316', borderRadius: 3 },
                    { label: 'Warning', data: causeLabels.map(c => causeBSS[c].warning), backgroundColor: '#eab308', borderRadius: 3 },
                    { label: 'Monitor', data: causeLabels.map(c => causeBSS[c].monitor), backgroundColor: '#22c55e', borderRadius: 3 },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { font: { size: 10 } } },
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
                    y: { stacked: true, grid: { color: 'rgba(71, 85, 105, 0.1)' }, beginAtZero: true }
                }
            }
        });
    }
}

// ── Manpower Page ────────────────────────────────────────
function renderManpowerPage() {
    if (!DATA) return;
    
    const grid = document.getElementById('manpower-zone-grid');
    const zoneColors = ['#6366f1', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#22c55e', '#eab308', '#f59e0b', '#f97316', '#ef4444'];
    
    // Zone-based deployment recommendations
    const zoneDeployment = DATA.zones.map((zone, idx) => {
        const baseOfficers = Math.round(zone.event_count / DATA.zones[0].event_count * 25);
        const closureEvents = DATA.road_closure_events.filter(e => e.zone === zone.name).length;
        const closureBonus = Math.round(closureEvents / 10);
        
        return {
            ...zone,
            recommended_officers: Math.max(baseOfficers + closureBonus, 6),
            closure_events: closureEvents,
            color: zoneColors[idx % zoneColors.length],
        };
    });
    
    grid.innerHTML = zoneDeployment.map(zone => `
        <div class="zone-card" style="border-left: 3px solid ${zone.color};">
            <h4>
                <span style="color: ${zone.color};">●</span>
                ${zone.name}
            </h4>
            <div class="zone-stats">
                <div class="zone-stat">
                    <div class="zone-stat-label">Total Events</div>
                    <div class="zone-stat-value">${zone.event_count}</div>
                </div>
                <div class="zone-stat">
                    <div class="zone-stat-label">Road Closures</div>
                    <div class="zone-stat-value">${zone.closure_events}</div>
                </div>
                <div class="zone-stat">
                    <div class="zone-stat-label">Officers Needed</div>
                    <div class="zone-stat-value" style="color: ${zone.color};">${zone.recommended_officers}</div>
                </div>
                <div class="zone-stat">
                    <div class="zone-stat-label">Priority</div>
                    <div class="zone-stat-value">${zone.recommended_officers >= 20 ? '🔴 High' : zone.recommended_officers >= 12 ? '🟡 Med' : '🟢 Low'}</div>
                </div>
            </div>
        </div>
    `).join('');
    
    // Zone chart
    const ctx1 = document.getElementById('manpower-zone-chart')?.getContext('2d');
    if (ctx1) {
        if (charts.manpowerZone) charts.manpowerZone.destroy();
        charts.manpowerZone = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: zoneDeployment.map(z => z.name.replace('Zone ', 'Z')),
                datasets: [{
                    label: 'Recommended Officers',
                    data: zoneDeployment.map(z => z.recommended_officers),
                    backgroundColor: zoneDeployment.map(z => z.color + '99'),
                    borderColor: zoneDeployment.map(z => z.color),
                    borderWidth: 1,
                    borderRadius: 4,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                    y: { grid: { color: 'rgba(71, 85, 105, 0.1)' }, beginAtZero: true }
                }
            }
        });
    }
    
    // Event type manpower chart
    const ctx2 = document.getElementById('manpower-event-chart')?.getContext('2d');
    if (ctx2) {
        const eventTypes = [
            { cause: 'public_event', label: 'Public Event', base: 8 },
            { cause: 'protest', label: 'Protest', base: 12 },
            { cause: 'procession', label: 'Procession', base: 10 },
            { cause: 'vip_movement', label: 'VIP Movement', base: 6 },
            { cause: 'construction', label: 'Construction', base: 4 },
            { cause: 'accident', label: 'Accident', base: 3 },
            { cause: 'vehicle_breakdown', label: 'Breakdown', base: 2 },
        ];
        
        if (charts.manpowerEvent) charts.manpowerEvent.destroy();
        charts.manpowerEvent = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: eventTypes.map(e => e.label),
                datasets: [{
                    label: 'Base Officers',
                    data: eventTypes.map(e => e.base),
                    backgroundColor: CHART_COLORS.slice(0, eventTypes.length).map(c => c + '99'),
                    borderColor: CHART_COLORS.slice(0, eventTypes.length),
                    borderWidth: 1,
                    borderRadius: 4,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { color: 'rgba(71, 85, 105, 0.1)' }, beginAtZero: true },
                    y: { grid: { display: false }, ticks: { font: { size: 11 } } }
                }
            }
        });
    }
}

// ── Data Explorer ────────────────────────────────────────
function renderExplorerPage() {
    if (!DATA) return;
    filterAndRenderExplorer();
}

function filterAndRenderExplorer() {
    const corridorFilter = document.getElementById('explorer-corridor-filter').value;
    const causeFilter = document.getElementById('explorer-cause-filter').value;
    const typeFilter = document.getElementById('explorer-type-filter').value;
    const statusFilter = document.getElementById('explorer-status-filter').value;
    
    let filtered = DATA.events;
    if (corridorFilter !== 'all') filtered = filtered.filter(e => e.corridor === corridorFilter);
    if (causeFilter !== 'all') filtered = filtered.filter(e => e.cause === causeFilter);
    if (typeFilter !== 'all') filtered = filtered.filter(e => e.event_type === typeFilter);
    if (statusFilter !== 'all') filtered = filtered.filter(e => e.status === statusFilter);
    
    // Stats
    const statsDiv = document.getElementById('explorer-stats');
    statsDiv.innerHTML = `
        <div class="explorer-stat">Showing <strong>${filtered.length}</strong> of ${DATA.events.length} events</div>
        <div class="explorer-stat">Road closures: <strong>${filtered.filter(e => e.requires_road_closure).length}</strong></div>
        <div class="explorer-stat">High priority: <strong>${filtered.filter(e => e.priority === 'High').length}</strong></div>
        <div class="explorer-stat">Active: <strong>${filtered.filter(e => e.status === 'active').length}</strong></div>
    `;
    
    // Pagination
    const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
    if (explorerPage > totalPages) explorerPage = 1;
    
    const start = (explorerPage - 1) * ROWS_PER_PAGE;
    const pageData = filtered.slice(start, start + ROWS_PER_PAGE);
    
    const tbody = document.getElementById('explorer-tbody');
    tbody.innerHTML = pageData.map(e => `
        <tr>
            <td style="font-family: 'JetBrains Mono', monospace; font-size: 11px;">${e.id}</td>
            <td><span class="badge ${e.event_type === 'planned' ? 'badge-planned' : 'badge-unplanned'}">${e.event_type}</span></td>
            <td>${e.cause.replace(/_/g, ' ')}</td>
            <td>${e.corridor}</td>
            <td>${e.junction || '—'}</td>
            <td><span class="badge ${e.priority === 'High' ? 'badge-high' : 'badge-low'}">${e.priority}</span></td>
            <td>${e.requires_road_closure ? '🔴 Yes' : '🟢 No'}</td>
            <td>${e.status}</td>
            <td style="font-size: 11px;">${e.start_datetime ? e.start_datetime.slice(0, 16) : '—'}</td>
        </tr>
    `).join('');
    
    // Pagination buttons
    const pagDiv = document.getElementById('explorer-pagination');
    let pagHTML = '';
    const maxButtons = 10;
    let startPage = Math.max(1, explorerPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    
    if (explorerPage > 1) pagHTML += `<button onclick="goToExplorerPage(${explorerPage - 1})">← Prev</button>`;
    for (let p = startPage; p <= endPage; p++) {
        pagHTML += `<button class="${p === explorerPage ? 'active' : ''}" onclick="goToExplorerPage(${p})">${p}</button>`;
    }
    if (explorerPage < totalPages) pagHTML += `<button onclick="goToExplorerPage(${explorerPage + 1})">Next →</button>`;
    pagDiv.innerHTML = pagHTML;
}

function goToExplorerPage(page) {
    explorerPage = page;
    filterAndRenderExplorer();
}

// ── Event Listeners ──────────────────────────────────────
function setupEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            switchPage(page);
        });
    });
    
    // Menu toggle
    document.getElementById('menu-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('open');
    });
    
    // Impact form
    document.getElementById('impact-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const dt = new Date(document.getElementById('pred-datetime').value);
        
        renderPrediction({
            event_type: document.getElementById('pred-event-type').value,
            cause: document.getElementById('pred-cause').value,
            corridor: document.getElementById('pred-corridor').value,
            junction: document.getElementById('pred-junction').value,
            priority: document.getElementById('pred-priority').value,
            road_closure: document.getElementById('pred-road-closure').value === 'true',
            hour: dt.getHours(),
            duration: parseFloat(document.getElementById('pred-duration').value) || 4,
        });
    });
    
    // Simulate random event
    const simBtn = document.getElementById('btn-simulate') || document.getElementById('btn-simulate-event');
    if (simBtn) {
        simBtn.addEventListener('click', () => simulateEvent());
    }
    
    // Manpower calculator
    const mpForm = document.getElementById('manpower-calc-form');
    if (mpForm) {
        mpForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const cause = document.getElementById('mp-cause').value;
            const severity = parseInt(document.getElementById('mp-severity').value);
            const duration = parseFloat(document.getElementById('mp-duration').value);
            const roadClosure = document.getElementById('mp-road-closure').value === 'yes';
            
            const bss = severity / 10;
            const manpower = getManpowerNeeds({ cause, bss, duration, road_closure: roadClosure });
            
            document.getElementById('manpower-calc-result').innerHTML = `
                <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 16px;">
                    <h4 style="color: #10b981; margin-bottom: 12px;">👮 Deployment Recommendation</h4>
                    <p style="font-size: 13px; line-height: 1.6;">
                        <strong>Officers per shift:</strong> ${manpower.total_per_shift}<br>
                        <strong>Number of shifts:</strong> ${manpower.shifts}<br>
                        <strong>Total officers needed:</strong> ${manpower.total_per_shift * manpower.shifts}<br>
                        <br>
                        <strong>Breakdown:</strong><br>
                        ${Object.entries(manpower.breakdown).map(([k, v]) => `• ${k}: ${v} officers`).join('<br>')}
                    </p>
                </div>
            `;
        });
    }
    
    // Severity slider
    const mpSeverity = document.getElementById('mp-severity');
    if (mpSeverity) {
        mpSeverity.addEventListener('input', (e) => {
            document.getElementById('mp-severity-val').textContent = e.target.value;
        });
    }
    
    // Corridor change → update junctions
    document.getElementById('pred-corridor').addEventListener('change', () => {
        updateJunctionOptions('pred-corridor', 'pred-junction');
    });
    document.getElementById('div-corridor').addEventListener('change', () => {
        updateJunctionOptions('div-corridor', 'div-junction');
    });
    
    // Diversion finder
    const divFinder = document.getElementById('btn-find-diversion');
    if (divFinder) {
        divFinder.addEventListener('click', () => {
            const corridor = document.getElementById('div-corridor').value;
            const junction = document.getElementById('div-junction').value;
            findDiversions(corridor, junction);
        });
    }
    
    // Map filters
    document.getElementById('map-filter-cause').addEventListener('change', () => {
        const dt = new Date(document.getElementById('dashboard-date-filter')?.value || "2024-03-15T18:00");
        renderMapMarkers(
            document.getElementById('map-filter-cause').value,
            document.getElementById('map-filter-type').value,
            dt
        );
    });
    document.getElementById('map-filter-type').addEventListener('change', () => {
        const dt = new Date(document.getElementById('dashboard-date-filter')?.value || "2024-03-15T18:00");
        renderMapMarkers(
            document.getElementById('map-filter-cause').value,
            document.getElementById('map-filter-type').value,
            dt
        );
    });
    
    // Explorer filters
    ['explorer-corridor-filter', 'explorer-cause-filter', 'explorer-type-filter', 'explorer-status-filter'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            explorerPage = 1;
            filterAndRenderExplorer();
        });
    });
    
    // Set default datetime
    const now = new Date();
    document.getElementById('pred-datetime').value = now.toISOString().slice(0, 16);
    
    // Global search
    document.getElementById('global-search').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        if (query.length < 2) return;
        
        // Search corridors and junctions
        const matchingCorridor = DATA.corridors.find(c => c.name.toLowerCase().includes(query));
        if (matchingCorridor) {
            switchPage('explorer');
            document.getElementById('explorer-corridor-filter').value = matchingCorridor.name;
            filterAndRenderExplorer();
        }
    });
}

function switchPage(page) {
    currentPage = page;
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    
    // Update pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${page}`);
    });
    
    // Update title
    const titles = {
        dashboard: 'Dashboard Overview',
        impact: 'Impact Prediction Engine',
        diversion: 'Quickest Diversion Dictionary',
        barricading: 'Barricading Plan Generator',
        manpower: 'Manpower Allocation System',
        explorer: 'Historical Data Explorer',
        scale: 'Scale & Vision',
    };
    document.getElementById('page-title').textContent = titles[page] || 'Dashboard';
    
    // Lazy-initialize pages on first visit
    requestAnimationFrame(() => {
        if (page === 'dashboard' && dashboardMap) {
            dashboardMap.invalidateSize();
        }
        if (page === 'diversion') {
            initDiversionMap();
            setTimeout(() => { if (diversionMap) diversionMap.invalidateSize(); }, 150);
        }
        if (page === 'barricading' && !renderedPages.barricading) {
            renderedPages.barricading = true;
            renderBarricadingPage();
        }
        if (page === 'manpower' && !renderedPages.manpower) {
            renderedPages.manpower = true;
            renderManpowerPage();
        }
        if (page === 'explorer' && !renderedPages.explorer) {
            renderedPages.explorer = true;
            renderExplorerPage();
        }
        if (page === 'scale' && !renderedPages.scale) {
            renderedPages.scale = true;
            renderScalePage();
        }
    });
    
    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
}

function updateDateTime() {
    const now = new Date("2024-03-15T18:00");
    const input = document.getElementById('global-datetime');
    if (input && !input.value) {
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        input.value = now.toISOString().slice(0, 16);
    }
}

// ── Scale & Vision Page ──────────────────────────────────
function renderScalePage() {
    const container = document.getElementById('scale-content');
    if (!container || !DATA) return;
    
    const totalEvents = DATA.summary.total_events;
    const totalCorridors = DATA.corridors.filter(c => c.name !== 'Non-corridor').length;
    const totalJunctions = DATA.junctions.length;
    const totalZones = DATA.zones.length;
    
    // Projected at-scale stats (city-wide rollout)
    const projectedEvents = Math.round(totalEvents * 15);
    const projectedCorridors = Math.round(totalCorridors * 6);
    const projectedJunctions = Math.round(totalJunctions * 8);
    const projectedZones = Math.round(totalZones * 3.5);
    const avgResponseTimeReduction = 35; // %
    const estimatedCostSavings = projectedEvents * 1500; // Rs saved per managed event
    
    container.innerHTML = `
        <div style="max-width: 1000px; margin: 0 auto; padding-bottom: 40px;">
            <div style="text-align: center; margin-bottom: 32px;">
                <p style="color: var(--text-secondary); max-width: 700px; margin: 0 auto; line-height: 1.6;">
                    GridLock 2.0 is designed to scale from this ${totalEvents.toLocaleString()}-event proof of concept to a city-wide intelligence layer integrating real-time Astram data, CCTV feeds, and ML models.
                </p>
            </div>
            
            <!-- Scalability Metrics -->
            <div class="card" style="margin-bottom: 24px;">
                <h3 style="margin-bottom: 16px; font-size: 16px;">📈 Scalability Projection (Current vs At-Scale)</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
                    <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">Events Processed (Annual)</div>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <div style="font-size: 24px; font-weight: 700;">${projectedEvents.toLocaleString()}</div>
                            <div style="font-size: 12px; color: #22c55e;">From ${totalEvents.toLocaleString()}</div>
                        </div>
                    </div>
                    <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">Corridors Covered</div>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <div style="font-size: 24px; font-weight: 700;">${projectedCorridors}+</div>
                            <div style="font-size: 12px; color: #22c55e;">From ${totalCorridors}</div>
                        </div>
                    </div>
                    <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">Junctions Mapped</div>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <div style="font-size: 24px; font-weight: 700;">${projectedJunctions.toLocaleString()}+</div>
                            <div style="font-size: 12px; color: #22c55e;">From ${totalJunctions}</div>
                        </div>
                    </div>
                    <div style="background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">Traffic Zones Active</div>
                        <div style="display: flex; align-items: baseline; gap: 8px;">
                            <div style="font-size: 24px; font-weight: 700;">${projectedZones}</div>
                            <div style="font-size: 12px; color: #22c55e;">From ${totalZones}</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Real-World Scenarios -->
            <div class="card" style="margin-bottom: 24px;">
                <h3 style="margin-bottom: 16px; font-size: 16px;">🌍 Real-World Event Scenarios</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
                    <div class="zone-card" style="border-left: 3px solid #ef4444;">
                        <h4><span style="color:#ef4444;">💥</span> Unplanned Accident on ORR</h4>
                        <p style="font-size:13px; color:var(--text-secondary); margin:8px 0;">4-vehicle pileup during Friday evening peak hours.</p>
                        <ul style="padding-left:16px; font-size:12px; color:var(--text-secondary);">
                            <li>Auto-alert via Astram within 2 mins</li>
                            <li>Immediate 3-route diversion broadcast</li>
                            <li>Nearest patrol auto-dispatch</li>
                            <li>VMS board update cascade</li>
                        </ul>
                    </div>
                    <div class="zone-card" style="border-left: 3px solid #a78bfa;">
                        <h4><span style="color:#a78bfa;">🏛️</span> VIP Movement</h4>
                        <p style="font-size:13px; color:var(--text-secondary); margin:8px 0;">PM convoy requiring corridor clearance.</p>
                        <ul style="padding-left:16px; font-size:12px; color:var(--text-secondary);">
                            <li>Synchronized signal control</li>
                            <li>Pre-positioned barricades at 8 junctions</li>
                            <li>Parallel corridor load balancing</li>
                        </ul>
                    </div>
                </div>
            </div>

            <!-- Integration Roadmap -->
            <div class="card" style="margin-bottom: 24px;">
                <h3 style="margin-bottom: 20px; font-size: 16px;">🗺️ Integration Roadmap</h3>
                <div style="position: relative; padding-left: 32px;">
                    <div style="position: absolute; left: 14px; top: 0; bottom: 0; width: 3px; background: linear-gradient(to bottom, #22c55e, #6366f1, #8b5cf6, #f59e0b); border-radius: 2px;"></div>
                    <br><br>
                    At full scale with <strong>real-time Astram API integration</strong>, the system can generate response plans in under 2 minutes — including barricade equipment lists, officer counts, shift schedules, and pre-computed diversion routes — for any event anywhere in the city. The diversion dictionary alone, with its O(1) lookup, eliminates the 15-20 minute manual route-planning that currently happens during emergencies.
                    <br><br>
                    The modular architecture means this isn't Bengaluru-specific — the same engine works for <strong>any Indian metro</strong> with structured incident data. Hyderabad, Chennai, Pune — the algorithms are city-agnostic; only the data changes.
                </p>
            </div>
        </div>
    `;
}

// ── Start ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp);
