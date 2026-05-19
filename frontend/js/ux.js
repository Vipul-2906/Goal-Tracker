(function () {
    function ensureToastHost() {
        let host = document.getElementById("appToastHost");
        if (!host) {
            host = document.createElement("div");
            host.id = "appToastHost";
            host.className = "toast-container position-fixed top-0 end-0 p-3";
            host.style.zIndex = "1080";
            document.body.appendChild(host);
        }
        return host;
    }

    function toast(type, message, options = {}) {
        const host = ensureToastHost();
        const variant = {
            success: "success",
            error: "danger",
            danger: "danger",
            warning: "warning",
            info: "primary"
        }[type] || "primary";
        const title = options.title || {
            success: "Success",
            error: "Something went wrong",
            danger: "Something went wrong",
            warning: "Needs attention",
            info: "Update"
        }[type] || "Update";
        const toastEl = document.createElement("div");
        toastEl.className = "toast app-toast border-0 shadow";
        toastEl.setAttribute("role", "status");
        toastEl.setAttribute("aria-live", "polite");
        toastEl.innerHTML = `
            <div class="toast-header border-0">
                <span class="app-toast-dot bg-${variant}"></span>
                <strong class="me-auto">${escapeHtml(title)}</strong>
                <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">${escapeHtml(message)}</div>
        `;
        host.appendChild(toastEl);
        const instance = bootstrap.Toast.getOrCreateInstance(toastEl, {
            autohide: options.autohide !== false,
            delay: options.delay || 4200
        });
        toastEl.addEventListener("hidden.bs.toast", () => toastEl.remove());
        instance.show();
    }

    function setButtonLoading(button, loading = true, text = "Working") {
        if (!button) return;
        if (loading) {
            if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
            button.disabled = true;
            button.innerHTML = `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>${escapeHtml(text)}`;
        } else {
            button.disabled = false;
            if (button.dataset.originalHtml) {
                button.innerHTML = button.dataset.originalHtml;
                delete button.dataset.originalHtml;
            }
        }
    }

    function tableLoading(colspan, message = "Loading...") {
        return `
            <tr>
                <td colspan="${colspan}" class="text-center py-5">
                    <div class="spinner-border text-primary" role="status" aria-label="${escapeHtml(message)}"></div>
                    <div class="mt-3 text-muted">${escapeHtml(message)}</div>
                </td>
            </tr>
        `;
    }

    function emptyState(title, message, icon = "bi-inbox") {
        return `
            <div class="empty-state">
                <i class="bi ${icon}"></i>
                <div class="empty-state-title">${escapeHtml(title)}</div>
                <div class="empty-state-text">${escapeHtml(message)}</div>
            </div>
        `;
    }

    function tableEmpty(colspan, title, message, icon = "bi-inbox") {
        return `<tr><td colspan="${colspan}">${emptyState(title, message, icon)}</td></tr>`;
    }

    function confirmDialog({
        title = "Confirm action",
        message = "Are you sure?",
        confirmText = "Confirm",
        cancelText = "Cancel",
        variant = "primary"
    } = {}) {
        return new Promise((resolve) => {
            const modal = document.createElement("div");
            modal.className = "modal fade";
            modal.tabIndex = -1;
            modal.innerHTML = `
                <div class="modal-dialog modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">${escapeHtml(title)}</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <p class="mb-0">${escapeHtml(message)}</p>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">${escapeHtml(cancelText)}</button>
                            <button type="button" class="btn btn-${variant}" data-confirm>${escapeHtml(confirmText)}</button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
            const instance = bootstrap.Modal.getOrCreateInstance(modal, { backdrop: "static" });
            let decided = false;
            modal.querySelector("[data-confirm]").addEventListener("click", () => {
                decided = true;
                resolve(true);
                instance.hide();
            });
            modal.addEventListener("hidden.bs.modal", () => {
                if (!decided) resolve(false);
                modal.remove();
            });
            instance.show();
        });
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    window.AppUX = {
        toast,
        setButtonLoading,
        tableLoading,
        emptyState,
        tableEmpty,
        confirm: confirmDialog,
        escapeHtml
    };
})();
