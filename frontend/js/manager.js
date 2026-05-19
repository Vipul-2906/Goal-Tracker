const API_BASE = "https://backend-46x0.onrender.com";
const user = (() => {
    try {
        return JSON.parse(localStorage.getItem("user")) || JSON.parse(sessionStorage.getItem("user"));
    } catch (error) {
        return null;
    }
})();

const state = {
    goals: [],
    filteredGoals: [],
    activeGoal: null,
    alertTimeout: null,
    activeWeightageEmployeeId: null,
    activeWeightageGoals: [],
    activeReturnEmployeeId: null,
    sharedGoals: [],
    teamMembers: [],
    sharedAssignments: new Map(),
    activeSharedGoalId: null,
    activeOwnerGoalId: null,
    approvalInProgress: false,
    returnInProgress: false,
};

const dom = {
    welcomeUser: document.getElementById("welcomeUser"),
    alertContainer: document.getElementById("alertContainer"),
    totalEmployees: document.getElementById("totalEmployees"),
    submittedSheets: document.getElementById("submittedSheets"),
    approvedSheets: document.getElementById("approvedSheets"),
    returnedSheets: document.getElementById("returnedSheets"),
    goalTable: document.getElementById("goalTable"),
    searchInput: document.getElementById("searchInput"),
    updatesModal: document.getElementById("updatesModal"),
    updatesTableBody: document.getElementById("updatesTableBody"),
    updatesTableWrapper: document.getElementById("updatesTableWrapper"),
    updatesEmptyState: document.getElementById("updatesEmptyState"),
    updatesLoader: document.getElementById("updatesLoader"),
    modalGoalMeta: document.getElementById("modalGoalMeta"),
    modalAlertContainer: document.getElementById("modalAlertContainer"),
    sharedGoalAlert: document.getElementById("sharedGoalAlert"),
    sharedGoalsTable: document.getElementById("sharedGoalsTable"),
};

const updatesModalInstance = new bootstrap.Modal(dom.updatesModal, {
    keyboard: false,
});

function protectRoute() {
    if (!user || user.role !== "manager") {
        window.location.href = "login.html";
    }
}

function setUserGreeting() {
    const name = user?.name || user?.fullName || "Manager";
    dom.welcomeUser.textContent = `Welcome, ${name}`;
}

function showAlert(type, message, duration = 5000) {
    if (window.AppUX) AppUX.toast(type === "danger" ? "error" : type, message);
    clearTimeout(state.alertTimeout);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show mb-3" role="alert">
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;
    dom.alertContainer.innerHTML = "";
    dom.alertContainer.appendChild(wrapper);
    state.alertTimeout = setTimeout(() => {
        const alertElement = wrapper.querySelector(".alert");
        if (alertElement) {
            bootstrap.Alert.getOrCreateInstance(alertElement).close();
        }
    }, duration);
}

function clearAlerts(container) {
    if (!container) return;
    container.innerHTML = "";
}

function formatBadge(status) {
    const normalized = String(status || "").toLowerCase();
    const badgeClass = {
        approved: "success",
        returned: "danger",
        submitted: "warning",
        draft: "secondary",
    }[normalized] || "dark";
    return `<span class="badge bg-${badgeClass} badge-status">${normalized}</span>`;
}

function formatQuarterBadge(status) {
    const normalized = String(status || "").toLowerCase();
    const badgeClass = {
        completed: "success",
        "on track": "primary",
        "not started": "secondary",
    }[normalized] || "dark";
    return `<span class="badge bg-${badgeClass}">${normalized}</span>`;
}

function sanitizeAttribute(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, " ")
        .replace(/\r/g, " ");
}

function sanitize(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function getAuthHeaders(hasBody = true) {
    const headers = {};
    if (hasBody) headers["Content-Type"] = "application/json";
    if (user?.token) headers["Authorization"] = `Bearer ${user.token}`;
    return headers;
}

function getEmployeeGroups(goals) {
    const groups = new Map();
    goals.forEach((goal) => {
        const employeeId = goal.employeeId?._id || goal.employeeId || "unknown";
        const employeeName = goal.employeeId?.name || goal.employeeId?.fullName || goal.employeeId?.email || "Unknown Employee";
        if (!groups.has(employeeId)) {
            groups.set(employeeId, {
                employeeId,
                employeeName,
                goals: [],
            });
        }
        groups.get(employeeId).goals.push(goal);
    });
    return Array.from(groups.values());
}

function deriveSheetStatus(goals) {
    if (goals.some((goal) => goal.status === "submitted")) return "submitted";
    if (goals.some((goal) => goal.status === "returned")) return "returned";
    if (goals.some((goal) => goal.status === "approved")) return "approved";
    return "draft";
}

function renderSummaryCards() {
    const groups = getEmployeeGroups(state.filteredGoals);
    const totalEmployees = groups.length;
    let submitted = 0;
    let approved = 0;
    let returned = 0;
    groups.forEach((group) => {
        const status = deriveSheetStatus(group.goals);
        if (status === "submitted") submitted += 1;
        if (status === "approved") approved += 1;
        if (status === "returned") returned += 1;
    });
    dom.totalEmployees.textContent = totalEmployees;
    dom.submittedSheets.textContent = submitted;
    dom.approvedSheets.textContent = approved;
    dom.returnedSheets.textContent = returned;
}

function renderGoalTable() {
    dom.goalTable.innerHTML = "";
    if (!state.filteredGoals.length) {
        dom.goalTable.innerHTML = window.AppUX
            ? AppUX.tableEmpty(9, "No team goals found", "Adjust the search, refresh, or wait for employees to submit goal sheets.", "bi-people")
            : `<tr><td colspan="9" class="text-center py-5 text-muted">No goals available. Adjust the filters or refresh the page.</td></tr>`;
        return;
    }
    const groups = getEmployeeGroups(state.filteredGoals);
    groups.forEach((group, groupIndex) => {
        const sheetStatus = deriveSheetStatus(group.goals);
        const canReview = sheetStatus === "submitted";
        const collapseId = `groupCollapse-${groupIndex}`;
        dom.goalTable.insertAdjacentHTML("beforeend", `
            <tr class="employee-group-row">
                <td>
                    <strong>${sanitize(group.employeeName)}</strong>
                    <div class="text-muted small">${group.goals.length} goal(s)</div>
                </td>
                <td colspan="4">
                    <span class="badge bg-info me-2">Sheet: ${sheetStatus}</span>
                    <span class="badge bg-secondary me-2">Shared: ${group.goals.filter((goal) => goal.isShared || goal.sharedGoalId).length}</span>
                    <span class="badge bg-primary">UoM: ${[...new Set(group.goals.map((goal) => goal.uomType || "N/A"))].join(", ")}</span>
                </td>
                <td colspan="4" class="text-end">
                    <button class="btn btn-sm btn-outline-primary me-2" data-bs-toggle="collapse" data-bs-target="#${collapseId}">Toggle Goals</button>
                    <button class="btn btn-sm btn-outline-secondary me-2 manager-action-btn" data-action="edit-weightages" data-employee-id="${sanitizeAttribute(group.employeeId)}" data-employee-name="${sanitizeAttribute(group.employeeName)}" ${canReview ? "" : "disabled"}>Edit Weightages</button>
                    <button class="btn btn-sm btn-success me-2" onclick="approveSheet('${group.employeeId}')" ${canReview ? "" : "disabled"}>Approve Sheet</button>
                    <button class="btn btn-sm btn-danger" onclick="openReturnNotes('${group.employeeId}', '${sanitizeAttribute(group.employeeName)}')" ${canReview ? "" : "disabled"}>Return Sheet</button>
                </td>
            </tr>
            <tr class="collapse" id="${collapseId}">
                <td colspan="9" class="p-0 bg-white">
                    <div class="table-responsive">
                        <table class="table table-borderless mb-0">
                            <tbody>
                                ${group.goals
                                    .map((goal) => `
                                        <tr>
                                            <td class="ps-4" style="width:18%;">
                                                <div class="fw-semibold">${sanitize(goal.title)}</div>
                                                ${goal.isShared || goal.sharedGoalId ? '<span class="badge bg-info mt-1">Shared</span>' : ""}
                                            </td>
                                            <td style="width:12%;">${sanitize(goal.thrustArea || "N/A")}</td>
                                            <td style="width:8%;">${sanitize(goal.uomType || "N/A")}</td>
                                            <td style="width:10%;">${sanitize(goal.scoreType || "N/A")}</td>
                                            <td style="width:10%;">${goal.target ?? "—"}</td>
                                            <td style="width:10%;">${goal.weightage ?? "—"}%</td>
                                            <td style="width:12%;">${formatBadge(goal.status)}</td>
                                            <td style="width:20%;" class="text-end">
                                                <button class="btn btn-sm btn-outline-secondary view-updates-btn" data-goal-id="${sanitizeAttribute(goal._id)}" data-employee-name="${sanitizeAttribute(group.employeeName)}" data-goal-title="${sanitizeAttribute(goal.title)}">View Updates</button>
                                            </td>
                                        </tr>
                                    `)
                                    .join("")}
                            </tbody>
                        </table>
                    </div>
                </td>
            </tr>
        `);
    });
}

async function fetchGoals() {
    const response = await fetch(`${API_BASE}/goals`, {
        headers: getAuthHeaders(false)
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to load goals.");
    }
    return response.json();
}

async function fetchTeamMembers() {
    const response = await fetch(`${API_BASE}/auth/team`, {
        headers: getAuthHeaders(false)
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to load team members.");
    }
    return response.json();
}

async function fetchSharedGoals() {
    const response = await fetch(`${API_BASE}/shared-goals`, {
        headers: getAuthHeaders(false)
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to load shared KPIs.");
    }
    return response.json();
}

async function fetchSharedAssignments(sharedGoalId) {
    const response = await fetch(`${API_BASE}/shared-goals/${sharedGoalId}/assignments`, {
        headers: getAuthHeaders(false)
    });
    if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.message || "Failed to load shared KPI assignments.");
    }
    return response.json();
}

function showSharedAlert(type, message) {
    if (!dom.sharedGoalAlert) return;
    if (window.AppUX) AppUX.toast(type === "danger" ? "error" : type, message);
    dom.sharedGoalAlert.innerHTML = `<div class="alert alert-${type} py-2">${sanitize(message)}</div>`;
    setTimeout(() => {
        dom.sharedGoalAlert.innerHTML = "";
    }, 5000);
}

function syncSharedGoalControls() {
    const uom = document.getElementById("sharedUom")?.value;
    const scoreType = document.getElementById("sharedScoreType");
    const target = document.getElementById("sharedTarget");
    const deadline = document.getElementById("sharedDeadline");

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

async function loadSharedGoalDashboard() {
    if (!dom.sharedGoalsTable) return;
    try {
        const [teamMembers, sharedGoals] = await Promise.all([
            fetchTeamMembers(),
            fetchSharedGoals()
        ]);
        state.teamMembers = Array.isArray(teamMembers) ? teamMembers : [];
        state.sharedGoals = Array.isArray(sharedGoals) ? sharedGoals : [];
        state.sharedAssignments = new Map();

        await Promise.all(state.sharedGoals.map(async (sharedGoal) => {
            const assignments = await fetchSharedAssignments(sharedGoal._id).catch(() => []);
            state.sharedAssignments.set(sharedGoal._id, assignments);
        }));

        renderSharedGoals();
    } catch (error) {
        dom.sharedGoalsTable.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-3">${escapeHtml(error.message)}</td></tr>`;
        if (window.AppUX) AppUX.toast("error", error.message);
    }
}

function renderSharedGoals() {
    if (!state.sharedGoals.length) {
        dom.sharedGoalsTable.innerHTML = window.AppUX
            ? AppUX.tableEmpty(5, "No shared KPIs yet", "Create a departmental KPI and assign it to your team.", "bi-diagram-3")
            : `<tr><td colspan="5" class="text-center text-muted py-3">No shared KPIs yet.</td></tr>`;
        return;
    }

    dom.sharedGoalsTable.innerHTML = state.sharedGoals.map((sharedGoal) => {
        const assignments = state.sharedAssignments.get(sharedGoal._id) || [];
        return `
            <tr>
                <td>
                    <div class="fw-semibold">${sanitize(sharedGoal.title)}</div>
                    <div class="small text-muted">${sanitize(sharedGoal.thrustArea || "")}</div>
                </td>
                <td>${sanitize(sharedGoal.uomType)} / ${sanitize(sharedGoal.scoreType)}</td>
                <td>${sharedGoal.target ?? "—"}</td>
                <td>${assignments.length}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary shared-action-btn" data-action="assign-shared" data-shared-id="${sanitizeAttribute(sharedGoal._id)}">Assign</button>
                    <button class="btn btn-sm btn-outline-success shared-action-btn" data-action="owner-update" data-shared-id="${sanitizeAttribute(sharedGoal._id)}">Owner Update</button>
                </td>
            </tr>
        `;
    }).join("");
}

async function createSharedGoal() {
    const button = document.getElementById("createSharedGoalBtn");
    const payload = {
        thrustArea: document.getElementById("sharedThrustArea").value.trim(),
        title: document.getElementById("sharedTitle").value.trim(),
        uomType: document.getElementById("sharedUom").value,
        scoreType: document.getElementById("sharedScoreType").value,
        target: Number(document.getElementById("sharedTarget").value),
        deadline: document.getElementById("sharedDeadline").value || null
    };

    if (!payload.thrustArea || !payload.title || Number.isNaN(payload.target) || payload.target < 0) {
        showSharedAlert("warning", "Thrust area and title are required.");
        return;
    }

    const normalized = normalizeSharedGoalPayload(payload);
    if (!normalized.ok) {
        showSharedAlert("warning", normalized.message);
        return;
    }

    try {
        if (window.AppUX) AppUX.setButtonLoading(button, true, "Creating");
        const response = await fetch(`${API_BASE}/shared-goals/create`, {
            method: "POST",
            headers: getAuthHeaders(true),
            body: JSON.stringify(normalized.payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Unable to create shared KPI.");
        showSharedAlert("success", "Shared KPI created.");
        ["sharedThrustArea", "sharedTitle", "sharedTarget", "sharedDeadline"].forEach((id) => {
            const element = document.getElementById(id);
            if (element) element.value = "";
        });
        await loadSharedGoalDashboard();
    } catch (error) {
        showSharedAlert("danger", error.message);
    } finally {
        if (window.AppUX) AppUX.setButtonLoading(button, false);
    }
}

async function openAssignShared(sharedGoalId) {
    try {
        state.activeSharedGoalId = sharedGoalId;
        const assignments = await fetchSharedAssignments(sharedGoalId);
        state.sharedAssignments.set(sharedGoalId, assignments);
        const assignedByEmployee = new Map(assignments.map((goal) => [(goal.employeeId?._id || goal.employeeId), goal]));
        const list = document.getElementById("assignSharedList");

        list.innerHTML = state.teamMembers.length
            ? state.teamMembers.map((employee) => {
                const assigned = assignedByEmployee.get(employee._id);
                return `
                    <div class="row g-2 align-items-center border-bottom py-2">
                        <div class="col-md-6">
                            <div class="form-check">
                                <input class="form-check-input assign-shared-checkbox" type="checkbox" value="${sanitizeAttribute(employee._id)}" ${assigned ? "checked disabled" : ""}>
                                <label class="form-check-label">${sanitize(employee.name)} <span class="text-muted small">${sanitize(employee.department || "")}</span></label>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <input type="number" class="form-control form-control-sm assign-shared-weightage" data-employee-id="${sanitizeAttribute(employee._id)}" min="10" max="100" value="${assigned?.weightage || 10}" ${assigned ? "disabled" : ""}>
                        </div>
                        <div class="col-md-3 small text-muted">${assigned ? "Already assigned" : "Weightage %"}</div>
                    </div>
                `;
            }).join("")
            : `<div class="text-center text-muted py-4">No active team members found.</div>`;

        document.getElementById("assignSharedAlert").innerHTML = "";
        bootstrap.Modal.getOrCreateInstance(document.getElementById("assignSharedModal")).show();
    } catch (error) {
        showSharedAlert("danger", error.message);
    }
}

async function saveSharedAssignments() {
    if (state.sharedAssignmentInProgress) return;
    const saveButton = document.getElementById("saveSharedAssignmentsBtn");
    const selected = Array.from(document.querySelectorAll(".assign-shared-checkbox:checked:not(:disabled)"));
    const assignments = selected.map((checkbox) => {
        const weightInput = document.querySelector(`.assign-shared-weightage[data-employee-id="${checkbox.value}"]`);
        return {
            employeeId: checkbox.value,
            weightage: Number(weightInput?.value || 0)
        };
    });

    if (!assignments.length) {
        document.getElementById("assignSharedAlert").innerHTML = `<div class="alert alert-warning">Select at least one unassigned team member.</div>`;
        return;
    }

    if (assignments.some((assignment) => Number.isNaN(assignment.weightage) || assignment.weightage < 10)) {
        document.getElementById("assignSharedAlert").innerHTML = `<div class="alert alert-danger">Every selected assignment needs weightage of at least 10%.</div>`;
        return;
    }

    try {
        state.sharedAssignmentInProgress = true;
        if (window.AppUX) AppUX.setButtonLoading(saveButton, true, "Assigning");
        const response = await fetch(`${API_BASE}/shared-goals/assign-many`, {
            method: "POST",
            headers: getAuthHeaders(true),
            body: JSON.stringify({
                sharedGoalId: state.activeSharedGoalId,
                assignments
            }),
            signal: AbortSignal.timeout(30000)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Unable to assign shared KPI.");
        const assigned = data.results?.filter((result) => result.status === "assigned").length || 0;
        showSharedAlert("success", `Assignment complete. ${assigned} employee(s) assigned.`);
        bootstrap.Modal.getInstance(document.getElementById("assignSharedModal")).hide();
        await Promise.all([loadDashboard(), loadSharedGoalDashboard()]);
    } catch (error) {
        document.getElementById("assignSharedAlert").innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
        if (window.AppUX) AppUX.toast("error", error.message);
    } finally {
        state.sharedAssignmentInProgress = false;
        if (window.AppUX) AppUX.setButtonLoading(saveButton, false);
    }
}

async function openOwnerUpdate(sharedGoalId) {
    try {
        const assignments = await fetchSharedAssignments(sharedGoalId);
        if (!assignments.length) {
            showSharedAlert("warning", "Assign this shared KPI before logging achievement.");
            return;
        }
        const approvedAssignment = assignments.find((goal) => goal.status === "approved");
        if (!approvedAssignment) {
            showSharedAlert("warning", "At least one linked goal sheet must be approved before owner achievement can be logged.");
            return;
        }
        state.activeOwnerGoalId = approvedAssignment._id;
        document.getElementById("ownerUpdateActual").value = "";
        document.getElementById("ownerUpdateCompletionDate").value = "";
        document.getElementById("ownerUpdateComment").value = "";
        document.getElementById("ownerUpdateAlert").innerHTML = "";
        bootstrap.Modal.getOrCreateInstance(document.getElementById("ownerUpdateModal")).show();
    } catch (error) {
        showSharedAlert("danger", error.message);
    }
}

async function saveOwnerUpdate() {
    if (state.ownerUpdateInProgress) return;
    const saveButton = document.getElementById("saveOwnerUpdateBtn");
    const actualValue = document.getElementById("ownerUpdateActual").value;
    if (actualValue === "") {
        document.getElementById("ownerUpdateAlert").innerHTML = `<div class="alert alert-warning">Actual achievement is required.</div>`;
        return;
    }

    const payload = {
        goalId: state.activeOwnerGoalId,
        quarter: document.getElementById("ownerUpdateQuarter").value,
        actualAchievement: Number(actualValue),
        progressStatus: document.getElementById("ownerUpdateStatus").value,
        completionDate: document.getElementById("ownerUpdateCompletionDate").value || null,
        employeeComment: document.getElementById("ownerUpdateComment").value.trim()
    };

    try {
        state.ownerUpdateInProgress = true;
        if (window.AppUX) AppUX.setButtonLoading(saveButton, true, "Saving");
        const response = await fetch(`${API_BASE}/updates/create`, {
            method: "POST",
            headers: getAuthHeaders(true),
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30000)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || "Unable to save owner update.");
        showSharedAlert("success", "Shared KPI achievement saved and synced.");
        bootstrap.Modal.getInstance(document.getElementById("ownerUpdateModal")).hide();
        await loadDashboard();
    } catch (error) {
        document.getElementById("ownerUpdateAlert").innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
        if (window.AppUX) AppUX.toast("error", error.message);
    } finally {
        state.ownerUpdateInProgress = false;
        if (window.AppUX) AppUX.setButtonLoading(saveButton, false);
    }
}

async function approveSheet(employeeId) {
    // Prevent double-click submission
    if (state.approvalInProgress) return;
    
    const confirmed = window.AppUX
        ? await AppUX.confirm({
            title: "Approve goal sheet?",
            message: "Approved goals will lock for the employee until an admin unlocks them.",
            confirmText: "Approve sheet",
            variant: "success"
        })
        : confirm("Approve this goal sheet?");
    if (!confirmed) return;

    let btn = null;
    try {
        state.approvalInProgress = true;
        btn = document.querySelector(`button[onclick*="approveSheet('${employeeId}')"]`);
        if (btn) {
            btn.disabled = true;
            if (window.AppUX) AppUX.setButtonLoading(btn, true, "Approving");
        }
        
        const response = await fetch(`${API_BASE}/goals/approve/${employeeId}`, {
            method: "PUT",
            headers: getAuthHeaders(false),
            signal: AbortSignal.timeout(30000) // 30s timeout
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || "Approve request failed.");
        }
        showAlert("success", data.message || "Sheet approved successfully.");
        await loadDashboard();
    } catch (error) {
        showAlert("danger", error.message);
        if (btn) btn.disabled = false;
    } finally {
        state.approvalInProgress = false;
        if (btn && window.AppUX) AppUX.setButtonLoading(btn, false);
    }
}

async function returnSheet(employeeId, managerNotes = "") {
    if (state.returnInProgress) return false;
    try {
        state.returnInProgress = true;
        showAlert("info", "Returning goal sheet for rework...");
        const response = await fetch(`${API_BASE}/goals/return/${employeeId}`, {
            method: "PUT",
            headers: getAuthHeaders(true),
            body: JSON.stringify({ managerNotes }),
            signal: AbortSignal.timeout(30000) // 30s timeout
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || "Return request failed.");
        }
        showAlert("success", data.message || "Sheet returned for rework.");
        await loadDashboard();
        return true;
    } catch (error) {
        showAlert("danger", error.message);
        return false;
    } finally {
        state.returnInProgress = false;
    }
}

function openReturnNotes(employeeId, employeeName) {
    document.getElementById('returnNotesText').value = '';
    document.getElementById('returnNotesAlert').innerHTML = '';
    state.activeReturnEmployeeId = employeeId;
    const modal = new bootstrap.Modal(document.getElementById('returnNotesModal'));
    document.getElementById('returnNotesModalLabel').textContent = `Return Sheet for ${employeeName}`;
    modal.show();
}

async function confirmReturn() {
    const notes = document.getElementById('returnNotesText').value.trim();
    if (!state.activeReturnEmployeeId) return;
    if (window.AppUX) AppUX.setButtonLoading(document.getElementById("confirmReturnBtn"), true, "Returning");
    const ok = await returnSheet(state.activeReturnEmployeeId, notes);
    if (ok) bootstrap.Modal.getInstance(document.getElementById('returnNotesModal')).hide();
    if (window.AppUX) AppUX.setButtonLoading(document.getElementById("confirmReturnBtn"), false);
}

function openWeightageEditor(employeeId, employeeName) {
    const goals = state.goals.filter(g => (g.employeeId?._id || g.employeeId) === employeeId);
    if (!goals.length) {
        showAlert('warning', 'No goals found for this employee');
        return;
    }
    
    state.activeWeightageEmployeeId = employeeId;
    state.activeWeightageGoals = goals;
    
    const form = document.getElementById('weightageForm');
    form.innerHTML = goals.map(g => `
        <div class="mb-3 goal-edit-row" data-goal-id="${g._id}" data-shared="${g.isShared || g.sharedGoalId ? "true" : "false"}">
            <label class="form-label d-block">${sanitize(g.title)}</label>
            <div class="row g-2 align-items-center">
                <div class="col-7">
                    <div class="input-group">
                        <span class="input-group-text">Weightage</span>
                        <input type="number" class="form-control weightage-input" data-goal-id="${g._id}" value="${g.weightage}" min="1" max="100" step="0.1">
                        <span class="input-group-text">%</span>
                    </div>
                </div>
                <div class="col-5">
                    <div class="input-group">
                        <span class="input-group-text">Target</span>
                        <input type="number" class="form-control target-input" data-goal-id="${g._id}" value="${g.target ?? 0}" ${g.isShared || g.sharedGoalId ? 'disabled readonly' : ''}>
                    </div>
                </div>
            </div>
            ${g.isShared || g.sharedGoalId ? '<div class="form-text">Shared goals may only adjust weightage.</div>' : ''}
        </div>
    `).join('');
    
    document.querySelectorAll('.weightage-input').forEach(input => {
        input.addEventListener('change', updateWeightageTotal);
        input.addEventListener('input', updateWeightageTotal);
    });
    
    updateWeightageTotal();
    const modal = new bootstrap.Modal(document.getElementById('weightageModal'));
    document.getElementById('weightageModalLabel').textContent = `Edit Weightages for ${employeeName}`;
    modal.show();
}

function updateWeightageTotal() {
    let total = 0;
    document.querySelectorAll('.weightage-input').forEach(input => {
        total += Number(input.value || 0);
    });
    const totalEl = document.getElementById('weightageTotal');
    totalEl.textContent = total.toFixed(1);
    totalEl.classList.remove('text-success', 'text-danger');
    if (Math.abs(total - 100) < 0.1) {
        totalEl.classList.add('text-success');
    } else {
        totalEl.classList.add('text-danger');
    }
}

async function saveWeightages() {
    const saveButton = document.getElementById('saveWeightagesBtn');
    const goalUpdates = [];
    let isValid = true;
    let total = 0;
    
    document.querySelectorAll('.goal-edit-row').forEach((row) => {
        const goalId = row.dataset.goalId;
        const isShared = row.dataset.shared === "true";
        const weightInput = row.querySelector('.weightage-input');
        const targetInput = row.querySelector('.target-input');
        const weightValue = Number(weightInput?.value || 0);
        const targetValue = !isShared && targetInput ? Number(targetInput.value || 0) : undefined;

        if (weightValue <= 0) {
            isValid = false;
        }

        total += weightValue;
        goalUpdates.push({
            goalId,
            weightage: weightValue,
            target: targetInput ? targetValue : undefined
        });
    });
    
    if (!isValid || Math.abs(total - 100) > 0.1) {
        document.getElementById('weightageAlert').innerHTML = `<div class="alert alert-danger">Total weightage must equal 100% (currently ${total.toFixed(1)}%)</div>`;
        return;
    }
    
    try {
        if (window.AppUX) AppUX.setButtonLoading(saveButton, true, "Saving");
        else saveButton.disabled = true;
        const response = await fetch(`${API_BASE}/goals/update-weightages/${state.activeWeightageEmployeeId}`, {
            method: "PUT",
            headers: getAuthHeaders(true),
            body: JSON.stringify({ goals: goalUpdates })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || "Failed to update weightages");
        }
        showAlert('success', 'Weightages updated successfully');
        bootstrap.Modal.getInstance(document.getElementById('weightageModal')).hide();
        await loadDashboard();
    } catch (error) {
        document.getElementById('weightageAlert').innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
        if (window.AppUX) AppUX.toast("error", error.message);
    } finally {
        if (window.AppUX) AppUX.setButtonLoading(saveButton, false);
        else saveButton.disabled = false;
    }
}

async function openUpdates(goalId, employeeName, goalTitle) {
    state.activeGoal = goalId;
    dom.modalGoalMeta.textContent = `${employeeName} · ${goalTitle}`;
    clearAlerts(dom.modalAlertContainer);
    dom.updatesTableBody.innerHTML = "";
    dom.updatesTableWrapper.classList.add("d-none");
    dom.updatesEmptyState.classList.add("d-none");
    dom.updatesLoader.classList.remove("d-none");
    updatesModalInstance.show();
    await loadUpdates(goalId);
}

async function loadUpdates(goalId) {
    try {
        const response = await fetch(`${API_BASE}/updates/${goalId}`, {
            headers: getAuthHeaders(false)
        });
        if (!response.ok) {
            throw new Error("Unable to fetch updates.");
        }
        const updates = await response.json();
        renderUpdates(updates);
    } catch (error) {
        dom.modalAlertContainer.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
        dom.updatesLoader.classList.add("d-none");
    }
}

function renderUpdates(updates) {
    dom.updatesLoader.classList.add("d-none");
    if (!updates || !updates.length) {
        dom.updatesEmptyState.classList.remove("d-none");
        return;
    }
    dom.updatesTableBody.innerHTML = updates
        .map((update) => `
            <tr>
                <td>${sanitize(update.quarter || "N/A")}</td>
                <td>
                    <div class="small text-muted">Planned: ${update.plannedTarget ?? "—"}</div>
                    <div>Actual: ${update.actualAchievement ?? "—"}</div>
                </td>
                <td>${formatQuarterBadge(update.progressStatus)}</td>
                <td>${update.progressScore != null ? `${Number(update.progressScore).toFixed(1)}%` : "—"}</td>
                <td>${update.employeeComment ? `<div>${sanitize(update.employeeComment)}</div>` : "<span class='text-muted'>No comment</span>"}</td>
                <td>
                    <textarea id="managerComment-${sanitizeAttribute(update._id)}" class="form-control form-control-sm mb-2" rows="2" placeholder="Add manager feedback">${sanitize(update.managerComment)}</textarea>
                    <button class="btn btn-sm btn-primary" onclick="saveManagerComment('${sanitizeAttribute(update._id)}')">Save Comment</button>
                </td>
            </tr>
        `)
        .join("");
    dom.updatesTableWrapper.classList.remove("d-none");
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

async function saveManagerComment(updateId) {
    const button = document.querySelector(`button[onclick="saveManagerComment('${updateId}')"]`);
    try {
        if (window.AppUX) AppUX.setButtonLoading(button, true, "Saving");
        const textarea = document.getElementById(`managerComment-${updateId}`);
        const managerComment = textarea?.value.trim() || "";
        const response = await fetch(`${API_BASE}/updates/comment/${updateId}`, {
            method: "PUT",
            headers: getAuthHeaders(true),
            body: JSON.stringify({ managerComment }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || "Unable to save manager comment.");
        }
        showModalAlert("success", "Manager feedback saved successfully.");
        await loadUpdates(state.activeGoal);
    } catch (error) {
        showModalAlert("danger", error.message);
        if (window.AppUX) AppUX.toast("error", error.message);
    } finally {
        if (window.AppUX) AppUX.setButtonLoading(button, false);
    }
}

function showModalAlert(type, message) {
    if (window.AppUX) AppUX.toast(type === "danger" ? "error" : type, message);
    dom.modalAlertContainer.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${escapeHtml(message)}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;
}

function applySearchFilter() {
    const query = dom.searchInput.value.trim().toLowerCase();
    if (!query) {
        state.filteredGoals = [...state.goals];
    } else {
        state.filteredGoals = state.goals.filter((goal) => {
            const employeeName = goal.employeeId?.name || goal.employeeId?.fullName || goal.employeeId?.email || "";
            const goalTitle = goal.title || "";
            const thrustArea = goal.thrustArea || "";
            return [employeeName, goalTitle, thrustArea].some((value) =>
                value.toLowerCase().includes(query)
            );
        });
    }
    renderSummaryCards();
    renderGoalTable();
}

async function loadDashboard() {
    try {
        dom.goalTable.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-5">
                    <div class="spinner-border text-primary" role="status"></div>
                    <div class="mt-3 text-muted">Loading goals...</div>
                </td>
            </tr>
        `;
        if (window.AppUX) dom.goalTable.innerHTML = AppUX.tableLoading(9, "Loading team goals...");
        const goals = await fetchGoals();
        state.goals = Array.isArray(goals) ? goals : [];
        state.filteredGoals = [...state.goals];
        renderSummaryCards();
        renderGoalTable();
    } catch (error) {
        dom.goalTable.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-5 text-danger">${escapeHtml(error.message)}</td>
            </tr>
        `;
        showAlert("danger", error.message);
    }
}

function setupEvents() {
    dom.searchInput.addEventListener("input", applySearchFilter);
    dom.goalTable.addEventListener("click", (event) => {
        const updatesButton = event.target.closest(".view-updates-btn");
        if (updatesButton) {
            const goalId = updatesButton.dataset.goalId;
            const employeeName = updatesButton.dataset.employeeName;
            const goalTitle = updatesButton.dataset.goalTitle;
            if (goalId) {
                openUpdates(goalId, employeeName, goalTitle);
            }
            return;
        }

        const actionButton = event.target.closest(".manager-action-btn");
        if (!actionButton) return;

        if (actionButton.dataset.action === "edit-weightages") {
            openWeightageEditor(actionButton.dataset.employeeId, actionButton.dataset.employeeName);
        }
    });
    dom.sharedGoalsTable?.addEventListener("click", (event) => {
        const button = event.target.closest(".shared-action-btn");
        if (!button) return;
        if (button.dataset.action === "assign-shared") {
            openAssignShared(button.dataset.sharedId);
        }
        if (button.dataset.action === "owner-update") {
            openOwnerUpdate(button.dataset.sharedId);
        }
    });
    document.getElementById("saveWeightagesBtn").addEventListener("click", saveWeightages);
    document.getElementById("createSharedGoalBtn")?.addEventListener("click", createSharedGoal);
    document.getElementById("sharedUom")?.addEventListener("change", syncSharedGoalControls);
    document.getElementById("refreshSharedGoalsBtn")?.addEventListener("click", loadSharedGoalDashboard);
    document.getElementById("saveSharedAssignmentsBtn")?.addEventListener("click", saveSharedAssignments);
    document.getElementById("saveOwnerUpdateBtn")?.addEventListener("click", saveOwnerUpdate);
    document.getElementById("logoutButton").addEventListener("click", () => {
        localStorage.removeItem("user");
        sessionStorage.removeItem("user");
        window.location.href = "login.html";
    });
}

(function init() {
    protectRoute();
    setUserGreeting();
    setupEvents();
    syncSharedGoalControls();
    loadDashboard();
    loadSharedGoalDashboard();
})();
