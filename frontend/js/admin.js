const API_BASE = "http://localhost:5000/api";
const DEFAULT_API_TIMEOUT = 30000;
const user = (() => {
    try {
        return JSON.parse(localStorage.getItem("user")) || JSON.parse(sessionStorage.getItem("user"));
    } catch (error) {
        return null;
    }
})();

function handleUnauthorized() {
    localStorage.removeItem("user");
    sessionStorage.removeItem("user");
    showAlert("danger", "Session expired. Please sign in again.", 0);
    setTimeout(() => window.location.href = "login.html", 800);
}

async function parseJsonResponse(response) {
    const data = await response.json().catch(() => null);
    if (response.status === 401) {
        handleUnauthorized();
        throw new Error(data?.message || "Session expired");
    }
    if (!response.ok) {
        throw new Error(data?.message || `Request failed: ${response.status}`);
    }
    return data;
}

const state = {
    goals: [],
    achievementReport: [],
    auditLogs: [],
    completionDashboard: null,
    users: [],
    cycles: [],
    sharedGoals: [],
    escalations: [],
    sharedAssignments: new Map(),
    currentPage: 1,
    rowsPerPage: 8,
    showAllCheckinCompletion: false,
    showAllAuditTimeline: false,
    showAllEscalations: false,
    activeUnlockEmployee: null,
    activeSharedGoalId: null,
    activeOwnerGoalId: null,
    charts: {},
};

const dom = {
    adminWelcome: document.getElementById("adminWelcome"),
    adminAlert: document.getElementById("adminAlert"),
    totalGoals: document.getElementById("totalGoals"),
    completedUpdates: document.getElementById("completedUpdates"),
    onTrackUpdates: document.getElementById("onTrackUpdates"),
    notStartedUpdates: document.getElementById("notStartedUpdates"),
    totalEmployees: document.getElementById("totalEmployees"),
    totalManagers: document.getElementById("totalManagers"),
    achievementReportBody: document.getElementById("achievementReportBody"),
    reportSearch: document.getElementById("reportSearch"),
    exportCsvBtn: document.getElementById("exportCsvBtn"),
    reportRowCount: document.getElementById("reportRowCount"),
    prevPageBtn: document.getElementById("prevPageBtn"),
    nextPageBtn: document.getElementById("nextPageBtn"),
    managerEffectivenessBody: document.getElementById("managerEffectivenessBody"),
    auditTimeline: document.getElementById("auditTimeline"),
    unlockGoalsBody: document.getElementById("unlockGoalsBody"),
    cycleTableBody: document.getElementById("cycleTableBody"),
    checkinCompletionBody: document.getElementById("checkinCompletionBody"),
    loadMoreCheckinBtn: document.getElementById("loadMoreCheckinBtn"),
    loadMoreAuditBtn: document.getElementById("loadMoreAuditBtn"),
    loadMoreEscalationBtn: document.getElementById("loadMoreEscalationBtn"),
    adminSharedGoalsTable: document.getElementById("adminSharedGoalsTable"),
    adminSharedGoalAlert: document.getElementById("adminSharedGoalAlert"),
    escalationsTableBody: document.getElementById("escalationsTableBody"),
    unlockModal: document.getElementById("unlockModal"),
    unlockModalText: document.getElementById("unlockModalText"),
    unlockModalAlert: document.getElementById("unlockModalAlert"),
    confirmUnlockBtn: document.getElementById("confirmUnlockBtn"),
    statusDoughnutChart: document.getElementById("statusDoughnutChart"),
    thrustAreaBarChart: document.getElementById("thrustAreaBarChart"),
    goalStatusPieChart: document.getElementById("goalStatusPieChart"),
    completionLineChart: document.getElementById("completionLineChart"),
};

const unlockModalInstance = new bootstrap.Modal(dom.unlockModal, { keyboard: false });

function protectRoute() {
    if (!user || user.role !== "admin") {
        window.location.href = "login.html";
    }
}

function setUserBanner() {
    const name = user?.name || user?.fullName || "Administrator";
    dom.adminWelcome.textContent = `Welcome, ${name}`;
}

function showAlert(type, message, timeout = 6000) {
    if (window.AppUX) AppUX.toast(type === "danger" ? "error" : type, message);
    dom.adminAlert.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${sanitize(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;
    if (timeout) {
        setTimeout(() => {
            dom.adminAlert.innerHTML = "";
        }, timeout);
    }
}

function sanitize(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatBadge(status) {
    const normalized = String(status || "").toLowerCase();
    const badgeClass = {
        approved: "success",
        returned: "danger",
        submitted: "warning",
        draft: "secondary",
    }[normalized] || "dark";
    return `<span class="badge bg-${badgeClass} badge-status">${sanitize(normalized)}</span>`;
}

function getAuthHeaders(hasBody = false) {
    const headers = {};
    if (hasBody) headers["Content-Type"] = "application/json";
    if (user?.token) headers["Authorization"] = `Bearer ${user.token}`;
    return headers;
}

async function fetchJson(endpoint) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: getAuthHeaders(false),
        signal: AbortSignal.timeout(DEFAULT_API_TIMEOUT)
    });
    return parseJsonResponse(response);
}

async function fetchGoals() {
    state.goals = await fetchJson("/goals");
}

async function fetchCompletionDashboard() {
    state.completionDashboard = await fetchJson("/reports/completion-dashboard");
}

async function fetchAchievementReport() {
    state.achievementReport = await fetchJson("/reports/achievement");
}

async function fetchAuditLogs() {
    state.auditLogs = await fetchJson("/audit");
}

async function fetchEscalations() {
    state.escalations = await fetchJson("/escalations?resolved=false");
}

async function fetchUsers() {
    state.users = await fetchJson("/auth/admin/users");
}

async function fetchCycles() {
    state.cycles = await fetchJson("/cycles");
}

async function fetchSharedGoals() {
    state.sharedGoals = await fetchJson("/shared-goals");
    state.sharedAssignments = new Map();
    await Promise.all(state.sharedGoals.map(async (sharedGoal) => {
        const assignments = await fetchJson(`/shared-goals/${sharedGoal._id}/assignments`).catch(() => []);
        state.sharedAssignments.set(sharedGoal._id, assignments);
    }));
}

function getUniqueManagers(goals) {
    const managerMap = new Map();
    goals.forEach((goal) => {
        const manager = goal.employeeId?.managerId;
        const managerName = manager?.name || manager?.fullName || manager || "Unassigned";
        const managerId = manager?._id || manager || "unassigned";
        if (!managerMap.has(managerId)) {
            managerMap.set(managerId, { managerName, goals: [] });
        }
        managerMap.get(managerId).goals.push(goal);
    });
    return Array.from(managerMap.values());
}

function aggregateEmployeeStats(goals) {
    const employees = new Map();
    goals.forEach((goal) => {
        const employeeId = goal.employeeId?._id || goal.employeeId || "unknown";
        const employeeName = goal.employeeId?.name || goal.employeeId?.fullName || goal.employeeId?.email || "Unknown";
        if (!employees.has(employeeId)) {
            employees.set(employeeId, { employeeName, goals: [], approvedCount: 0 });
        }
        const record = employees.get(employeeId);
        record.goals.push(goal);
        if (goal.status === "approved") record.approvedCount += 1;
    });
    return Array.from(employees.values());
}

function computeSummaryCards() {
    const totalGoals = state.goals.length;
    const totalEmployees = state.users.filter((record) => record.role === "employee" && record.isActive).length ||
        new Set(state.goals.map((goal) => goal.employeeId?._id || goal.employeeId)).size;
    const managerRecords = getUniqueManagers(state.goals);
    dom.totalGoals.textContent = totalGoals;
    dom.totalEmployees.textContent = totalEmployees;
    dom.totalManagers.textContent = state.users.filter((record) => record.role === "manager" && record.isActive).length || managerRecords.length;
    if (state.completionDashboard) {
        dom.completedUpdates.textContent = state.completionDashboard.completedUpdates ?? 0;
        dom.onTrackUpdates.textContent = state.completionDashboard.onTrackUpdates ?? 0;
        dom.notStartedUpdates.textContent = state.completionDashboard.notStartedUpdates ?? 0;
    }
}

function buildCharts() {
    const statusData = [
        state.completionDashboard?.completedUpdates ?? 0,
        state.completionDashboard?.onTrackUpdates ?? 0,
        state.completionDashboard?.notStartedUpdates ?? 0,
    ];
    const goalStatusCounts = state.goals.reduce((acc, goal) => {
        const status = goal.status || "draft";
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});
    const thrustCounts = state.goals.reduce((acc, goal) => {
        const thrust = goal.thrustArea || "Unknown";
        acc[thrust] = (acc[thrust] || 0) + 1;
        return acc;
    }, {});
    const trendCounts = state.achievementReport.reduce((acc, record) => {
        const quarter = record.quarter || "Q0";
        acc[quarter] = (acc[quarter] || 0) + 1;
        return acc;
    }, {});
    const quarters = ["Q1", "Q2", "Q3", "Q4"];
    const lineLabels = quarters;
    const lineData = quarters.map((quarter) => trendCounts[quarter] || 0);

    if (state.charts.statusDoughnut) state.charts.statusDoughnut.destroy();
    if (state.charts.goalStatusPie) state.charts.goalStatusPie.destroy();
    if (state.charts.thrustAreaBar) state.charts.thrustAreaBar.destroy();
    if (state.charts.completionLine) state.charts.completionLine.destroy();

    state.charts.statusDoughnut = new Chart(dom.statusDoughnutChart, {
        type: "doughnut",
        data: {
            labels: ["Completed", "On Track", "Not Started"],
            datasets: [{
                data: statusData,
                backgroundColor: ["#198754", "#0d6efd", "#6c757d"],
                borderWidth: 0,
            }],
        },
        options: {
            plugins: { legend: { position: "bottom" } },
        },
    });

    state.charts.goalStatusPie = new Chart(dom.goalStatusPieChart, {
        type: "pie",
        data: {
            labels: Object.keys(goalStatusCounts),
            datasets: [{
                data: Object.values(goalStatusCounts),
                backgroundColor: ["#198754", "#ffc107", "#dc3545", "#6c757d"],
                borderWidth: 0,
            }],
        },
        options: {
            plugins: { legend: { position: "bottom" } },
        },
    });

    state.charts.thrustAreaBar = new Chart(dom.thrustAreaBarChart, {
        type: "bar",
        data: {
            labels: Object.keys(thrustCounts),
            datasets: [{
                label: "Goals",
                data: Object.values(thrustCounts),
                backgroundColor: "#0d6efd",
            }],
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } },
        },
    });

    state.charts.completionLine = new Chart(dom.completionLineChart, {
        type: "line",
        data: {
            labels: lineLabels,
            datasets: [{
                label: "Updates Completed",
                data: lineData,
                borderColor: "#198754",
                backgroundColor: "rgba(25, 135, 84, 0.2)",
                tension: 0.35,
                fill: true,
            }],
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } },
        },
    });
}

function renderAchievementReport() {
    const query = dom.reportSearch.value.trim().toLowerCase();
    const filtered = state.achievementReport.filter((row) => {
        if (!row) return false;
        const employeeName = row.employee?.name || row.employee || "";
        const goalTitle = row.goalTitle || row.goal || "";
        const quarter = row.quarter || "";
        const managerComment = row.managerComment || "";
        return [employeeName, goalTitle, quarter, managerComment].some((value) => value.toLowerCase().includes(query));
    });
    const start = (state.currentPage - 1) * state.rowsPerPage;
    const pageData = filtered.slice(start, start + state.rowsPerPage);
    dom.achievementReportBody.innerHTML = pageData.length
        ? pageData.map((row) => `
                <tr>
                    <td>${sanitize(row.employee?.name || row.employee || "Unknown")}</td>
                    <td>${sanitize(row.goalTitle || row.goal || "N/A")}</td>
                    <td>${sanitize(row.quarter || "N/A")}</td>
                    <td>${sanitize(row.plannedTarget ?? "—")}</td>
                    <td>${sanitize(row.actualAchievement ?? "—")}</td>
                    <td>${sanitize(row.progressScore != null ? `${Number(row.progressScore).toFixed(1)}%` : "—")}</td>
                    <td>${formatBadge(row.progressStatus || row.status || "not started")}</td>
                    <td>${sanitize(row.managerComment || "—")}</td>
                </tr>
            `).join("")
        : (window.AppUX
            ? AppUX.tableEmpty(8, "No achievement records found", "Try a different search or wait for employees to log quarterly progress.", "bi-graph-up")
            : `<tr><td colspan="8" class="text-center py-5 text-muted">No achievement records found.</td></tr>`);
    dom.reportRowCount.textContent = `Showing ${pageData.length} of ${filtered.length} records`;
}

function renderManagerEffectiveness() {
    if (state.completionDashboard?.managerSummary?.length) {
        dom.managerEffectivenessBody.innerHTML = state.completionDashboard.managerSummary.map((record) => `
            <tr>
                <td>${sanitize(record.managerName)}</td>
                <td>${record.totalCheckIns}</td>
                <td>${record.completedCheckIns}</td>
                <td>${record.totalCheckIns - record.completedCheckIns}</td>
                <td>${record.completionRate}%</td>
            </tr>
        `).join("");
        return;
    }

    const managerGroups = getUniqueManagers(state.goals);
    dom.managerEffectivenessBody.innerHTML = managerGroups.length
        ? managerGroups.map((group) => {
                const approved = group.goals.filter((goal) => goal.status === "approved").length;
                const returned = group.goals.filter((goal) => goal.status === "returned").length;
                const total = group.goals.length;
                const completion = total ? Math.round((approved / total) * 100) : 0;
                return `
                    <tr>
                        <td>${sanitize(group.managerName)}</td>
                        <td>${total}</td>
                        <td>${approved}</td>
                        <td>${returned}</td>
                        <td>${completion}%</td>
                    </tr>
                `;
          }).join("")
        : (window.AppUX
            ? AppUX.tableEmpty(5, "No manager performance yet", "Manager check-in completion will appear here after teams start updating goals.", "bi-speedometer2")
            : `<tr><td colspan="5" class="text-center py-4 text-muted">No manager performance data available.</td></tr>`);
}

function renderAuditTimeline() {
    const logs = state.auditLogs || [];
    const visibleLogs = state.showAllAuditTimeline ? logs : logs.slice(0, 4);
    dom.auditTimeline.innerHTML = logs.length
        ? visibleLogs.map((log) => `
                <div class="timeline-entry">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="fw-semibold">${sanitize(log.userId?.name || log.user?.name || log.user || "System")}</span>
                        <span class="text-muted small">${new Date(log.createdAt || log.timestamp || log.date || Date.now()).toLocaleString()}</span>
                    </div>
                    <div class="mb-1"><span class="badge bg-secondary me-2">${sanitize(log.action)}</span><span class="badge bg-dark">${sanitize(log.entityType)}</span></div>
                    <div class="small text-muted">Old: ${sanitize(JSON.stringify(log.oldValue || "-"))}</div>
                    <div class="small text-muted">New: ${sanitize(JSON.stringify(log.newValue || "-"))}</div>
                </div>
            `).join("")
        : (window.AppUX
            ? AppUX.emptyState("No audit logs yet", "Tracked changes and governance actions will appear here.", "bi-shield-check")
            : `<div class="text-center py-5 text-muted">No audit logs available.</div>`);

    if (dom.loadMoreAuditBtn) {
        if (logs.length <= 4) {
            dom.loadMoreAuditBtn.classList.add("d-none");
        } else {
            dom.loadMoreAuditBtn.classList.remove("d-none");
            dom.loadMoreAuditBtn.textContent = state.showAllAuditTimeline
                ? `Show less`
                : `Load more... (${logs.length - 4} more)`;
        }
    }
}


function renderEscalations() {
    if (!dom.escalationsTableBody) return;
    const rows = state.escalations || [];
    const visibleRows = state.showAllEscalations ? rows : rows.slice(0, 4);
    dom.escalationsTableBody.innerHTML = visibleRows.length
        ? visibleRows.map((item) => `
            <tr>
                <td>
                    <div class="fw-semibold">${sanitize(item.employee?.name || "Unknown")}</div>
                    <div class="small text-muted">${sanitize(item.employee?.email || "")}</div>
                </td>
                <td>${sanitize(item.manager?.name || "Unassigned")}</td>
                <td><span class="badge bg-warning text-dark">${sanitize(String(item.type || "").replace(/_/g, " "))}</span></td>
                <td>${sanitize(item.message)}</td>
                <td><span class="badge bg-${item.resolved ? "success" : "danger"}">${item.resolved ? "Resolved" : "Open"}</span></td>
                <td>${item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "-"}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-success escalation-resolve-btn" data-id="${item._id}" ${item.resolved ? "disabled" : ""}>Resolve</button>
                </td>
            </tr>
        `).join("")
        : (window.AppUX
            ? AppUX.tableEmpty(7, "No open escalations", "Overdue items will appear here after scheduled checks run.", "bi-check2-circle")
            : `<tr><td colspan="7" class="text-center text-muted py-4">No open escalations.</td></tr>`);

    if (dom.loadMoreEscalationBtn) {
        if (rows.length <= 4) {
            dom.loadMoreEscalationBtn.classList.add("d-none");
        } else {
            dom.loadMoreEscalationBtn.classList.remove("d-none");
            dom.loadMoreEscalationBtn.textContent = state.showAllEscalations
                ? `Show less`
                : `Load more... (${rows.length - 4} more)`;
        }
    }
}

async function runEscalationChecks() {
    if (state.escalationCheckInProgress) return;
    const button = document.getElementById("runEscalationChecksBtn");
    try {
        state.escalationCheckInProgress = true;
        if (window.AppUX) AppUX.setButtonLoading(button, true, "Checking");
        const response = await fetch(`${API_BASE}/escalations/run-checks`, {
            method: "POST",
            headers: getAuthHeaders(false),
            signal: AbortSignal.timeout(DEFAULT_API_TIMEOUT)
        });
        const data = await parseJsonResponse(response);
        await fetchEscalations();
        renderEscalations();
        showAlert("success", `${data.message}. New escalations: ${data.created || 0}`);
    } catch (error) {
        showAlert("danger", error.message, 0);
    } finally {
        state.escalationCheckInProgress = false;
        if (window.AppUX) AppUX.setButtonLoading(button, false);
    }
}

async function resolveEscalation(escalationId) {
    if (state.resolvingEscalationId === escalationId) return;
    const confirmed = window.AppUX
        ? await AppUX.confirm({
            title: "Resolve escalation?",
            message: "This will mark the escalation as resolved for admin tracking.",
            confirmText: "Resolve"
        })
        : confirm("Resolve this escalation?");
    if (!confirmed) return;

    try {
        state.resolvingEscalationId = escalationId;
        const response = await fetch(`${API_BASE}/escalations/${escalationId}/resolve`, {
            method: "PUT",
            headers: getAuthHeaders(true),
            body: JSON.stringify({ note: "Resolved from admin dashboard" }),
            signal: AbortSignal.timeout(DEFAULT_API_TIMEOUT)
        });
        await parseJsonResponse(response);
        await fetchEscalations();
        renderEscalations();
        showAlert("success", "Escalation resolved.");
    } catch (error) {
        showAlert("danger", error.message, 0);
    } finally {
        state.resolvingEscalationId = null;
    }
}

function renderUnlockGoals() {
    const unlockedGroups = new Map();
    state.goals
        .filter((goal) => goal.status === "approved")
        .forEach((goal) => {
            const employeeId = goal.employeeId?._id || goal.employeeId || "unknown";
            const employeeName = goal.employeeId?.name || goal.employeeId?.fullName || goal.employeeId?.email || "Unknown";
            const managerName = goal.employeeId?.managerId?.name || goal.employeeId?.managerId?.fullName || "Unassigned";
            if (!unlockedGroups.has(employeeId)) {
                unlockedGroups.set(employeeId, { employeeId, employeeName, managerName, count: 0, lastUpdated: goal.updatedAt || goal.createdAt || "N/A" });
            }
            unlockedGroups.get(employeeId).count += 1;
        });
    const rows = Array.from(unlockedGroups.values());
    dom.unlockGoalsBody.innerHTML = rows.length
        ? rows.map((record) => `
                <tr>
                    <td>${sanitize(record.employeeName)}</td>
                    <td>${sanitize(record.managerName)}</td>
                    <td>${record.count}</td>
                    <td>${sanitize(new Date(record.lastUpdated).toLocaleDateString())}</td>
                    <td class="text-end"><button class="btn btn-sm btn-outline-danger" onclick="prepareUnlock('${sanitizeAttribute(record.employeeId)}', '${sanitizeAttribute(record.employeeName)}')">Unlock</button></td>
                </tr>
            `).join("")
        : (window.AppUX
            ? AppUX.tableEmpty(5, "Nothing to unlock", "Approved goal sheets will appear here when admin intervention is available.", "bi-lock")
            : `<tr><td colspan="5" class="text-center py-4 text-muted">No approved goal sheets ready for unlock.</td></tr>`);
}

function renderCycleTable() {
    if (!dom.cycleTableBody) return;
    dom.cycleTableBody.innerHTML = state.cycles.length
        ? state.cycles.map((cycle) => `
            <tr>
                <td>
                    <div class="fw-semibold">${sanitize(cycle.label)}</div>
                    <div class="small text-muted">${sanitize(cycle.key)}</div>
                </td>
                <td><input class="form-control form-control-sm cycle-action-input" data-key="${sanitizeAttribute(cycle.key)}" value="${sanitizeAttribute(cycle.action)}"></td>
                <td><input class="form-control form-control-sm cycle-months-input" data-key="${sanitizeAttribute(cycle.key)}" value="${sanitizeAttribute((cycle.openMonths || []).join(","))}"></td>
                <td class="text-end"><button class="btn btn-sm btn-outline-primary cycle-save-btn" data-key="${sanitizeAttribute(cycle.key)}">Save</button></td>
            </tr>
        `).join("")
        : (window.AppUX
            ? AppUX.tableEmpty(4, "No cycle windows configured", "Configure goal-setting and quarterly check-in windows.", "bi-calendar3")
            : `<tr><td colspan="4" class="text-center text-muted py-4">No cycle windows configured.</td></tr>`);
}

function renderCheckinCompletion() {
    const rows = state.completionDashboard?.employeeQuarterStatus || [];
    if (!dom.checkinCompletionBody) return;
    const visibleRows = state.showAllCheckinCompletion ? rows : rows.slice(0, 4);
    dom.checkinCompletionBody.innerHTML = visibleRows.length
        ? visibleRows.map((record) => `
            <tr>
                <td>${sanitize(record.employeeName)}</td>
                <td>${sanitize(record.managerName)}</td>
                <td>${sanitize(record.quarter)}</td>
                <td>${record.approvedGoalCount}</td>
                <td>${record.employeeUpdated ? "<span class='badge bg-success'>Complete</span>" : `<span class='badge bg-secondary'>${record.updateCount} logged</span>`}</td>
                <td>${record.managerCheckInCompleted ? "<span class='badge bg-success'>Complete</span>" : "<span class='badge bg-warning text-dark'>Pending</span>"}</td>
            </tr>
        `).join("")
        : (window.AppUX
            ? AppUX.tableEmpty(6, "No active employees", "Create employees and assign managers to track check-in completion.", "bi-person-plus")
            : `<tr><td colspan="6" class="text-center text-muted py-4">No active employees found.</td></tr>`);

    if (dom.loadMoreCheckinBtn) {
        if (rows.length <= 4) {
            dom.loadMoreCheckinBtn.classList.add("d-none");
        } else {
            dom.loadMoreCheckinBtn.classList.remove("d-none");
            dom.loadMoreCheckinBtn.textContent = state.showAllCheckinCompletion
                ? `Show less`
                : `Load more... (${rows.length - 4} more)`;
        }
    }
}

function populateSharedOwnerSelect() {
    const select = document.getElementById("adminSharedOwner");
    if (!select) return;
    const owners = state.users.filter((record) => record.isActive && ["manager", "admin"].includes(record.role));
    select.innerHTML = owners.map((owner) => `<option value="${sanitizeAttribute(owner._id)}">${sanitize(owner.name)} (${sanitize(owner.role)})</option>`).join("");
}

function renderAdminSharedGoals() {
    if (!dom.adminSharedGoalsTable) return;
    dom.adminSharedGoalsTable.innerHTML = state.sharedGoals.length
        ? state.sharedGoals.map((sharedGoal) => {
            const assignments = state.sharedAssignments.get(sharedGoal._id) || [];
            const ownerName = sharedGoal.primaryOwnerId?.name || sharedGoal.primaryOwnerId?.email || "Owner";
            return `
                <tr>
                    <td>
                        <div class="fw-semibold">${sanitize(sharedGoal.title)}</div>
                        <div class="small text-muted">${sanitize(sharedGoal.thrustArea || "")}</div>
                    </td>
                    <td>${sanitize(ownerName)}</td>
                    <td>${sharedGoal.target ?? "—"}</td>
                    <td>${assignments.length}</td>
                    <td class="text-end">
                        <button class="btn btn-sm btn-outline-primary admin-shared-action-btn" data-action="assign" data-shared-id="${sanitizeAttribute(sharedGoal._id)}">Assign</button>
                        <button class="btn btn-sm btn-outline-success admin-shared-action-btn" data-action="owner-update" data-shared-id="${sanitizeAttribute(sharedGoal._id)}">Owner Update</button>
                    </td>
                </tr>
            `;
        }).join("")
        : (window.AppUX
            ? AppUX.tableEmpty(5, "No shared KPIs yet", "Create a departmental KPI and assign it to employees.", "bi-diagram-3")
            : `<tr><td colspan="5" class="text-center text-muted py-3">No shared KPIs yet.</td></tr>`);
}

function showAdminSharedAlert(type, message) {
    if (!dom.adminSharedGoalAlert) return;
    if (window.AppUX) AppUX.toast(type === "danger" ? "error" : type, message);
    dom.adminSharedGoalAlert.innerHTML = `<div class="alert alert-${type} py-2">${sanitize(message)}</div>`;
    setTimeout(() => {
        dom.adminSharedGoalAlert.innerHTML = "";
    }, 5000);
}

function syncAdminSharedGoalControls() {
    const uom = document.getElementById("adminSharedUom")?.value;
    const scoreType = document.getElementById("adminSharedScoreType");
    const target = document.getElementById("adminSharedTarget");
    const deadline = document.getElementById("adminSharedDeadline");

    if (!scoreType || !target || !deadline) return;

    Array.from(scoreType.options).forEach((option) => {
        option.hidden = false;
        option.disabled = false;
    });
    scoreType.disabled = false;
    target.disabled = false;
    target.required = true;
    deadline.required = false;

    if (uom === "timeline") {
        scoreType.value = "timeline";
        Array.from(scoreType.options).forEach((option) => {
            option.hidden = option.value !== "timeline";
            option.disabled = option.value !== "timeline";
        });
        scoreType.disabled = true;
        target.value = 0;
        target.disabled = true;
        target.required = false;
        deadline.required = true;
        return;
    }

    if (uom === "zero") {
        scoreType.value = "zero";
        Array.from(scoreType.options).forEach((option) => {
            option.hidden = option.value !== "zero";
            option.disabled = option.value !== "zero";
        });
        scoreType.disabled = true;
        target.value = 0;
        target.disabled = true;
        target.required = false;
        return;
    }

    Array.from(scoreType.options).forEach((option) => {
        option.hidden = !["min", "max"].includes(option.value);
        option.disabled = !["min", "max"].includes(option.value);
    });
    if (!["min", "max"].includes(scoreType.value)) {
        scoreType.value = "min";
    }
}

function normalizeSharedGoalPayload(payload) {
    if (payload.uomType === "timeline") {
        if (!payload.deadline) {
            return { ok: false, message: "Deadline is required for timeline shared KPIs." };
        }
        return { ok: true, payload: { ...payload, scoreType: "timeline", target: 0 } };
    }

    if (payload.uomType === "zero") {
        return { ok: true, payload: { ...payload, scoreType: "zero", target: 0 } };
    }

    if (!["min", "max"].includes(payload.scoreType)) {
        return { ok: false, message: "Numeric and percentage shared KPIs must use min or max score type." };
    }

    if (Number.isNaN(payload.target) || payload.target <= 0) {
        return { ok: false, message: "Target must be greater than 0." };
    }

    return { ok: true, payload };
}

async function saveCycleWindow(key) {
    const saveButton = document.querySelector(`.cycle-save-btn[data-key="${key}"]`);
    const monthsInput = document.querySelector(`.cycle-months-input[data-key="${key}"]`);
    const actionInput = document.querySelector(`.cycle-action-input[data-key="${key}"]`);
    const openMonths = String(monthsInput?.value || "")
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((month) => Number.isInteger(month));

    try {
        if (window.AppUX) AppUX.setButtonLoading(saveButton, true, "Saving");
        const response = await fetch(`${API_BASE}/cycles/${encodeURIComponent(key)}`, {
            method: "PUT",
            headers: getAuthHeaders(true),
            body: JSON.stringify({
                openMonths,
                action: actionInput?.value || ""
            }),
            signal: AbortSignal.timeout(DEFAULT_API_TIMEOUT)
        });
        await parseJsonResponse(response);
        showAlert("success", "Cycle window saved.");
        await fetchCycles();
        renderCycleTable();
    } catch (error) {
        showAlert("danger", error.message);
    } finally {
        if (window.AppUX) AppUX.setButtonLoading(saveButton, false);
    }
}

async function createAdminSharedGoal() {
    const button = document.getElementById("createAdminSharedGoalBtn");
    const payload = {
        thrustArea: document.getElementById("adminSharedThrustArea").value.trim(),
        title: document.getElementById("adminSharedTitle").value.trim(),
        primaryOwnerId: document.getElementById("adminSharedOwner").value,
        uomType: document.getElementById("adminSharedUom").value,
        scoreType: document.getElementById("adminSharedScoreType").value,
        target: Number(document.getElementById("adminSharedTarget").value),
        deadline: document.getElementById("adminSharedDeadline").value || null
    };

    if (!payload.thrustArea || !payload.title || !payload.primaryOwnerId) {
        showAdminSharedAlert("warning", "Thrust area, title, and primary owner are required.");
        return;
    }

    const normalized = normalizeSharedGoalPayload(payload);
    if (!normalized.ok) {
        showAdminSharedAlert("warning", normalized.message);
        return;
    }

    try {
        if (window.AppUX) AppUX.setButtonLoading(button, true, "Creating");
        const response = await fetch(`${API_BASE}/shared-goals/create`, {
            method: "POST",
            headers: getAuthHeaders(true),
            body: JSON.stringify(normalized.payload),
            signal: AbortSignal.timeout(DEFAULT_API_TIMEOUT)
        });
        await parseJsonResponse(response);
        showAdminSharedAlert("success", "Shared KPI created.");
        ["adminSharedThrustArea", "adminSharedTitle", "adminSharedTarget", "adminSharedDeadline"].forEach((id) => {
            const element = document.getElementById(id);
            if (element) element.value = "";
        });
        await fetchSharedGoals();
        renderAdminSharedGoals();
    } catch (error) {
        showAdminSharedAlert("danger", error.message);
    } finally {
        if (window.AppUX) AppUX.setButtonLoading(button, false);
    }
}

async function openAdminAssignShared(sharedGoalId) {
    try {
        state.activeSharedGoalId = sharedGoalId;
        const assignments = await fetchJson(`/shared-goals/${sharedGoalId}/assignments`);
        state.sharedAssignments.set(sharedGoalId, assignments);
        const assignedByEmployee = new Map(assignments.map((goal) => [(goal.employeeId?._id || goal.employeeId), goal]));
        const employees = state.users.filter((record) => record.role === "employee" && record.isActive);
        const list = document.getElementById("adminAssignSharedList");
        list.innerHTML = employees.length
            ? employees.map((employee) => {
                const assigned = assignedByEmployee.get(employee._id);
                return `
                    <div class="row g-2 align-items-center border-bottom py-2">
                        <div class="col-md-6">
                            <div class="form-check">
                                <input class="form-check-input admin-assign-shared-checkbox" type="checkbox" value="${sanitizeAttribute(employee._id)}" ${assigned ? "checked disabled" : ""}>
                                <label class="form-check-label">${sanitize(employee.name)} <span class="text-muted small">${sanitize(employee.department || "")}</span></label>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <input type="number" class="form-control form-control-sm admin-assign-shared-weightage" data-employee-id="${sanitizeAttribute(employee._id)}" min="10" max="100" value="${assigned?.weightage || 10}" ${assigned ? "disabled" : ""}>
                        </div>
                        <div class="col-md-3 small text-muted">${assigned ? "Already assigned" : "Weightage %"}</div>
                    </div>
                `;
            }).join("")
            : `<div class="text-center text-muted py-4">No active employees found.</div>`;
        document.getElementById("adminAssignSharedAlert").innerHTML = "";
        bootstrap.Modal.getOrCreateInstance(document.getElementById("adminAssignSharedModal")).show();
    } catch (error) {
        showAdminSharedAlert("danger", error.message);
    }
}

async function saveAdminSharedAssignments() {
    const saveButton = document.getElementById("saveAdminSharedAssignmentsBtn");
    const selected = Array.from(document.querySelectorAll(".admin-assign-shared-checkbox:checked:not(:disabled)"));
    const assignments = selected.map((checkbox) => {
        const weightInput = document.querySelector(`.admin-assign-shared-weightage[data-employee-id="${checkbox.value}"]`);
        return {
            employeeId: checkbox.value,
            weightage: Number(weightInput?.value || 0)
        };
    });

    if (!assignments.length) {
        document.getElementById("adminAssignSharedAlert").innerHTML = `<div class="alert alert-warning">Select at least one unassigned employee.</div>`;
        return;
    }

    if (assignments.some((assignment) => Number.isNaN(assignment.weightage) || assignment.weightage < 10)) {
        document.getElementById("adminAssignSharedAlert").innerHTML = `<div class="alert alert-danger">Every selected assignment needs weightage of at least 10%.</div>`;
        return;
    }

    try {
        if (window.AppUX) AppUX.setButtonLoading(saveButton, true, "Assigning");
        const response = await fetch(`${API_BASE}/shared-goals/assign-many`, {
            method: "POST",
            headers: getAuthHeaders(true),
            body: JSON.stringify({
                sharedGoalId: state.activeSharedGoalId,
                assignments
            }),
            signal: AbortSignal.timeout(DEFAULT_API_TIMEOUT)
        });
        const data = await parseJsonResponse(response);
        const assigned = data.results?.filter((result) => result.status === "assigned").length || 0;
        showAdminSharedAlert("success", `Assignment complete. ${assigned} employee(s) assigned.`);
        bootstrap.Modal.getInstance(document.getElementById("adminAssignSharedModal")).hide();
        await Promise.all([fetchGoals(), fetchSharedGoals()]);
        computeSummaryCards();
        renderAdminSharedGoals();
        renderUnlockGoals();
    } catch (error) {
        document.getElementById("adminAssignSharedAlert").innerHTML = `<div class="alert alert-danger">${sanitize(error.message)}</div>`;
        if (window.AppUX) AppUX.toast("error", error.message);
    } finally {
        if (window.AppUX) AppUX.setButtonLoading(saveButton, false);
    }
}

async function openAdminOwnerUpdate(sharedGoalId) {
    try {
        const assignments = await fetchJson(`/shared-goals/${sharedGoalId}/assignments`);
        const approvedAssignment = assignments.find((goal) => goal.status === "approved");
        if (!approvedAssignment) {
            showAdminSharedAlert("warning", "At least one linked goal sheet must be approved before owner achievement can be logged.");
            return;
        }
        state.activeOwnerGoalId = approvedAssignment._id;
        document.getElementById("adminOwnerUpdateActual").value = "";
        document.getElementById("adminOwnerUpdateCompletionDate").value = "";
        document.getElementById("adminOwnerUpdateComment").value = "";
        document.getElementById("adminOwnerUpdateAlert").innerHTML = "";
        bootstrap.Modal.getOrCreateInstance(document.getElementById("adminOwnerUpdateModal")).show();
    } catch (error) {
        showAdminSharedAlert("danger", error.message);
    }
}

async function saveAdminOwnerUpdate() {
    const saveButton = document.getElementById("saveAdminOwnerUpdateBtn");
    const actualValue = document.getElementById("adminOwnerUpdateActual").value;
    if (actualValue === "") {
        document.getElementById("adminOwnerUpdateAlert").innerHTML = `<div class="alert alert-warning">Actual achievement is required.</div>`;
        return;
    }

    const payload = {
        goalId: state.activeOwnerGoalId,
        quarter: document.getElementById("adminOwnerUpdateQuarter").value,
        actualAchievement: Number(actualValue),
        progressStatus: document.getElementById("adminOwnerUpdateStatus").value,
        completionDate: document.getElementById("adminOwnerUpdateCompletionDate").value || null,
        employeeComment: document.getElementById("adminOwnerUpdateComment").value.trim()
    };

    try {
        if (window.AppUX) AppUX.setButtonLoading(saveButton, true, "Saving");
        const response = await fetch(`${API_BASE}/updates/create`, {
            method: "POST",
            headers: getAuthHeaders(true),
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(DEFAULT_API_TIMEOUT)
        });
        await parseJsonResponse(response);
        showAdminSharedAlert("success", "Shared KPI achievement saved and synced.");
        bootstrap.Modal.getInstance(document.getElementById("adminOwnerUpdateModal")).hide();
        await loadAdminDashboard();
    } catch (error) {
        document.getElementById("adminOwnerUpdateAlert").innerHTML = `<div class="alert alert-danger">${sanitize(error.message)}</div>`;
        if (window.AppUX) AppUX.toast("error", error.message);
    } finally {
        if (window.AppUX) AppUX.setButtonLoading(saveButton, false);
    }
}

function sanitizeAttribute(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function prepareUnlock(employeeId, employeeName) {
    state.activeUnlockEmployee = employeeId;
    dom.unlockModalText.textContent = `Confirm unlock of approved goal sheets for ${employeeName}. Employees will regain edit access.`;
    dom.unlockModalAlert.innerHTML = "";
    unlockModalInstance.show();
}

async function confirmUnlock() {
    if (!state.activeUnlockEmployee) return;
    try {
        dom.confirmUnlockBtn.disabled = true;
        dom.confirmUnlockBtn.textContent = "Unlocking...";
        const employeeId = encodeURIComponent(state.activeUnlockEmployee);
        let response = await fetch(`${API_BASE}/goals/unlock/${employeeId}`, {
            method: "PUT",
            headers: getAuthHeaders(false),
            signal: AbortSignal.timeout(DEFAULT_API_TIMEOUT)
        });
        if (response.status === 404) {
            response = await fetch(`${API_BASE}/goals/return/${employeeId}`, {
                method: "PUT",
                headers: getAuthHeaders(false),
                signal: AbortSignal.timeout(DEFAULT_API_TIMEOUT)
            });
        }
        const data = await parseJsonResponse(response);
        showAlert("success", data.message || "Goal sheets unlocked successfully.");
        unlockModalInstance.hide();
        await loadAdminDashboard();
    } catch (error) {
        dom.unlockModalAlert.innerHTML = `<div class="alert alert-danger">${sanitize(error.message)}</div>`;
    } finally {
        dom.confirmUnlockBtn.disabled = false;
        dom.confirmUnlockBtn.textContent = "Unlock";
    }
}

function exportCsv() {
    const query = dom.reportSearch.value.trim().toLowerCase();
    const rows = state.achievementReport.filter((row) => {
        const employeeName = row.employee?.name || row.employee || "";
        const goalTitle = row.goalTitle || row.goal || "";
        const quarter = row.quarter || "";
        const managerComment = row.managerComment || "";
        return [employeeName, goalTitle, quarter, managerComment].some((value) => value.toLowerCase().includes(query));
    });
    const header = ["Employee", "Goal", "Quarter", "Planned Target", "Actual Achievement", "Progress Score", "Status", "Manager Comment"];
    const csvRows = [header.join(",")];
    rows.forEach((row) => {
        const values = [
            row.employee?.name || row.employee || "",
            row.goalTitle || row.goal || "",
            row.quarter || "",
            row.plannedTarget ?? "",
            row.actualAchievement ?? "",
            row.progressScore != null ? `${Number(row.progressScore).toFixed(1)}%` : "",
            row.progressStatus || row.status || "",
            row.managerComment || "",
        ];
        csvRows.push(values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `achievement_report_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    if (window.AppUX) AppUX.toast("success", `Exported ${rows.length} achievement record(s).`);
}

function setupEventHandlers() {
    dom.reportSearch.addEventListener("input", () => {
        state.currentPage = 1;
        renderAchievementReport();
    });
    dom.exportCsvBtn.addEventListener("click", exportCsv);
    dom.prevPageBtn.addEventListener("click", () => {
        if (state.currentPage > 1) {
            state.currentPage -= 1;
            renderAchievementReport();
        }
    });
    dom.nextPageBtn.addEventListener("click", () => {
        const filtered = state.achievementReport.filter((row) => {
            const employeeName = row.employee?.name || row.employee || "";
            const goalTitle = row.goalTitle || row.goal || "";
            const quarter = row.quarter || "";
            const managerComment = row.managerComment || "";
            return [employeeName, goalTitle, quarter, managerComment].some((value) => value.toLowerCase().includes(dom.reportSearch.value.trim().toLowerCase()));
        });
        const maxPage = Math.ceil(filtered.length / state.rowsPerPage);
        if (state.currentPage < maxPage) {
            state.currentPage += 1;
            renderAchievementReport();
        }
    });
    dom.confirmUnlockBtn.addEventListener("click", confirmUnlock);
    dom.cycleTableBody?.addEventListener("click", (event) => {
        const button = event.target.closest(".cycle-save-btn");
        if (button) saveCycleWindow(button.dataset.key);
    });
    dom.adminSharedGoalsTable?.addEventListener("click", (event) => {
        const button = event.target.closest(".admin-shared-action-btn");
        if (!button) return;
        if (button.dataset.action === "assign") openAdminAssignShared(button.dataset.sharedId);
        if (button.dataset.action === "owner-update") openAdminOwnerUpdate(button.dataset.sharedId);
    });
    document.getElementById("refreshCyclesBtn")?.addEventListener("click", async () => {
        await fetchCycles();
        renderCycleTable();
    });
    document.getElementById("refreshAdminSharedGoalsBtn")?.addEventListener("click", async () => {
        await fetchSharedGoals();
        renderAdminSharedGoals();
    });
    document.getElementById("runEscalationChecksBtn")?.addEventListener("click", runEscalationChecks);
    dom.loadMoreCheckinBtn?.addEventListener("click", () => {
        state.showAllCheckinCompletion = !state.showAllCheckinCompletion;
        renderCheckinCompletion();
    });
    dom.loadMoreAuditBtn?.addEventListener("click", () => {
        state.showAllAuditTimeline = !state.showAllAuditTimeline;
        renderAuditTimeline();
    });
    dom.loadMoreEscalationBtn?.addEventListener("click", () => {
        state.showAllEscalations = !state.showAllEscalations;
        renderEscalations();
    });
    dom.escalationsTableBody?.addEventListener("click", (event) => {
        const button = event.target.closest(".escalation-resolve-btn");
        if (button) resolveEscalation(button.dataset.id);
    });
    document.getElementById("createAdminSharedGoalBtn")?.addEventListener("click", createAdminSharedGoal);
    document.getElementById("adminSharedUom")?.addEventListener("change", syncAdminSharedGoalControls);
    document.getElementById("saveAdminSharedAssignmentsBtn")?.addEventListener("click", saveAdminSharedAssignments);
    document.getElementById("saveAdminOwnerUpdateBtn")?.addEventListener("click", saveAdminOwnerUpdate);
    document.getElementById("adminLogout").addEventListener("click", () => {
        localStorage.removeItem("user");
        sessionStorage.removeItem("user");
        window.location.href = "login.html";
    });
}

async function loadAdminDashboard() {
    try {
        state.showAllCheckinCompletion = false;
        state.showAllAuditTimeline = false;
        state.showAllEscalations = false;
        if (window.AppUX) {
            dom.achievementReportBody.innerHTML = AppUX.tableLoading(8, "Loading achievement report...");
            dom.checkinCompletionBody.innerHTML = AppUX.tableLoading(6, "Loading check-in completion...");
            dom.unlockGoalsBody.innerHTML = AppUX.tableLoading(5, "Loading unlock candidates...");
            dom.cycleTableBody.innerHTML = AppUX.tableLoading(4, "Loading cycle windows...");
            dom.adminSharedGoalsTable.innerHTML = AppUX.tableLoading(5, "Loading shared KPIs...");
            if (dom.escalationsTableBody) dom.escalationsTableBody.innerHTML = AppUX.tableLoading(7, "Loading escalations...");
        }
        await Promise.all([
            fetchUsers(),
            fetchGoals(),
            fetchCompletionDashboard(),
            fetchAchievementReport(),
            fetchAuditLogs(),
            fetchCycles(),
            fetchSharedGoals(),
            fetchEscalations(),
        ]);
        computeSummaryCards();
        buildCharts();
        populateSharedOwnerSelect();
        renderCycleTable();
        renderCheckinCompletion();
        renderAdminSharedGoals();
        renderAchievementReport();
        renderManagerEffectiveness();
        renderAuditTimeline();
        renderUnlockGoals();
        renderEscalations();
        showAlert("success", "Admin dashboard loaded successfully.", 4000);
    } catch (error) {
        showAlert("danger", error.message, 0);
    }
}

(function init() {
    protectRoute();
    setUserBanner();
    setupEventHandlers();
    syncAdminSharedGoalControls();
    loadAdminDashboard();
})();
