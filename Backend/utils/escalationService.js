const Escalation = require("../models/Escalation");
const Goal = require("../models/Goal");
const GoalUpdate = require("../models/GoalUpdate");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { getMergedCycles } = require("./cycleRules");
const { notify } = require("./emailService");

const DEFAULT_PENDING_DAYS = Number(process.env.ESCALATION_PENDING_DAYS || 3);
const REMINDER_COOLDOWN_HOURS = Number(process.env.ESCALATION_REMINDER_COOLDOWN_HOURS || 24);

function daysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
}

async function upsertEscalation({ employee, manager, type, message, metadata = {} }) {
    const key = metadata.key || `${type}-${employee}`;
    const escalation = await Escalation.findOneAndUpdate(
        { employee, type, resolved: false, "metadata.key": key },
        {
            $setOnInsert: { employee, type, metadata: { ...metadata, key } },
            $set: { manager, message }
        },
        { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
    );

    const wasJustCreated = escalation.createdAt && (Date.now() - new Date(escalation.createdAt).getTime()) < 5000;
    if (wasJustCreated) {
        await AuditLog.create({
            userId: manager || employee,
            action: "Escalation created",
            entityType: "Escalation",
            entityId: escalation._id,
            newValue: { type, message, metadata: { ...metadata, key } }
        }).catch(() => {});
    }
    return escalation;
}

function canSendReminder(escalation) {
    if (!escalation) return false;
    if (!escalation.lastNotifiedAt) return true;
    return Date.now() - new Date(escalation.lastNotifiedAt).getTime() > REMINDER_COOLDOWN_HOURS * 60 * 60 * 1000;
}

async function runEscalationChecks() {
    const employees = await User.find({ role: "employee", isActive: true }).populate("managerId", "name email");
    const activeCycles = await getMergedCycles();
    const currentMonth = new Date().getMonth() + 1;
    const goalWindowOpen = activeCycles.find((cycle) => cycle.key === "goalSetting")?.openMonths?.includes(currentMonth);
    const activeQuarter = activeCycles.find((cycle) => ["Q1", "Q2", "Q3", "Q4"].includes(cycle.key) && cycle.openMonths.includes(currentMonth));
    const staleDate = daysAgo(DEFAULT_PENDING_DAYS);
    const created = [];

    for (const employee of employees) {
        const goals = await Goal.find({ employeeId: employee._id });
        const manager = employee.managerId?._id || null;

        if (goalWindowOpen && !goals.some((goal) => ["submitted", "approved"].includes(goal.status))) {
            created.push(await upsertEscalation({
                employee: employee._id,
                manager,
                type: "goal_not_submitted",
                message: `${employee.name} has not submitted goals during the active goal-setting window.`,
                metadata: { key: `goalSetting-${new Date().getFullYear()}` }
            }));
        }

        const pendingApproval = goals.find((goal) => goal.status === "submitted" && goal.updatedAt < staleDate);
        if (pendingApproval) {
            created.push(await upsertEscalation({
                employee: employee._id,
                manager,
                type: "approval_pending",
                message: `${employee.name}'s goal sheet has been pending manager approval for more than ${DEFAULT_PENDING_DAYS} day(s).`,
                metadata: { key: `approval-${pendingApproval._id}`, goalId: pendingApproval._id }
            }));
        }

        if (activeQuarter) {
            const approvedGoals = goals.filter((goal) => goal.status === "approved");
            if (approvedGoals.length) {
                const updates = await GoalUpdate.find({
                    goalId: { $in: approvedGoals.map((goal) => goal._id) },
                    quarter: activeQuarter.key
                });
                if (updates.length < approvedGoals.length) {
                    const escalation = await upsertEscalation({
                        employee: employee._id,
                        manager,
                        type: "quarterly_checkin_overdue",
                        message: `${employee.name} has overdue ${activeQuarter.key} achievement updates.`,
                        metadata: { key: `${activeQuarter.key}-${employee._id}`, quarter: activeQuarter.key }
                    });
                    created.push(escalation);

                    if (canSendReminder(escalation)) {
                        notify("quarterlyReminder", { employee, quarter: activeQuarter.key }, {
                            to: employee.email,
                            userId: employee._id,
                            entityType: "Escalation",
                            entityId: escalation._id
                        });
                        escalation.lastNotifiedAt = new Date();
                        escalation.notificationCount = Number(escalation.notificationCount || 0) + 1;
                        await escalation.save().catch(() => {});
                    }
                }
            }
        }
    }

    return created.filter(Boolean);
}

function startEscalationScheduler() {
    if (process.env.DISABLE_ESCALATION_SCHEDULER === "true") return;
    const run = () => runEscalationChecks().catch((error) => {
        console.error("Escalation scheduler failed:", error.message);
    });
    setTimeout(run, 5000);
    setInterval(run, 24 * 60 * 60 * 1000);
}

module.exports = {
    runEscalationChecks,
    startEscalationScheduler
};
