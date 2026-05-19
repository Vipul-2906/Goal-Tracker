const express = require("express");
const router = express.Router();

const Goal = require("../models/Goal");
const GoalUpdate = require("../models/GoalUpdate");
const User = require("../models/User");
const { authenticate, authorizeRole } = require("../middleware/authMiddleware");
const { getMergedCycles } = require("../utils/cycleRules");

router.use(authenticate, authorizeRole("admin"));

function csvEscape(value) {
    if (value === null || value === undefined) return "";
    return `"${String(value).replace(/"/g, '""')}"`;
}

function toCsv(rows) {
    const columns = [
        ["employee", "Employee"],
        ["employeeEmail", "Employee Email"],
        ["manager", "Manager"],
        ["goal", "Goal"],
        ["quarter", "Quarter"],
        ["plannedTarget", "Planned Target"],
        ["actualAchievement", "Actual Achievement"],
        ["progressStatus", "Progress Status"],
        ["progressScore", "Progress Score"],
        ["managerComment", "Manager Comment"],
        ["managerCheckInCompleted", "Manager Check-in Completed"]
    ];

    const header = columns.map(([, label]) => csvEscape(label)).join(",");
    const body = rows.map((row) =>
        columns.map(([key]) => csvEscape(row[key])).join(",")
    );

    return [header, ...body].join("\n");
}


// ACHIEVEMENT REPORT
router.get("/achievement", async (req, res) => {

    try {

        const updates = await GoalUpdate.find()
            .populate({
                path: "goalId",
                populate: {
                    path: "employeeId",
                    model: "User",
                    populate: {
                        path: "managerId",
                        select: "name email"
                    }
                }
            });

        // Filter out updates for inactive/deleted users
        const activeUpdates = updates.filter(u => u.goalId && u.goalId.employeeId && u.goalId.employeeId.isActive);

        const report = activeUpdates.map(update => {
            const goal = update.goalId;
            const plannedTarget = goal.scoreType === "timeline" && goal.deadline
                ? new Date(goal.deadline).toISOString().slice(0, 10)
                : update.plannedTarget;

            return {
                employee: goal.employeeId.name,
                employeeEmail: goal.employeeId.email,
                manager: goal.employeeId.managerId?.name || "Unassigned",
                goal: goal.title,
                quarter: update.quarter,
                plannedTarget,
                actualAchievement: update.actualAchievement,
                progressStatus: update.progressStatus,
                progressScore: update.progressScore,
                managerComment: update.managerComment || "",
                managerCheckInCompleted: Boolean(update.managerCommentedAt || update.managerComment)
            };
        });

        if (String(req.query.format || "").toLowerCase() === "csv") {
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="achievement_report_${new Date().toISOString().slice(0, 10)}.csv"`);
            return res.send(toCsv(report));
        }

        res.json(report);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

// COMPLETION DASHBOARD
router.get("/completion-dashboard",
async (req, res) => {

    try {

        const [employees, goals, updates, cycles] = await Promise.all([
            User.find({ role: "employee", isActive: true }).populate("managerId", "name email"),
            Goal.find().populate({
                path: "employeeId",
                populate: {
                    path: "managerId",
                    select: "name email"
                }
            }),
            GoalUpdate.find(),
            getMergedCycles()
        ]);

        const activeGoals = goals.filter((goal) => goal.employeeId && goal.employeeId.isActive);
        const approvedGoals = activeGoals.filter((goal) => goal.status === "approved");
        const activeGoalIds = activeGoals.map((goal) => goal._id.toString());
        const activeUpdates = updates.filter((update) => update.goalId && activeGoalIds.includes(update.goalId.toString()));

        const completedUpdates = activeUpdates.filter((update) => update.progressStatus === "Completed").length;
        const onTrackUpdates = activeUpdates.filter((update) => update.progressStatus === "On Track").length;
        const notStartedUpdates = activeUpdates.filter((update) => update.progressStatus === "Not Started").length;

        const quarters = cycles.filter((cycle) => ["Q1", "Q2", "Q3", "Q4"].includes(cycle.key)).map((cycle) => cycle.key);
        const goalsByEmployee = new Map();
        approvedGoals.forEach((goal) => {
            const employeeId = goal.employeeId._id.toString();
            if (!goalsByEmployee.has(employeeId)) goalsByEmployee.set(employeeId, []);
            goalsByEmployee.get(employeeId).push(goal);
        });

        const updatesByGoalQuarter = new Map();
        activeUpdates.forEach((update) => {
            updatesByGoalQuarter.set(`${update.goalId.toString()}-${update.quarter}`, update);
        });

        const employeeQuarterStatus = [];
        const managerSummary = new Map();

        employees.forEach((employee) => {
            const employeeGoals = goalsByEmployee.get(employee._id.toString()) || [];
            quarters.forEach((quarter) => {
                const quarterUpdates = employeeGoals
                    .map((goal) => updatesByGoalQuarter.get(`${goal._id.toString()}-${quarter}`))
                    .filter(Boolean);
                const employeeUpdated = employeeGoals.length > 0 && quarterUpdates.length === employeeGoals.length;
                const managerCheckInCompleted = employeeUpdated && quarterUpdates.every((update) => update.managerCommentedAt || update.managerComment);
                const managerId = employee.managerId?._id?.toString() || "unassigned";

                employeeQuarterStatus.push({
                    employeeId: employee._id,
                    employeeName: employee.name,
                    managerId,
                    managerName: employee.managerId?.name || "Unassigned",
                    quarter,
                    approvedGoalCount: employeeGoals.length,
                    updateCount: quarterUpdates.length,
                    employeeUpdated,
                    managerCheckInCompleted
                });

                if (!managerSummary.has(managerId)) {
                    managerSummary.set(managerId, {
                        managerId,
                        managerName: employee.managerId?.name || "Unassigned",
                        totalCheckIns: 0,
                        completedCheckIns: 0
                    });
                }
                const managerRecord = managerSummary.get(managerId);
                managerRecord.totalCheckIns += 1;
                if (managerCheckInCompleted) managerRecord.completedCheckIns += 1;
            });
        });

        res.json({

            totalGoals: activeGoals.length,

            completedUpdates,

            onTrackUpdates,

            notStartedUpdates,

            employeeQuarterStatus,

            managerSummary: Array.from(managerSummary.values()).map((record) => ({
                ...record,
                completionRate: record.totalCheckIns
                    ? Math.round((record.completedCheckIns / record.totalCheckIns) * 100)
                    : 0
            }))

        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

module.exports = router;
