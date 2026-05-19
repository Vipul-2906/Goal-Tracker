const express = require("express");
const router = express.Router();

const Goal = require("../models/Goal");
const GoalUpdate = require("../models/GoalUpdate");
const SharedGoal = require("../models/SharedGoal");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const { authenticate, authorizeRole } = require("../middleware/authMiddleware");
const { getCycleWindowError } = require("../utils/cycleRules");
const { calculateProgressScore } = require("../utils/goalRules");

router.use(authenticate);

const VALID_PROGRESS_STATUSES = ["Not Started", "On Track", "Completed"];

async function canReadGoal(user, goal) {
    if (!goal) return false;

    if (user.role === "admin") return true;

    if (user.role === "employee" && goal.employeeId.toString() === user._id.toString()) {
        return true;
    }

    const employee = await User.findById(goal.employeeId);
    if (user.role === "manager" && employee?.managerId?.toString() === user._id.toString()) {
        return true;
    }

    if (goal.sharedGoalId) {
        const sharedGoal = await SharedGoal.findById(goal.sharedGoalId);
        return Boolean(sharedGoal && sharedGoal.primaryOwnerId.toString() === user._id.toString());
    }

    return false;
}

// CREATE QUARTERLY UPDATE
router.post("/create", async (req, res) => {

    try {

        const {
            goalId,
            quarter,
            progressStatus,
            employeeComment
        } = req.body;

        if (!["Q1", "Q2", "Q3", "Q4"].includes(quarter)) {
            return res.status(400).json({ message: "Valid quarter is required" });
        }

        if (!VALID_PROGRESS_STATUSES.includes(progressStatus)) {
            return res.status(400).json({ message: "Valid progress status is required" });
        }

        const actual = req.body.actualAchievement ?? req.body.actual;

        if (actual === undefined || actual === null || actual === "") {
            return res.status(400).json({ message: "Actual achievement is required" });
        }

        const actualAchievementValue = Number(actual);
        if (Number.isNaN(actualAchievementValue)) {
            return res.status(400).json({ message: "Actual achievement must be a valid number" });
        }

        const windowError = await getCycleWindowError(quarter, `Quarter ${quarter}`);
        if (windowError) {
            return res.status(400).json({ message: windowError });
        }

        // FETCH GOAL
        const goal = await Goal.findById(goalId);
        if (!goal) {
            return res.status(404).json({ message: "Goal not found" });
        }

        if (goal.status !== "approved") {
            return res.status(400).json({ message: "Achievement updates can only be added after goals are approved" });
        }

        if (goal.sharedGoalId) {
            const sharedGoal = await SharedGoal.findById(goal.sharedGoalId);
            if (!sharedGoal) {
                return res.status(404).json({ message: "Shared goal master record not found" });
            }
            if (req.user._id.toString() !== sharedGoal.primaryOwnerId.toString()) {
                return res.status(403).json({ message: "Only the shared goal owner may create achievement updates for this goal" });
            }
        } else {
            if (req.user.role !== "employee" || req.user._id.toString() !== goal.employeeId.toString()) {
                return res.status(403).json({ message: "Only the employee may create updates for their own goals" });
            }
        }

        if (actualAchievementValue < 0) {
            return res.status(400).json({ message: "Actual achievement must be non-negative" });
        }

        // PREVENT DUPLICATE QUARTER ENTRIES
        const existingUpdate = await GoalUpdate.findOne({
            goalId,
            quarter
        });

        if (existingUpdate) {
            return res.status(400).json({ message: "Quarter update already exists" });
        }

        const scoreResult = calculateProgressScore(goal, {
            actualAchievement: actualAchievementValue,
            completionDate: req.body.completionDate
        });

        if (!scoreResult.ok) {
            return res.status(400).json({ message: scoreResult.message });
        }

        const progressScore = scoreResult.progressScore;

        const updatePayload = {
            goalId,
            quarter,
            plannedTarget: goal.target,
            actualAchievement: actualAchievementValue,
            completionDate: req.body.completionDate || null,
            progressStatus,
            progressScore,
            employeeComment
        };

        const update = await GoalUpdate.findOneAndUpdate(
            { goalId, quarter },
            { $setOnInsert: updatePayload },
            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
        );

        if (goal.sharedGoalId) {
            const siblingGoals = await Goal.find({
                sharedGoalId: goal.sharedGoalId,
                _id: { $ne: goal._id },
                status: "approved"
            });

            if (siblingGoals.length) {
                await GoalUpdate.bulkWrite(siblingGoals.map((siblingGoal) => ({
                    updateOne: {
                        filter: { goalId: siblingGoal._id, quarter },
                        update: {
                            $set: {
                                goalId: siblingGoal._id,
                                quarter,
                                plannedTarget: siblingGoal.target,
                                actualAchievement: actualAchievementValue,
                                completionDate: req.body.completionDate || null,
                                progressStatus,
                                progressScore,
                                employeeComment
                            }
                        },
                        upsert: true
                    }
                })), { ordered: true });
            }
        }

        await AuditLog.create({
            userId: req.user._id,
            action: "Created quarterly achievement update",
            entityType: "GoalUpdate",
            entityId: update._id,
            newValue: {
                goalId,
                quarter,
                actualAchievement: actualAchievementValue,
                completionDate: req.body.completionDate || null,
                progressStatus,
                progressScore
            }
        });

        if (goal.sharedGoalId) {
            await AuditLog.create({
                userId: req.user._id,
                action: "Synchronized shared goal achievement update",
                entityType: "SharedGoal",
                entityId: goal.sharedGoalId,
                newValue: {
                    sourceGoalId: goalId,
                    quarter,
                    actualAchievement: actualAchievementValue,
                    progressStatus
                }
            });
        }

        res.status(201).json(update);

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// MANAGER TEAM VIEW
router.get("/manager/team/:managerId", authorizeRole("manager"), async (req, res) => {

    try {

        if (req.user._id.toString() !== req.params.managerId) {
            return res.status(403).json({ message: "Managers may only view their own team updates" });
        }

        // FETCH EMPLOYEES UNDER MANAGER (only active employees)
        const employees = await User.find({
            managerId: req.params.managerId,
            isActive: true
        });

        const employeeIds =
            employees.map(emp => emp._id);

        // FETCH GOALS
        const goals = await Goal.find({
            employeeId: { $in: employeeIds }
        });

        const goalIds =
            goals.map(goal => goal._id);

        // FETCH UPDATES
        const updates = await GoalUpdate.find({
            goalId: { $in: goalIds }
        });

        res.json(updates);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

// GET ALL UPDATES FOR A GOAL
router.get("/:goalId", async (req, res) => {

    try {
        const goal = await Goal.findById(req.params.goalId);
        if (!goal) {
            return res.status(404).json({ message: "Goal not found" });
        }

        if (!(await canReadGoal(req.user, goal))) {
            return res.status(403).json({ message: "You do not have access to these updates" });
        }

        const updates = await GoalUpdate.find({
            goalId: req.params.goalId
        }).sort({ createdAt: -1 });

        res.json(updates);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

// ADD MANAGER COMMENT
router.put("/comment/:updateId", authorizeRole("manager"), async (req, res) => {

    try {

        const managerComment = req.body.managerComment ?? req.body.comment ?? req.body.checkInComment ?? "";
        const existingUpdate = await GoalUpdate.findById(req.params.updateId);

        if (!existingUpdate) {
            return res.status(404).json({ message: "Quarterly update not found" });
        }

        const goal = await Goal.findById(existingUpdate.goalId);
        const employee = goal ? await User.findById(goal.employeeId) : null;

        if (!goal || !employee || employee.managerId?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Managers may only comment on their own team check-ins" });
        }

        const update = await GoalUpdate.findByIdAndUpdate(

            req.params.updateId,

            {
                managerComment,
                managerId: req.user._id,
                managerCommentedAt: new Date()
            },

            { returnDocument: "after" }

        );

        await AuditLog.create({
            userId: req.user._id,
            action: "Completed manager check-in comment",
            entityType: "GoalUpdate",
            entityId: update._id,
            oldValue: {
                managerComment: existingUpdate.managerComment,
                managerId: existingUpdate.managerId,
                managerCommentedAt: existingUpdate.managerCommentedAt
            },
            newValue: {
                managerComment: update.managerComment,
                managerId: update.managerId,
                managerCommentedAt: update.managerCommentedAt
            }
        });

        res.json(update);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

module.exports = router;
