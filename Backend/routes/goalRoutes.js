const express = require("express");
const router = express.Router();

const Goal = require("../models/Goal");
const GoalUpdate = require("../models/GoalUpdate");
const AuditLog = require("../models/AuditLog");
const User = require("../models/User");
const { authenticate, authorizeRole } = require("../middleware/authMiddleware");
const { getCycleWindowError } = require("../utils/cycleRules");
const { notify } = require("../utils/emailService");
const {
    normalizeGoalDefinition,
    validateWeightage,
    totalWeightage
} = require("../utils/goalRules");

router.use(authenticate);

const MAX_GOALS_PER_EMPLOYEE = 8;
const LOCKED_GOAL_STATUSES = ["submitted", "approved"];

async function attachGoalProgress(goals) {
    const goalList = Array.isArray(goals) ? goals : [goals];
    const goalIds = goalList.map((goal) => goal._id);

    if (!goalIds.length) return goals;

    const updates = await GoalUpdate.find({ goalId: { $in: goalIds } }).sort({ updatedAt: -1 });
    const updatesByGoal = new Map();

    updates.forEach((update) => {
        const key = update.goalId.toString();
        if (!updatesByGoal.has(key)) updatesByGoal.set(key, []);
        updatesByGoal.get(key).push(update);
    });

    const withProgress = goalList.map((goal) => {
        const data = typeof goal.toObject === "function" ? goal.toObject() : goal;
        const goalUpdates = updatesByGoal.get(goal._id.toString()) || [];
        const latestUpdate = goalUpdates[0] || null;

        data.progress = latestUpdate ? Math.round(Number(latestUpdate.progressScore || 0) * 10) / 10 : 0;
        data.latestUpdate = latestUpdate;
        data.updateCount = goalUpdates.length;

        return data;
    });

    return Array.isArray(goals) ? withProgress : withProgress[0];
}

async function logAudit(userId, action, entityType, entityId, oldValue, newValue) {
    await AuditLog.create({
        userId,
        action,
        entityType,
        entityId,
        oldValue,
        newValue
    });
}

// CREATE GOAL
router.post("/create", async (req, res) => {

    try {

        const {
            employeeId,
            thrustArea,
            title,
            description,
            uomType,
            scoreType,
            deadline,
            target,
            weightage
        } = req.body;

        const windowError = await getCycleWindowError("goalSetting", "Goal setting");
        if (windowError) {
            return res.status(400).json({ message: windowError });
        }

        if (!employeeId || req.user.role === "employee") {
            if (!employeeId || employeeId !== req.user._id.toString()) {
                return res.status(403).json({ message: "Employees may only create their own goals" });
            }
        }

        if (req.user.role === "manager" && !req.user.isActive) {
            return res.status(403).json({ message: "Inactive manager cannot create goals" });
        }

        const employee = await User.findOne({ _id: employeeId, role: "employee", isActive: true });
        if (!employee) {
            return res.status(400).json({ message: "Active employee not found" });
        }

        if (req.user.role === "manager" && employee.managerId?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Managers may only create goals for their own team" });
        }

        if (!thrustArea || !title || !uomType || weightage === undefined) {
            return res.status(400).json({ message: "Thrust area, title, UoM, and weightage are required" });
        }

        const definition = normalizeGoalDefinition({
            uomType,
            scoreType,
            target,
            deadline
        });

        if (!definition.ok) {
            return res.status(400).json({ message: definition.message });
        }

        const weightageValidation = validateWeightage(weightage);
        if (!weightageValidation.ok) {
            return res.status(400).json({ message: weightageValidation.message });
        }

        // FETCH EMPLOYEE GOALS
        const existingGoals = await Goal.find({ employeeId });

        // CHECK IF ALREADY APPROVED/SUBMITTED/RETURNED
        const lockedGoal = existingGoals.find(
            goal => LOCKED_GOAL_STATUSES.includes(goal.status)
        );

        if (lockedGoal) {
            return res.status(400).json({
                message: "Goal sheet is locked after submission or approval"
            });
        }

        // VALIDATION: max 8 goals
        if (existingGoals.length >= MAX_GOALS_PER_EMPLOYEE) {
            return res.status(400).json({
                message: "Maximum 8 goals allowed"
            });
        }

        // TOTAL WEIGHTAGE CHECK
        const currentWeightage = totalWeightage(existingGoals);
        if (currentWeightage + weightageValidation.value > 100) {
            return res.status(400).json({
                message: "Total weightage cannot exceed 100%"
            });
        }

        // CREATE GOAL
        const goal = await Goal.create({
            employeeId,
            thrustArea,
            title,
            description,
            uomType: definition.normalized.uomType,
            scoreType: definition.normalized.scoreType,
            deadline: definition.normalized.deadline,
            target: definition.normalized.target,
            weightage: weightageValidation.value
        });

        res.status(201).json(goal);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});


// GET EMPLOYEE GOALS
router.get("/:employeeId", async (req, res) => {

    try {

        // Ensure employee exists and is active
        const employee = await User.findById(req.params.employeeId);

        if (!employee || !employee.isActive) {
            return res.status(404).json({ message: "Employee not found or inactive" });
        }

        if (req.user.role === "employee" && req.user._id.toString() !== req.params.employeeId) {
            return res.status(403).json({ message: "Employees may only view their own goals" });
        }

        if (req.user.role === "manager" && req.user._id.toString() !== employee.managerId?.toString()) {
            return res.status(403).json({ message: "Managers may only view their team goals" });
        }

        const goals = await Goal.find({ employeeId: req.params.employeeId });

        res.json(await attachGoalProgress(goals));

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

// SUBMIT GOALS
router.put("/submit/:employeeId", async (req, res) => {

    try {

        const employeeId = req.params.employeeId;

        const windowError = await getCycleWindowError("goalSetting", "Goal setting");
        if (windowError) {
            return res.status(400).json({ message: windowError });
        }

        if (req.user.role !== "employee" || req.user._id.toString() !== employeeId) {
            return res.status(403).json({ message: "Only the employee may submit their own goals" });
        }

        // FETCH GOALS
        const goals = await Goal.find({ employeeId });

        // CHECK IF GOALS EXIST
        if (goals.length === 0) {
            return res.status(400).json({
                message: "No goals found"
            });
        }

        // CALCULATE TOTAL WEIGHTAGE
        const sheetWeightage = totalWeightage(goals);

        // VALIDATION
        if (Math.abs(sheetWeightage - 100) > 0.01) {
            return res.status(400).json({
                message: "Total weightage must equal 100%"
            });
        }

        const submittableGoals = goals.filter((goal) => ["draft", "returned"].includes(goal.status));
        if (!submittableGoals.length) {
            return res.status(400).json({
                message: "No draft or returned goals available to submit"
            });
        }

        // UPDATE STATUS
        const oldValue = submittableGoals.map((goal) => ({
            goalId: goal._id,
            status: goal.status,
            weightage: goal.weightage,
            target: goal.target
        }));

        await Goal.updateMany(
            {
                employeeId,
                status: { $in: ["draft", "returned"] }
            },
            { status: "submitted" }
        );

        await logAudit(req.user._id, "Submitted Goals", "Goal", employeeId, oldValue, {
            status: "submitted",
            goalIds: submittableGoals.map((goal) => goal._id)
        });

        const employee = await User.findById(employeeId).populate("managerId", "name email");
        if (employee?.managerId?.email) {
            notify("goalSubmitted", {
                employee,
                manager: employee.managerId,
                goals: submittableGoals
            }, {
                to: employee.managerId.email,
                userId: req.user._id,
                entityType: "Goal",
                entityId: employeeId
            });
        }

        res.json({
            message: "Goals submitted successfully"
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

// APPROVE GOALS
router.put("/approve/:employeeId", authenticate, authorizeRole("manager"), async (req, res) => {

    try {

        const employeeId = req.params.employeeId;
        const employee = await User.findById(employeeId);

        const windowError = await getCycleWindowError("goalSetting", "Goal setting");
        if (windowError) {
            return res.status(400).json({ message: windowError });
        }

        if (!employee || employee.managerId?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Manager may only approve goals for their own team" });
        }

        const goals = await Goal.find({ employeeId });
        if (!goals.length) {
            return res.status(400).json({ message: "No goals found" });
        }

        const sheetWeightage = totalWeightage(goals);
        if (Math.abs(sheetWeightage - 100) > 0.01) {
            return res.status(400).json({ message: "Total weightage must equal 100% before approval" });
        }

        if (!goals.some((goal) => goal.status === "submitted")) {
            return res.status(400).json({ message: "No submitted goals available to approve" });
        }

        if (goals.some((goal) => !["submitted", "approved"].includes(goal.status))) {
            return res.status(400).json({ message: "Only submitted goal changes can be approved" });
        }

        const submittedGoals = goals.filter((goal) => goal.status === "submitted");
        const oldValue = submittedGoals.map((goal) => ({
            goalId: goal._id,
            status: goal.status,
            weightage: goal.weightage,
            target: goal.target
        }));

        await Goal.updateMany(
            {
                employeeId,
                status: "submitted"
            },
            {
                status: "approved"
            }
        );

        await logAudit(req.user._id, "Approved Goals", "Goal", employeeId, oldValue, {
            status: "approved",
            goalIds: submittedGoals.map((goal) => goal._id)
        });

        notify("goalApproved", {
            employee,
            manager: req.user
        }, {
            to: employee.email,
            userId: req.user._id,
            entityType: "Goal",
            entityId: employeeId
        });

        res.json({
            message: "Goals approved successfully"
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

// RETURN GOALS FOR REWORK
router.put("/return/:employeeId", authenticate, authorizeRole("manager", "admin"), async (req, res) => {

    try {

        const employeeId = req.params.employeeId;
        const { managerNotes } = req.body || {};
        const employee = await User.findById(employeeId);

        if (req.user.role === "manager") {
            const windowError = await getCycleWindowError("goalSetting", "Goal setting");
            if (windowError) {
                return res.status(400).json({ message: windowError });
            }
        }

        if (!employee) {
            return res.status(404).json({ message: "Employee not found" });
        }

        if (req.user.role === "manager" && employee.managerId?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Manager may only return goals for their own team" });
        }

        const allowedCurrentStatus = req.user.role === "admin" ? "approved" : "submitted";
        const goalsToReturn = await Goal.find({ employeeId, status: allowedCurrentStatus });

        if (!goalsToReturn.length) {
            return res.status(400).json({
                message: req.user.role === "admin"
                    ? "No approved goals are available to unlock"
                    : "No submitted goals are available to return"
            });
        }

        await Goal.updateMany(
            {
                employeeId,
                status: allowedCurrentStatus
            },
            {
                status: "returned",
                managerNotes: managerNotes || null
            }
        );

        await logAudit(
            req.user._id,
            req.user.role === "admin" ? "Unlocked approved goals" : "Returned goals for rework",
            "Goal",
            employeeId,
            goalsToReturn.map((goal) => ({
                goalId: goal._id,
                status: goal.status,
                managerNotes: goal.managerNotes
            })),
            {
                status: "returned",
                managerNotes: managerNotes || null,
                goalIds: goalsToReturn.map((goal) => goal._id)
            }
        );

        notify("goalReturned", {
            employee,
            manager: req.user,
            notes: managerNotes
        }, {
            to: employee.email,
            userId: req.user._id,
            entityType: "Goal",
            entityId: employeeId
        });

        res.json({
            message: req.user.role === "admin" ? "Goal sheet unlocked for rework" : "Goals returned for rework"
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

// ADMIN UNLOCK APPROVED GOALS
router.put("/unlock/:employeeId", authenticate, authorizeRole("admin"), async (req, res) => {

    try {

        const employeeId = req.params.employeeId;
        const employee = await User.findOne({ _id: employeeId, role: "employee", isActive: true });

        if (!employee) {
            return res.status(404).json({ message: "Active employee not found" });
        }

        const approvedGoals = await Goal.find({ employeeId, status: "approved" });

        if (!approvedGoals.length) {
            return res.status(400).json({ message: "No approved goals are available to unlock" });
        }

        await Goal.updateMany(
            {
                employeeId,
                status: "approved"
            },
            {
                status: "returned",
                managerNotes: "Unlocked by Admin for corrections"
            }
        );

        await logAudit(
            req.user._id,
            "Unlocked approved goals",
            "Goal",
            employeeId,
            approvedGoals.map((goal) => ({
                goalId: goal._id,
                status: goal.status,
                managerNotes: goal.managerNotes
            })),
            {
                status: "returned",
                managerNotes: "Unlocked by Admin for corrections",
                goalIds: approvedGoals.map((goal) => goal._id)
            }
        );

        res.json({
            message: "Goal sheet unlocked successfully. Employee can edit and resubmit."
        });

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

// UPDATE GOAL WEIGHTAGES AND TARGETS (Manager)
router.put("/update-weightages/:employeeId", authenticate, authorizeRole("manager"), async (req, res) => {

    try {

        const employeeId = req.params.employeeId;
        const employee = await User.findById(employeeId);

        const windowError = await getCycleWindowError("goalSetting", "Goal setting");
        if (windowError) {
            return res.status(400).json({ message: windowError });
        }

        if (!employee || employee.managerId?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Manager may only update goals for their own team" });
        }

        const { goals: goalUpdates } = req.body;

        if (!Array.isArray(goalUpdates) || goalUpdates.length === 0) {
            return res.status(400).json({ message: "No goal updates provided" });
        }

        const goalIds = goalUpdates.map((item) => item.goalId);
        const employeeGoals = await Goal.find({ employeeId });
        const goals = await Goal.find({ _id: { $in: goalIds }, employeeId });

        if (goals.length !== goalUpdates.length) {
            return res.status(400).json({ message: "One or more goals are invalid or not part of this employee's sheet" });
        }

        if (employeeGoals.length !== goalUpdates.length) {
            return res.status(400).json({ message: "All goals in the employee sheet must be included when updating weightages" });
        }

        if (employeeGoals.some((goal) => goal.status !== "submitted")) {
            return res.status(400).json({ message: "Manager inline edits are only allowed while the goal sheet is submitted and pending approval" });
        }

        const totalWeightage = goalUpdates.reduce((sum, item) => sum + Number(item.weightage || 0), 0);
        if (Math.abs(totalWeightage - 100) > 0.01) {
            return res.status(400).json({ message: `Total weightage must equal 100%, got ${totalWeightage.toFixed(1)}%` });
        }

        for (const update of goalUpdates) {
            const goal = goals.find((g) => g._id.toString() === update.goalId);
            if (!goal) continue;

            const updates = {};
            if (update.weightage !== undefined) {
                const weightageValidation = validateWeightage(update.weightage);
                if (!weightageValidation.ok) {
                    return res.status(400).json({ message: weightageValidation.message });
                }
                updates.weightage = weightageValidation.value;
            }

            if (update.target !== undefined) {
                if (goal.sharedGoalId) {
                    return res.status(400).json({ message: "Shared goals may not have their target edited" });
                }
                const definition = normalizeGoalDefinition({
                    uomType: goal.uomType,
                    scoreType: goal.scoreType,
                    deadline: goal.deadline,
                    target: update.target
                });
                if (!definition.ok) {
                    return res.status(400).json({ message: definition.message });
                }
                updates.target = definition.normalized.target;
            }

            if (Object.keys(updates).length > 0) {
                const oldValue = {
                    goalId: goal._id,
                    target: goal.target,
                    weightage: goal.weightage,
                    status: goal.status
                };
                const updatedGoal = await Goal.findByIdAndUpdate(goal._id, updates, { returnDocument: "after" });
                await logAudit(req.user._id, "Manager edited submitted goal", "Goal", goal._id, oldValue, {
                    goalId: updatedGoal._id,
                    target: updatedGoal.target,
                    weightage: updatedGoal.weightage,
                    status: updatedGoal.status
                });
            }
        }

        res.json({ message: "Goal sheet updated successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// UPDATE A GOAL
router.put("/update/:goalId", async (req, res) => {
    try {
        const goalId = req.params.goalId;
        const goal = await Goal.findById(goalId);

        if (!goal) {
            return res.status(404).json({ message: "Goal not found" });
        }

        if (req.user.role === "employee" && goal.employeeId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Employees may only edit their own goals" });
        }

        if (req.user.role === "manager") {
            const employee = await User.findById(goal.employeeId);
            if (!employee || employee.managerId?.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: "Managers may only edit goals for their own team" });
            }
        }

        if (req.user.role === "employee" && !["draft", "returned"].includes(goal.status)) {
            return res.status(400).json({ message: "Only draft or returned goals can be edited by employees" });
        }

        if (req.user.role === "manager" && goal.status !== "submitted") {
            return res.status(400).json({ message: "Managers may only edit submitted goals during approval" });
        }

        if (req.user.role === "admin") {
            return res.status(400).json({ message: "Admins must unlock approved goals before goal edits are made" });
        }

        const windowError = await getCycleWindowError("goalSetting", "Goal setting");
        if (windowError) {
            return res.status(400).json({ message: windowError });
        }

        const {
            thrustArea,
            title,
            description,
            uomType,
            scoreType,
            deadline,
            target,
            weightage
        } = req.body;

        const updateFields = {};

        if (goal.sharedGoalId) {
            if (
                thrustArea !== undefined ||
                title !== undefined ||
                description !== undefined ||
                uomType !== undefined ||
                scoreType !== undefined ||
                deadline !== undefined ||
                target !== undefined
            ) {
                return res.status(400).json({ message: "Shared goals may only have weightage updated" });
            }
        } else {
            if (thrustArea !== undefined) updateFields.thrustArea = thrustArea;
            if (title !== undefined) updateFields.title = title;
            if (description !== undefined) updateFields.description = description;

            const definitionChanged = [uomType, scoreType, deadline, target].some((value) => value !== undefined);
            if (definitionChanged) {
                const definition = normalizeGoalDefinition({
                    uomType: uomType !== undefined ? uomType : goal.uomType,
                    scoreType: scoreType !== undefined ? scoreType : goal.scoreType,
                    deadline: deadline !== undefined ? deadline : goal.deadline,
                    target: target !== undefined ? target : goal.target
                });

                if (!definition.ok) {
                    return res.status(400).json({ message: definition.message });
                }

                updateFields.uomType = definition.normalized.uomType;
                updateFields.scoreType = definition.normalized.scoreType;
                updateFields.deadline = definition.normalized.deadline;
                updateFields.target = definition.normalized.target;
            }
        }

        if (weightage !== undefined) {
            const weightageValidation = validateWeightage(weightage);
            if (!weightageValidation.ok) {
                return res.status(400).json({ message: weightageValidation.message });
            }
            const existingGoals = await Goal.find({ employeeId: goal.employeeId, _id: { $ne: goal._id } });
            const otherGoalWeightage = totalWeightage(existingGoals);
            if (otherGoalWeightage + weightageValidation.value > 100) {
                return res.status(400).json({ message: "Total weightage cannot exceed 100%" });
            }
            updateFields.weightage = weightageValidation.value;
        }

        const oldValue = {
            thrustArea: goal.thrustArea,
            title: goal.title,
            description: goal.description,
            uomType: goal.uomType,
            scoreType: goal.scoreType,
            deadline: goal.deadline,
            target: goal.target,
            weightage: goal.weightage,
            status: goal.status
        };
        const updatedGoal = await Goal.findByIdAndUpdate(goalId, updateFields, { returnDocument: "after" });

        if (LOCKED_GOAL_STATUSES.includes(goal.status) || req.user.role === "manager") {
            await logAudit(req.user._id, "Updated goal after submission", "Goal", goal._id, oldValue, {
                thrustArea: updatedGoal.thrustArea,
                title: updatedGoal.title,
                description: updatedGoal.description,
                uomType: updatedGoal.uomType,
                scoreType: updatedGoal.scoreType,
                deadline: updatedGoal.deadline,
                target: updatedGoal.target,
                weightage: updatedGoal.weightage,
                status: updatedGoal.status
            });
        }

        res.json(updatedGoal);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// DELETE A GOAL
router.delete("/delete/:goalId", async (req, res) => {
    try {
        const goalId = req.params.goalId;
        const goal = await Goal.findById(goalId);

        if (!goal) {
            return res.status(404).json({ message: "Goal not found" });
        }

        if (req.user.role === "employee" && goal.employeeId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Employees may only delete their own goals" });
        }

        if (req.user.role === "manager") {
            const employee = await User.findById(goal.employeeId);
            if (!employee || employee.managerId?.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: "Managers may only delete draft goals for their own team" });
            }
        }

        const windowError = await getCycleWindowError("goalSetting", "Goal setting");
        if (windowError) {
            return res.status(400).json({ message: windowError });
        }

        if (!["draft", "returned"].includes(goal.status)) {
            return res.status(400).json({ message: "Only draft or returned goals may be deleted" });
        }

        await Goal.findByIdAndDelete(goalId);
        res.json({ message: "Goal deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET ALL GOALS (with populated employee info to check isActive)
router.get("/", async (req, res) => {

    try {

        const { managerId } = req.query;

        let query = {};

        if (req.user.role === "manager") {
            const managerEmployees = await User.find({ managerId: req.user._id });
            const employeeIds = managerEmployees.map(emp => emp._id);
            query = { employeeId: { $in: employeeIds } };
        } else if (req.user.role === "employee") {
            query = { employeeId: req.user._id };
        } else if (req.user.role === "admin" && managerId) {
            const managerEmployees = await User.find({ managerId });
            const employeeIds = managerEmployees.map(emp => emp._id);
            query = { employeeId: { $in: employeeIds } };
        }

        const goals = await Goal.find(query)
            .populate({
                path: "employeeId",
                populate: {
                    path: "managerId",
                    select: "name email"
                }
            });

        // Filter out goals from deleted (inactive) users
        const filtered = goals.filter(g => g.employeeId && g.employeeId.isActive);

        res.json(await attachGoalProgress(filtered));

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

module.exports = router;
