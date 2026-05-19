// User Management Module for Admin Dashboard
// Handles user CRUD operations

const UserManager = (() => {
    const API_BASE = "https://backend-46x0.onrender.com/api";
    const user = (() => {
        try {
            return JSON.parse(localStorage.getItem("user")) || JSON.parse(sessionStorage.getItem("user"));
        } catch (error) {
            return null;
        }
    })();

    const state = {
        users: [],
        managers: [],
        userModal: null,
        isEditing: false,
        roleFilter: "employee",
    };

    const dom = {
        usersTableBody: document.getElementById("usersTableBody"),
        roleFilterAdminBtn: document.getElementById("roleFilterAdminBtn"),
        roleFilterManagerBtn: document.getElementById("roleFilterManagerBtn"),
        roleFilterEmployeeBtn: document.getElementById("roleFilterEmployeeBtn"),
        addUserBtn: document.getElementById("addUserBtn"),
        userModal: document.getElementById("userModal"),
        userForm: document.getElementById("userForm"),
        userId: document.getElementById("userId"),
        userFullName: document.getElementById("userFullName"),
        userEmail: document.getElementById("userEmail"),
        userPassword: document.getElementById("userPassword"),
        userConfirmPassword: document.getElementById("userConfirmPassword"),
        userRole: document.getElementById("userRole"),
        userDepartment: document.getElementById("userDepartment"),
        userActive: document.getElementById("userActive"),
        userManager: document.getElementById("userManager"),
        managerAssignmentDiv: document.getElementById("managerAssignmentDiv"),
        saveUserBtn: document.getElementById("saveUserBtn"),
        userFormAlert: document.getElementById("userFormAlert"),
        adminAlert: document.getElementById("adminAlert"),
    };

    function showAlert(containerId, type, message, timeout = 5000) {
        if (window.AppUX) AppUX.toast(type === "danger" ? "error" : type, message);
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${sanitize(message)}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
        if (timeout) {
            setTimeout(() => {
                container.innerHTML = "";
            }, timeout);
        }
    }

    function sanitize(value) {
        return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function normalizeDepartment(department) {
        return String(department || "").trim();
    }

    function getManagersByDepartment(department) {
        const normalized = normalizeDepartment(department);
        if (!normalized) return state.managers;
        return state.managers.filter((manager) => normalizeDepartment(manager.department) === normalized);
    }

    function updateManagerDropdown(department = "") {
        const managers = getManagersByDepartment(department);
        dom.userManager.innerHTML = `<option value="">Select a manager</option>`;

        if (managers.length) {
            managers.forEach(m => {
                const option = document.createElement("option");
                option.value = m._id;
                option.textContent = `${m.name} (${m.email})`;
                dom.userManager.appendChild(option);
            });
        } else if (normalizeDepartment(department)) {
            const noManagerOption = document.createElement("option");
            noManagerOption.value = "";
            noManagerOption.textContent = "No active manager in this department";
            noManagerOption.disabled = true;
            dom.userManager.appendChild(noManagerOption);
        }
    }

    async function fetchUsers() {
        try {
            if (window.AppUX) dom.usersTableBody.innerHTML = AppUX.tableLoading(7, "Loading users...");
            const response = await fetch(`${API_BASE}/auth/admin/users`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${user?.token}`
                }
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || "Failed to load users");
            }

            state.users = await response.json();
            state.managers = state.users.filter(u => u.role === "manager");
            renderUsersTable();
            updateManagerDropdown();
            setRoleFilter(state.roleFilter);
        } catch (error) {
            showAlert("adminAlert", "danger", `Error loading users: ${error.message}`);
        }
    }

    function renderUsersTable() {
        dom.usersTableBody.innerHTML = "";

        const filteredUsers = state.users.filter((u) => u.role === state.roleFilter);

        if (!filteredUsers.length) {
            dom.usersTableBody.innerHTML = window.AppUX
                ? AppUX.tableEmpty(7, "No users found", `No ${state.roleFilter} users are available.`, "bi-person-plus")
                : `<tr><td colspan="7" class="text-center text-muted py-4"><i class="bi bi-inbox me-2"></i>No ${state.roleFilter} users found</td></tr>`;
            return;
        }

        filteredUsers.forEach(u => {
            const managerName = u.managerId?.name || u.managerId?.email || "-";
            const statusBadge = u.isActive 
                ? `<span class="badge bg-success">Active</span>` 
                : `<span class="badge bg-secondary">Inactive</span>`;
            
            const roleBadge = {
                admin: '<span class="badge bg-danger">Admin</span>',
                manager: '<span class="badge bg-primary">Manager</span>',
                employee: '<span class="badge bg-info">Employee</span>'
            }[u.role] || `<span class="badge bg-light">${u.role}</span>`;

            const tr = document.createElement("tr");
            const actionButtons = u.role === "admin"
                ? `<span class="text-muted small">No actions</span>`
                : `
                    <button class="btn btn-sm btn-outline-primary me-1 edit-user-btn" data-user-id="${u._id}" title="Edit">
                        <i class="bi bi-pencil-square"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-warning me-1 reset-password-btn" data-user-id="${u._id}" title="Reset Password">
                        <i class="bi bi-key"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger delete-user-btn" data-user-id="${u._id}" title="Delete">
                        <i class="bi bi-trash"></i>
                    </button>
                `;

            tr.innerHTML = `
                <td>${sanitize(u.name)}</td>
                <td class="text-muted small">${sanitize(u.email)}</td>
                <td>${roleBadge}</td>
                <td>${sanitize(u.department || "-")}</td>
                <td>${sanitize(managerName)}</td>
                <td>${statusBadge}</td>
                <td class="text-end">
                    ${actionButtons}
                </td>
            `;

            dom.usersTableBody.appendChild(tr);
        });

        // Attach event listeners
        document.querySelectorAll(".edit-user-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const userId = e.currentTarget.dataset.userId;
                const userToEdit = state.users.find(u => u._id === userId);
                if (userToEdit) openUserModal(userToEdit);
            });
        });

        document.querySelectorAll(".reset-password-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const userId = e.currentTarget.dataset.userId;
                const userToReset = state.users.find(u => u._id === userId);
                if (userToReset) resetUserPassword(userToReset);
            });
        });

        document.querySelectorAll(".delete-user-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const userId = e.currentTarget.dataset.userId;
                const userToDelete = state.users.find(u => u._id === userId);
                if (userToDelete) deleteUser(userToDelete);
            });
        });
    }

    function openUserModal(userToEdit = null, presetRole = null) {
        state.isEditing = !!userToEdit;

        if (userToEdit) {
            dom.userModal.querySelector(".modal-title").textContent = "Edit User";
            dom.saveUserBtn.textContent = "Update User";
            dom.userId.value = userToEdit._id;
            dom.userFullName.value = userToEdit.name;
            dom.userEmail.value = userToEdit.email;
            dom.userPassword.value = "";
            dom.userConfirmPassword.value = "";
            dom.userPassword.required = false;
            dom.userConfirmPassword.required = false;
            dom.userRole.value = userToEdit.role;
            dom.userDepartment.value = userToEdit.department || "";
            dom.userActive.value = userToEdit.isActive ? "true" : "false";
            if (userToEdit.role === "employee" && userToEdit.managerId) {
                dom.userManager.value = userToEdit.managerId._id || userToEdit.managerId;
            }
        } else {
            dom.userModal.querySelector(".modal-title").textContent = "Create User";
            dom.saveUserBtn.textContent = "Create User";
            dom.userForm.reset();
            dom.userId.value = "";
            dom.userPassword.required = true;
            dom.userConfirmPassword.required = true;
            if (presetRole) {
                dom.userRole.value = presetRole;
            }
        }

        updateManagerDropdown(dom.userDepartment.value);
        dom.managerAssignmentDiv.style.display = dom.userRole.value === "employee" ? "block" : "none";

        dom.userFormAlert.innerHTML = "";
        state.userModal = new bootstrap.Modal(dom.userModal);
        state.userModal.show();
    }

    async function saveUser() {
        const name = dom.userFullName.value.trim();
        const email = dom.userEmail.value.trim().toLowerCase();
        const password = dom.userPassword.value;
        const confirmPassword = dom.userConfirmPassword.value;
        const role = dom.userRole.value;
        const department = dom.userDepartment.value.trim();
        const isActive = dom.userActive.value === "true";
        const managerId = role === "employee" ? dom.userManager.value : null;

        // Validation
        if (!name || !email || !role) {
            showAlert("userFormAlert", "warning", "Please fill in all required fields");
            return;
        }

        if (!state.isEditing && !password) {
            showAlert("userFormAlert", "warning", "Password is required for new users");
            return;
        }

        if (password && password.length < 6) {
            showAlert("userFormAlert", "warning", "Password must be at least 6 characters");
            return;
        }

        if (password && password !== confirmPassword) {
            showAlert("userFormAlert", "warning", "Passwords do not match");
            return;
        }

        if (role === "employee" && !department) {
            showAlert("userFormAlert", "warning", "Department is required for employees");
            return;
        }

        if (role === "employee") {
            const departmentManagers = getManagersByDepartment(department);
            if (managerId) {
                if (!departmentManagers.some((m) => m._id === managerId)) {
                    showAlert("userFormAlert", "warning", "Assigned manager must be in the same department");
                    return;
                }
            } else if (departmentManagers.length > 0) {
                showAlert("userFormAlert", "warning", "Please assign an active manager for this department or create one first");
                return;
            }
        }

        try {
            if (window.AppUX) AppUX.setButtonLoading(dom.saveUserBtn, true, "Saving");
            else dom.saveUserBtn.disabled = true;
            const originalText = dom.saveUserBtn.textContent;
            if (!window.AppUX) dom.saveUserBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Saving...`;

            const endpoint = state.isEditing
                ? `/auth/admin/users/${dom.userId.value}`
                : `/auth/admin/users`;

            const method = state.isEditing ? "PUT" : "POST";

            const payload = {
                name,
                email,
                role,
                department,
                isActive,
                managerId: role === "employee" ? (managerId || null) : null,
                ...(password && { password, confirmPassword })
            };

            const response = await fetch(`${API_BASE}${endpoint}`, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${user?.token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || "Failed to save user");
            }

            showAlert("adminAlert", "success", `User ${state.isEditing ? "updated" : "created"} successfully`);
            state.userModal.hide();
            await fetchUsers();
        } catch (error) {
            showAlert("userFormAlert", "danger", error.message);
        } finally {
            if (window.AppUX) AppUX.setButtonLoading(dom.saveUserBtn, false);
            else {
                dom.saveUserBtn.disabled = false;
                dom.saveUserBtn.innerHTML = state.isEditing ? "Update User" : "Create User";
            }
        }
    }

    async function resetUserPassword(userToReset) {
        const newPassword = prompt(`Enter new password for ${userToReset.name}:`);
        if (!newPassword || newPassword.length < 6) {
            showAlert("adminAlert", "warning", "Password must be at least 6 characters");
            return;
        }

        const confirmPassword = prompt("Confirm new password:");
        if (confirmPassword !== newPassword) {
            showAlert("adminAlert", "warning", "Passwords do not match");
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/auth/admin/users/${userToReset._id}/reset-password`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${user?.token}`
                },
                body: JSON.stringify({ newPassword, confirmPassword })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || "Failed to reset password");
            }

            showAlert("adminAlert", "success", `Password reset successfully for ${userToReset.name}`);
        } catch (error) {
            showAlert("adminAlert", "danger", error.message);
        }
    }

    async function deleteUser(userToDelete) {
        const confirmed = window.AppUX
            ? await AppUX.confirm({
                title: "Delete user?",
                message: `${userToDelete.name} will be removed from the system. This action cannot be undone.`,
                confirmText: "Delete user",
                variant: "danger"
            })
            : confirm(`Are you sure you want to delete ${userToDelete.name}? This action cannot be undone.`);
        if (!confirmed) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE}/auth/admin/users/${userToDelete._id}`, {
                method: "DELETE",
                headers: {
                    "Authorization": `Bearer ${user?.token}`
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || "Failed to delete user");
            }

            showAlert("adminAlert", "success", `${userToDelete.name} has been deleted`);
            await fetchUsers();
        } catch (error) {
            showAlert("adminAlert", "danger", error.message);
        }
    }

    function setRoleFilter(role) {
        state.roleFilter = role;
        dom.roleFilterAdminBtn?.classList.toggle("active", role === "admin");
        dom.roleFilterManagerBtn?.classList.toggle("active", role === "manager");
        dom.roleFilterEmployeeBtn?.classList.toggle("active", role === "employee");
        renderUsersTable();
    }

    function attachEventListeners() {
        dom.userRole.addEventListener("change", () => {
            dom.managerAssignmentDiv.style.display = dom.userRole.value === "employee" ? "block" : "none";
            updateManagerDropdown(dom.userDepartment.value);
        });

        dom.userDepartment.addEventListener("input", () => {
            if (dom.userRole.value === "employee") {
                updateManagerDropdown(dom.userDepartment.value);
            }
        });

        dom.roleFilterAdminBtn?.addEventListener("click", () => setRoleFilter("admin"));
        dom.roleFilterManagerBtn?.addEventListener("click", () => setRoleFilter("manager"));
        dom.roleFilterEmployeeBtn?.addEventListener("click", () => setRoleFilter("employee"));

        dom.addUserBtn?.addEventListener("click", () => {
            openUserModal(null, state.roleFilter);
        });

        dom.saveUserBtn?.addEventListener("click", saveUser);
    }

    return {
        init: () => {
            attachEventListeners();
            fetchUsers();
        }
    };
})();

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    UserManager.init();
});
