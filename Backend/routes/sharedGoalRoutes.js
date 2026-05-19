const express = require("express");
const router = express.Router();

const SharedGoal = require("../models/SharedGoal");
const Goal = require("../models/Goal");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
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

async function validateAssignableGoalSheet(employeeId, incomingWeightage) {
    const existingGoals = await Goal.find({ employeeId });
    const lockedGoal = existingGoals.find((goal) =>
        ["submitted", "approved"].includes(goal.status)
    );

    if (lockedGoal) {
        return {
            valid: false,
            message: "Cannot assign shared goals to a locked goal sheet"
        };
    }

    if (existingGoals.length >= MAX_GOALS_PER_EMPLOYEE) {
        return {
            valid: false,
            message: "Maximum 8 goals allowed"
        };
    }

    const weightageValidation = validateWeightage(incomingWeightage);
    if (!weightageValidation.ok) {
        return {
            valid: false,
            message: weightageValidation.message
        };
    }

    const currentTotal = totalWeightage(existingGoals);
    const finalTotal = currentTotal + weightageValidation.value;

    if (finalTotal > 100) {
        return {
            valid: false,
            message: `Total weightage cannot exceed 100%. Current total is ${currentTotal}%, incoming shared goal is ${weightageValidation.value}%.`
        };
    }

    return { valid: true };
}

router.post("/create", authorizeRole("admin", "manager"), async (req, res) => {
    try {
        const {
            thrustArea,
            title,
            description,
            uomType,
            scoreType,
            deadline,
            target,
            primaryOwnerId
        } = req.body;

        const windowError = await getCycleWindowError("goalSetting", "Goal setting");
        if (windowError) {
            return res.status(400).json({ message: windowError });
        }

        if (!thrustArea || !title || !uomType) {
            return res.status(400).json({ message: "Missing required shared goal fields" });
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

        const ownerId = req.user.role === "admin" && primaryOwnerId ? primaryOwnerId : req.user._id;
        const owner = await User.findById(ownerId);

        if (!owner || !owner.isActive) {
            return res.status(400).json({ message: "Primary owner not found or inactive" });
        }

        if (req.user.role === "manager" && owner._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Managers may only create shared goals for themselves" });
        }

        const sharedGoal = await SharedGoal.create({
            primaryOwnerId: owner._id,
            thrustArea,
            title,
            description,
            uomType: definition.normalized.uomType,
            scoreType: definition.normalized.scoreType,
            deadline: definition.normalized.deadline,
            target: definition.normalized.target
        });

        await AuditLog.create({
            userId: req.user._id,
            action: "Created shared goal",
            entityType: "SharedGoal",
            entityId: sharedGoal._id,
            newValue: sharedGoal.toObject()
        });

        res.status(201).json(sharedGoal);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get("/", authorizeRole("admin", "manager"), async (req, res) => {
    try {
        const query = req.user.role === "manager" ? { primaryOwnerId: req.user._id } : {};
        const sharedGoals = await SharedGoal.find(query).populate("primaryOwnerId", "name email role");
        res.json(sharedGoals);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.post("/assign", authorizeRole("admin", "manager"), async (req, res) => {
    try {
        const { sharedGoalId, employeeId, weightage } = req.body;

        const windowError = await getCycleWindowError("goalSetting", "Goal setting");
        if (windowError) {
            return res.status(400).json({ message: windowError });
        }

        if (!sharedGoalId || !employeeId || weightage === undefined) {
            return res.status(400).json({ message: "sharedGoalId, employeeId, and weightage are required" });
        }

        const weightageValidation = validateWeightage(weightage);
        if (!weightageValidation.ok) {
            return res.status(400).json({ message: weightageValidation.message });
        }

        const sharedGoal = await SharedGoal.findById(sharedGoalId);
        if (!sharedGoal) {
            return res.status(404).json({ message: "Shared goal not found" });
        }

        if (req.user.role === "manager" && sharedGoal.primaryOwnerId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Managers may only assign their own shared goals" });
        }

        const employee = await User.findById(employeeId);
        if (!employee || !employee.isActive || employee.role !== "employee") {
            return res.status(400).json({ message: "Cannot assign shared goal to inactive or non-existent employee" });
        }

        if (req.user.role === "manager" && employee.managerId?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Managers may only assign shared goals to their own team" });
        }

        const existing = await Goal.findOne({ employeeId, sharedGoalId });
        if (existing) {
            return res.status(409).json({ message: "Shared goal already assigned to this employee" });
        }

        const sheetValidation = await validateAssignableGoalSheet(employeeId, weightage);
        if (!sheetValidation.valid) {
            return res.status(400).json({ message: sheetValidation.message });
        }

        const goal = await Goal.create({
            employeeId,
            sharedGoalId,
            isShared: true,
            thrustArea: sharedGoal.thrustArea,
            title: sharedGoal.title,
            description: sharedGoal.description,
            uomType: sharedGoal.uomType,
            scoreType: sharedGoal.scoreType,
            deadline: sharedGoal.deadline || null,
            target: sharedGoal.target,
            weightage: weightageValidation.value
        });

        await AuditLog.create({
            userId: req.user._id,
            action: "Assigned shared goal",
            entityType: "Goal",
            entityId: goal._id,
            newValue: {
                sharedGoalId,
                employeeId,
                weightage: weightageValidation.value
            }
        });

        notify("sharedGoalAssigned", { employee, sharedGoal }, {
            to: employee.email,
            userId: req.user._id,
            entityType: "Goal",
            entityId: goal._id
        });

        res.status(201).json(goal);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.post("/assign-many", authorizeRole("admin", "manager"), async (req, res) => {
    try {
        const { sharedGoalId, assignments } = req.body;

        const windowError = await getCycleWindowError("goalSetting", "Goal setting");
        if (windowError) {
            return res.status(400).json({ message: windowError });
        }

        if (!sharedGoalId || !Array.isArray(assignments) || !assignments.length) {
            return res.status(400).json({ message: "sharedGoalId and assignments are required" });
        }

        const sharedGoal = await SharedGoal.findById(sharedGoalId);
        if (!sharedGoal) {
            return res.status(404).json({ message: "Shared goal not found" });
        }

        if (req.user.role === "manager" && sharedGoal.primaryOwnerId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Managers may only assign their own shared goals" });
        }

        const results = [];
        for (const assignment of assignments) {
            const { employeeId, weightage } = assignment;
            if (!employeeId || weightage === undefined) {
                results.push({ employeeId, status: "skipped", message: "Missing employeeId or weightage" });
                continue;
            }
            const weightageValidation = validateWeightage(weightage);
            if (!weightageValidation.ok) {
                results.push({ employeeId, status: "skipped", message: weightageValidation.message });
                continue;
            }
            const employee = await User.findById(employeeId);
            if (!employee || !employee.isActive || employee.role !== "employee") {
                results.push({ employeeId, status: "skipped", message: "Employee not found or inactive" });
                continue;
            }
            if (req.user.role === "manager" && employee.managerId?.toString() !== req.user._id.toString()) {
                results.push({ employeeId, status: "skipped", message: "Employee not on manager's team" });
                continue;
            }
            const existing = await Goal.findOne({ employeeId, sharedGoalId });
            if (existing) {
                results.push({ employeeId, status: "exists", message: "Already assigned" });
                continue;
            }
            const sheetValidation = await validateAssignableGoalSheet(employeeId, weightage);
            if (!sheetValidation.valid) {
                results.push({ employeeId, status: "skipped", message: sheetValidation.message });
                continue;
            }
            const goal = await Goal.create({
                employeeId,
                sharedGoalId,
                isShared: true,
                thrustArea: sharedGoal.thrustArea,
                title: sharedGoal.title,
                description: sharedGoal.description,
                uomType: sharedGoal.uomType,
                scoreType: sharedGoal.scoreType,
                deadline: sharedGoal.deadline || null,
                target: sharedGoal.target,
                weightage: weightageValidation.value
            });
            await AuditLog.create({
                userId: req.user._id,
                action: "Assigned shared goal",
                entityType: "Goal",
                entityId: goal._id,
                newValue: {
                    sharedGoalId,
                    employeeId,
                    weightage: weightageValidation.value
                }
            });
            notify("sharedGoalAssigned", { employee, sharedGoal }, {
                to: employee.email,
                userId: req.user._id,
                entityType: "Goal",
                entityId: goal._id
            });
            results.push({ employeeId, status: "assigned", message: "Shared goal assigned" });
        }

        res.json({ message: "Bulk assignment complete", results });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get("/:sharedGoalId/assignments", authorizeRole("admin", "manager"), async (req, res) => {
    try {
        const sharedGoal = await SharedGoal.findById(req.params.sharedGoalId);
        if (!sharedGoal) {
            return res.status(404).json({ message: "Shared goal not found" });
        }

        if (req.user.role === "manager" && sharedGoal.primaryOwnerId.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Managers may only inspect assignments for their own shared goals" });
        }

        const query = { sharedGoalId: req.params.sharedGoalId };
        if (req.user.role === "manager") {
            const teamMembers = await User.find({ managerId: req.user._id, isActive: true }).select("_id");
            query.employeeId = { $in: teamMembers.map((member) => member._id) };
        }

        const assignments = await Goal.find(query)
            .populate("employeeId", "name email department managerId isActive")
            .sort({ createdAt: -1 });

        res.json(assignments.filter((goal) => goal.employeeId && goal.employeeId.isActive));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
