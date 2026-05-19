const nodemailer = require("nodemailer");
const AuditLog = require("../models/AuditLog");

let transporter;
const EMAIL_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 8000);
const NOTIFICATION_DEDUPE_MINUTES = Number(process.env.NOTIFICATION_DEDUPE_MINUTES || 30);

function isEmailConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
    if (!isEmailConfigured()) return null;
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
            connectionTimeout: EMAIL_TIMEOUT_MS,
            greetingTimeout: EMAIL_TIMEOUT_MS,
            socketTimeout: EMAIL_TIMEOUT_MS,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }
    return transporter;
}

function shell(title, preview, body) {
    return `
        <div style="font-family:Arial,sans-serif;background:#f4f6fb;padding:24px;color:#172033">
            <div style="max-width:640px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
                <div style="background:#111827;color:#fff;padding:18px 24px">
                    <h2 style="margin:0;font-size:20px">${title}</h2>
                    <p style="margin:6px 0 0;color:#d1d5db">${preview}</p>
                </div>
                <div style="padding:24px;line-height:1.55">${body}</div>
                <div style="padding:16px 24px;background:#f9fafb;color:#6b7280;font-size:12px">
                    Goal Tracker notification. Please sign in to view details.
                </div>
            </div>
        </div>`;
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

const templates = {
    goalSubmitted: ({ employee, manager, goals = [] }) => ({
        subject: `Goal sheet submitted by ${employee.name}`,
        html: shell(
            "Goal Sheet Submitted",
            `${escapeHtml(employee.name)} submitted goals for review.`,
            `<p>Hello ${escapeHtml(manager?.name || "Manager")},</p>
             <p>${escapeHtml(employee.name)} has submitted a goal sheet containing <strong>${goals.length}</strong> goal(s).</p>
             <p>Please review the sheet and approve it or return it for rework.</p>`
        )
    }),
    goalApproved: ({ employee, manager }) => ({
        subject: "Your goal sheet has been approved",
        html: shell(
            "Goal Sheet Approved",
            "Your goals are now locked for the cycle.",
            `<p>Hello ${escapeHtml(employee.name)},</p>
             <p>${escapeHtml(manager?.name || "Your manager")} approved your goal sheet. The approved goals are locked unless Admin unlocks them.</p>`
        )
    }),
    goalReturned: ({ employee, manager, notes }) => ({
        subject: "Your goal sheet was returned for rework",
        html: shell(
            "Goal Sheet Returned",
            "Please review manager notes and resubmit.",
            `<p>Hello ${escapeHtml(employee.name)},</p>
             <p>${escapeHtml(manager?.name || "Your manager")} returned your goal sheet for rework.</p>
             <p><strong>Notes:</strong> ${escapeHtml(notes || "No notes provided.")}</p>`
        )
    }),
    sharedGoalAssigned: ({ employee, sharedGoal }) => ({
        subject: `Shared KPI assigned: ${sharedGoal.title}`,
        html: shell(
            "Shared KPI Assigned",
            "A departmental KPI has been added to your goal sheet.",
            `<p>Hello ${escapeHtml(employee.name)},</p>
             <p>You have been assigned the shared KPI <strong>${escapeHtml(sharedGoal.title)}</strong>.</p>
             <p>The goal title and target are read-only. You may adjust only your assigned weightage before submission.</p>`
        )
    }),
    quarterlyReminder: ({ employee, quarter }) => ({
        subject: `${quarter} check-in reminder`,
        html: shell(
            "Quarterly Check-in Reminder",
            `Please update your ${quarter} progress.`,
            `<p>Hello ${escapeHtml(employee.name)},</p>
             <p>The ${escapeHtml(quarter)} achievement window is active. Please log actual achievement and progress status for your approved goals.</p>`
        )
    })
};

async function logNotification({ userId, entityType, entityId, template, to, status, error }) {
    await AuditLog.create({
        userId: userId || null,
        action: `Email notification ${status}`,
        entityType,
        entityId,
        newValue: {
            template,
            to,
            status,
            error: error ? String(error).slice(0, 500) : undefined
        }
    }).catch(() => {});
}

async function sendEmail({ to, subject, html, userId, entityType = "Notification", entityId = null, template }) {
    if (!to) return;
    const recentWindow = new Date(Date.now() - NOTIFICATION_DEDUPE_MINUTES * 60 * 1000);
    const duplicate = await AuditLog.findOne({
        action: { $in: ["Email notification sent", "Email notification skipped"] },
        entityType,
        entityId,
        "newValue.template": template,
        "newValue.to": to,
        createdAt: { $gte: recentWindow }
    }).lean().catch(() => null);

    if (duplicate) {
        await logNotification({ userId, entityType, entityId, template, to, status: "skipped", error: "Duplicate notification suppressed" });
        return;
    }

    const mailer = getTransporter();
    if (!mailer) {
        await logNotification({ userId, entityType, entityId, template, to, status: "skipped", error: "SMTP not configured" });
        return;
    }

    try {
        await mailer.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to,
            subject,
            html
        });
        await logNotification({ userId, entityType, entityId, template, to, status: "sent" });
    } catch (error) {
        await logNotification({ userId, entityType, entityId, template, to, status: "failed", error: error.message });
    }
}

function notify(template, data, options = {}) {
    setImmediate(async () => {
        try {
            const rendered = templates[template]?.(data);
            if (!rendered) return;
            await sendEmail({
                to: options.to,
                subject: rendered.subject,
                html: rendered.html,
                userId: options.userId,
                entityType: options.entityType,
                entityId: options.entityId,
                template
            });
        } catch (error) {
            await logNotification({
                userId: options.userId,
                entityType: options.entityType,
                entityId: options.entityId,
                template,
                to: options.to,
                status: "failed",
                error: error.message
            });
        }
    });
}

module.exports = {
    notify,
    sendEmail,
    templates,
    isEmailConfigured
};
