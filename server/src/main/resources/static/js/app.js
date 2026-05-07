const API_BASE = "";
let speedHistory = [];
const MAX_CHART_POINTS = 50;

// navi

document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById(tab.dataset.tab).classList.add("active");
    });
});

// settings

async function loadSettings() {
    try {
        const res = await fetch(API_BASE + "/api/settings");
        if (!res.ok) throw new Error("Failed to load settings");
        const settings = await res.json();
        applySettingsToUI(settings);
    } catch (err) {
        console.error("Error loading settings:", err);
    }
}

// map settings
function applySettingsToUI(s) {
    const el = id => document.getElementById(id);
    if (el("speed-slider")) el("speed-slider").value = s.speed;
    if (el("speed-label")) el("speed-label").textContent = s.speed + "%";
    if (el("turn-slider")) el("turn-slider").value = s.turnAngle;
    if (el("turn-label")) el("turn-label").innerHTML = s.turnAngle + "&deg;";
    if (el("obstacle-distance")) el("obstacle-distance").value = s.obstacleDistance;
    if (el("obstacle-action")) el("obstacle-action").value = s.obstacleAction;
    if (el("line-action")) el("line-action").value = s.lineAction;
    if (el("track-toggle")) el("track-toggle").checked = s.trackFollowing;
    if (el("reverse-toggle")) el("reverse-toggle").checked = s.reverse || false;

    if (s.driving) {
        if (el("btn-start")) el("btn-start").classList.add("active-btn");
        if (el("btn-stop")) el("btn-stop").classList.remove("active-btn");
    } else {
        if (el("btn-stop")) el("btn-stop").classList.add("active-btn");
        if (el("btn-start")) el("btn-start").classList.remove("active-btn");
    }

    updateSettingsTable(s);
}

// send settings to the server
async function sendSettings(updates) {
    try {
        const res = await fetch(API_BASE + "/api/settings");
        const current = await res.json();
        const merged = { ...current, ...updates };

        const putRes = await fetch(API_BASE + "/api/settings", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(merged)
        });

        if (!putRes.ok) throw new Error("Failed to update settings");
        const saved = await putRes.json();
        applySettingsToUI(saved);
        showNotification("Settings updated");
    } catch (err) {
        console.error("Error updating settings:", err);
        showNotification("Error: " + err.message, true);
    }
}

// control

function setDriving(value) {
    sendSettings({ driving: value });
}

function updateSpeedLabel(val) {
    document.getElementById("speed-label").textContent = val + "%";
}

function applySpeed() {
    const speed = parseInt(document.getElementById("speed-slider").value);
    sendSettings({ speed: speed });
}

function toggleReverse(checked) {
    sendSettings({ reverse: checked });
}

function updateTurnLabel(val) {
    document.getElementById("turn-label").innerHTML = val + "&deg;";
}

function applyTurn() {
    const turnAngle = parseInt(document.getElementById("turn-slider").value);
    sendSettings({ turnAngle: turnAngle });
}

function resetTurn() {
    document.getElementById("turn-slider").value = 0;
    document.getElementById("turn-label").innerHTML = "0&deg;";
    sendSettings({ turnAngle: 0 });
}

function toggleTrackFollowing(checked) {
    sendSettings({ trackFollowing: checked });
}

function applyBehavior() {
    sendSettings({
        obstacleDistance: parseInt(document.getElementById("obstacle-distance").value),
        obstacleAction: document.getElementById("obstacle-action").value,
        lineAction: document.getElementById("line-action").value
    });
}

// Telemetry

async function refreshTelemetry() {
    try {
        const res = await fetch(API_BASE + "/api/telemetry/latest");
        if (res.status === 204) {
            updateConnectionStatus(false);
            return;
        }
        if (!res.ok) throw new Error("Failed to fetch telemetry");

        const t = await res.json();
        updateTelemetryDisplay(t);

        const telemetryTime = new Date(t.timestamp).getTime();
        const now = Date.now();
        const ageSeconds = (now - telemetryTime) / 1000;
        const isConnected = ageSeconds < 5;

        updateConnectionStatus(isConnected, isConnected ? t.status : null);

        if (isConnected) {
            speedHistory.push(t.currentSpeed);
            if (speedHistory.length > MAX_CHART_POINTS) {
                speedHistory.shift();
            }
            drawSpeedChart();
        }
    } catch (err) {
        updateConnectionStatus(false);
    }
}

function updateTelemetryDisplay(t) {
    document.getElementById("t-status").textContent = t.status || "--";
    document.getElementById("t-speed").textContent = t.currentSpeed + "%";
    document.getElementById("t-ultrasonic").textContent = t.ultrasonicDistance.toFixed(1);
    document.getElementById("t-color").textContent = t.colorSensorValue.toFixed(1);
    document.getElementById("t-online").textContent = t.onLine ? "YES" : "NO";
    document.getElementById("t-online").style.color = t.onLine ? "#27ae60" : "#e74c3c";
    document.getElementById("t-obstacle").textContent = t.obstacleDetected ? "YES" : "NO";
    document.getElementById("t-obstacle").style.color = t.obstacleDetected ? "#e74c3c" : "#27ae60";
    document.getElementById("t-left-motor").textContent = t.leftMotorTacho;
    document.getElementById("t-right-motor").textContent = t.rightMotorTacho;

    addLogEntry(t);
}

function addLogEntry(t) {
    const log = document.getElementById("telemetry-log");
    const empty = log.querySelector(".log-empty");
    if (empty) empty.remove();

    const entry = document.createElement("div");
    entry.className = "log-entry";
    const time = t.timestamp ? t.timestamp.replace("T", " ").substring(0, 19) : new Date().toISOString().substring(0, 19);
    entry.textContent = `[${time}] speed=${t.currentSpeed} dist=${t.ultrasonicDistance.toFixed(1)}cm color=${t.colorSensorValue.toFixed(1)} status=${t.status}`;

    log.insertBefore(entry, log.firstChild);

    while (log.children.length > 50) {
        log.removeChild(log.lastChild);
    }
}

function updateConnectionStatus(connected, status) {
    const indicator = document.getElementById("connection-status");
    const text = document.getElementById("status-text");
    if (connected) {
        indicator.className = "status-indicator connected";
        text.textContent = "Robot: " + (status || "Connected");
    } else {
        indicator.className = "status-indicator disconnected";
        text.textContent = "Waiting for robot...";
    }
}

// speed chart

function drawSpeedChart() {
    const canvas = document.getElementById("speed-chart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    if (speedHistory.length < 2) return;

    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    ctx.fillStyle = "#999";
    ctx.font = "11px sans-serif";
    ctx.fillText("100%", 2, 12);
    ctx.fillText("50%", 2, h / 2 + 4);
    ctx.fillText("0%", 2, h - 2);

    ctx.strokeStyle = "#3498db";
    ctx.lineWidth = 2;
    ctx.beginPath();

    const step = w / (MAX_CHART_POINTS - 1);
    for (let i = 0; i < speedHistory.length; i++) {
        const x = i * step;
        const y = h - (speedHistory[i] / 100) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

// stat

async function refreshStatistics() {
    try {
        const res = await fetch(API_BASE + "/api/telemetry/statistics");
        if (!res.ok) throw new Error("Failed to fetch statistics");
        const stats = await res.json();

        document.getElementById("s-avg-speed").textContent = stats.averageSpeed || 0;
        document.getElementById("s-total-readings").textContent = stats.totalReadings || 0;
        document.getElementById("s-obstacles").textContent = stats.obstacleDetections || 0;
        document.getElementById("s-online-pct").textContent = (stats.onLinePercentage || 0) + "%";
        document.getElementById("s-offline-pct").textContent = (stats.offLinePercentage || 0) + "%";
        document.getElementById("s-line-readings").textContent = stats.onLineReadings || 0;
    } catch (err) {
        console.error("Error loading statistics:", err);
    }
}

function updateSettingsTable(s) {
    const tbody = document.getElementById("settings-body");
    tbody.innerHTML = "";
    const rows = [
        ["Speed", s.speed + "%"],
        ["Turn Angle", s.turnAngle + "\u00B0"],
        ["Driving", s.driving ? "Yes" : "No"],
        ["Reverse", s.reverse ? "Yes" : "No"],
        ["Track Following", s.trackFollowing ? "Enabled" : "Disabled"],
        ["Obstacle Action", s.obstacleAction],
        ["Obstacle Distance", s.obstacleDistance + " cm"],
        ["Line Action", s.lineAction],
        ["Last Updated", s.updatedAt ? s.updatedAt.replace("T", " ").substring(0, 19) : "--"]
    ];
    rows.forEach(([param, val]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${param}</td><td><strong>${val}</strong></td>`;
        tbody.appendChild(tr);
    });
}

// notify

function showNotification(msg, isError) {
    const existing = document.querySelector(".notification");
    if (existing) existing.remove();

    const div = document.createElement("div");
    div.className = "notification";
    div.style.cssText = `
        position: fixed; bottom: 1.5rem; right: 1.5rem;
        background: ${isError ? "#e74c3c" : "#27ae60"}; color: white;
        padding: 0.7rem 1.2rem; border-radius: 6px;
        font-size: 0.9rem; font-weight: 500;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        z-index: 1000; transition: opacity 0.3s;
    `;
    div.textContent = msg;
    document.body.appendChild(div);

    setTimeout(() => {
        div.style.opacity = "0";
        setTimeout(() => div.remove(), 300);
    }, 2000);
}

loadSettings();
setInterval(refreshTelemetry, 2000);
setInterval(refreshStatistics, 5000);
refreshStatistics();
