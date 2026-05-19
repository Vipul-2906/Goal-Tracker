const API_BASE = "https://backend-46x0.onrender.com/api";
const user = (() => {
    try {
        return JSON.parse(localStorage.getItem("user")) || JSON.parse(sessionStorage.getItem("user"));
    } catch {
        return null;
    }
})();

const ANALYTICS_TIMEOUT = 30000;

function headers() {
    return user?.token ? { Authorization: `Bearer ${user.token}` } : {};
}

function guard() {
    if (!user || !["admin", "manager"].includes(user.role)) {
        window.location.href = "login.html";
        return false;
    }
    return true;
}

async function api(path) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: headers(),
        signal: AbortSignal.timeout(ANALYTICS_TIMEOUT)
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
        localStorage.removeItem("user");
        sessionStorage.removeItem("user");
        window.location.href = "login.html";
        throw new Error(data?.message || "Session expired");
    }
    if (!res.ok) throw new Error(data?.message || `Request failed: ${res.status}`);
    return data;
}

function chart(id, type, labels, data, label) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return null;
    return new Chart(el, {
        type,
        data: { labels, datasets: [{ label, data, borderWidth: 2, tension: 0.35 }] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: "bottom" } },
            scales: type === "bar" || type === "line" ? { y: { beginAtZero: true } } : undefined
        }
    });
}

function renderCards(stats, managers) {
    const totals = stats?.totals || {};
    const avgManagerRate = managers?.length
        ? Math.round(managers.reduce((sum, m) => sum + Number(m.completionRate || 0), 0) / managers.length)
        : 0;
    document.getElementById("analyticsCards").innerHTML = [
        ["Total Goals", totals.totalGoals || 0, "primary"],
        ["Approved Goals", totals.approvedGoals || 0, "success"],
        ["Total Updates", totals.updates || 0, "info"],
        ["Manager Completion", `${avgManagerRate}%`, "warning"]
    ].map(([title, value, color]) => `
        <div class="col-md-3 col-sm-6">
            <div class="card shadow-sm border-start border-4 border-${color}">
                <div class="card-body">
                    <small class="text-uppercase text-muted">${title}</small>
                    <h2 class="mt-2 mb-0">${value}</h2>
                </div>
            </div>
        </div>`).join("");
}

function renderHeatmap(rows) {
    const container = document.getElementById("heatmapBody");
    container.innerHTML = rows?.length
        ? rows.map((r) => `<tr><td>${sanitize(r.department)}</td><td>${sanitize(r.quarter)}</td><td>${r.updates}</td><td>${r.completed}</td><td>${r.managerCheckIns}</td><td><span class="badge bg-${r.completionRate >= 80 ? "success" : r.completionRate >= 40 ? "warning text-dark" : "danger"}">${r.completionRate}%</span></td></tr>`).join("")
        : `<tr><td colspan="6" class="text-center text-muted py-4">No heatmap data yet.</td></tr>`;
}

function renderEmptyChart(id, message) {
    const body = document.getElementById(id)?.closest(".card")?.querySelector(".card-body");
    if (!body || body.querySelector(".chart-empty-state")) return;
    body.insertAdjacentHTML("beforeend", `<div class="chart-empty-state text-center text-muted py-4">${sanitize(message)}</div>`);
}

function renderInsights({ heatmap = [], trends = [], managers = [], distribution = {} }) {
    const topDepartment = [...heatmap].sort((a, b) => Number(b.completionRate || 0) - Number(a.completionRate || 0))[0];
    const delayedQuarter = [...trends].sort((a, b) => Number(a.averageScore || 0) - Number(b.averageScore || 0))[0];
    const topManager = [...managers].sort((a, b) => Number(b.completionRate || 0) - Number(a.completionRate || 0))[0];
    const dominantStatus = [...(distribution.byStatus || [])].sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0];

    document.getElementById("insightSummary").innerHTML = `
        <div class="row g-3">
            <div class="col-md-3"><div class="fw-semibold">Highest completion department</div><div class="text-muted">${sanitize(topDepartment ? `${topDepartment.department} (${topDepartment.completionRate}%)` : "No data yet")}</div></div>
            <div class="col-md-3"><div class="fw-semibold">Most delayed quarter</div><div class="text-muted">${sanitize(delayedQuarter ? `${delayedQuarter.quarter} (${delayedQuarter.averageScore || 0}% avg)` : "No data yet")}</div></div>
            <div class="col-md-3"><div class="fw-semibold">Top performing manager</div><div class="text-muted">${sanitize(topManager ? `${topManager.managerName} (${topManager.completionRate}%)` : "No data yet")}</div></div>
            <div class="col-md-3"><div class="fw-semibold">Most common goal status</div><div class="text-muted">${sanitize(dominantStatus ? `${dominantStatus.label} (${dominantStatus.count})` : "No data yet")}</div></div>
        </div>`;
}

function sanitize(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function load() {
    try {
        const [trends, stats, distribution, managerEffectiveness, heatmap] = await Promise.all([
            api("/analytics/qoq-trends"),
            api("/analytics/completion-stats"),
            api("/analytics/distribution"),
            api("/analytics/manager-effectiveness"),
            api("/analytics/heatmap")
        ]);
        renderCards(stats, managerEffectiveness);
        if (trends?.length) {
            chart("qoqChart", "line", trends.map((x) => x.quarter), trends.map((x) => x.averageScore || 0), "Average score");
        } else {
            renderEmptyChart("qoqChart", "No trend data available yet.");
        }

        if (distribution?.byStatus?.length) {
            chart("statusChart", "doughnut", distribution.byStatus.map((x) => x.label), distribution.byStatus.map((x) => x.count), "Goals");
        } else {
            renderEmptyChart("statusChart", "No status distribution yet.");
        }
        if (distribution?.byThrustArea?.length) {
            chart("thrustChart", "bar", distribution.byThrustArea.map((x) => x.label), distribution.byThrustArea.map((x) => x.count), "Goals");
        } else {
            renderEmptyChart("thrustChart", "No thrust area data yet.");
        }
        if (distribution?.byUom?.length) {
            chart("uomChart", "doughnut", distribution.byUom.map((x) => x.label), distribution.byUom.map((x) => x.count), "Goals");
        } else {
            renderEmptyChart("uomChart", "No UoM distribution yet.");
        }

        renderHeatmap(heatmap);
        renderInsights({ heatmap, trends, managers: managerEffectiveness, distribution });
        if (window.AppUX) AppUX.toast("success", "Analytics loaded");
    } catch (error) {
        document.getElementById("analyticsAlert").innerHTML = `<div class="alert alert-danger">${sanitize(error.message)}</div>`;
    }
}

document.getElementById("logoutBtn")?.addEventListener("click", () => {
    localStorage.removeItem("user");
    sessionStorage.removeItem("user");
    window.location.href = "login.html";
});

guard();
load();
