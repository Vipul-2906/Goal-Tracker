const express = require("express");
const router = express.Router();

const Goal = require("../models/Goal");
const GoalUpdate = require("../models/GoalUpdate");
const User = require("../models/User");
const { authenticate, authorizeRole } = require("../middleware/authMiddleware");

router.use(authenticate, authorizeRole("admin", "manager"));

function scopeEmployeeMatch(user) {
    if (user.role === "admin") return {};
    return { "employee.managerId": user._id };
}

async function activeEmployeeIdsFor(user) {
    const query = user.role === "manager"
        ? { role: "employee", isActive: true, managerId: user._id }
        : { role: "employee", isActive: true };
    return (await User.find(query).select("_id")).map((employee) => employee._id);
}

router.get("/qoq-trends", async (req, res) => {
    try {
        const employeeIds = await activeEmployeeIdsFor(req.user);
        const trends = await GoalUpdate.aggregate([
            { $lookup: { from: "goals", localField: "goalId", foreignField: "_id", as: "goal" } },
            { $unwind: "$goal" },
            { $match: { "goal.employeeId": { $in: employeeIds } } },
            {
                $group: {
                    _id: "$quarter",
                    averageScore: { $avg: "$progressScore" },
                    completed: { $sum: { $cond: [{ $eq: ["$progressStatus", "Completed"] }, 1, 0] } },
                    onTrack: { $sum: { $cond: [{ $eq: ["$progressStatus", "On Track"] }, 1, 0] } },
                    notStarted: { $sum: { $cond: [{ $eq: ["$progressStatus", "Not Started"] }, 1, 0] } },
                    updates: { $sum: 1 }
                }
            },
            { $project: { _id: 0, quarter: "$_id", averageScore: { $round: ["$averageScore", 1] }, completed: 1, onTrack: 1, notStarted: 1, updates: 1 } },
            { $sort: { quarter: 1 } }
        ]);
        res.json(trends);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get("/completion-stats", async (req, res) => {
    try {
        const employeeIds = await activeEmployeeIdsFor(req.user);
        const [goalStatus, updateStatus, totals] = await Promise.all([
            Goal.aggregate([
                { $match: { employeeId: { $in: employeeIds } } },
                { $group: { _id: "$status", count: { $sum: 1 } } },
                { $project: { _id: 0, status: "$_id", count: 1 } }
            ]),
            GoalUpdate.aggregate([
                { $lookup: { from: "goals", localField: "goalId", foreignField: "_id", as: "goal" } },
                { $unwind: "$goal" },
                { $match: { "goal.employeeId": { $in: employeeIds } } },
                { $group: { _id: "$progressStatus", count: { $sum: 1 } } },
                { $project: { _id: 0, status: "$_id", count: 1 } }
            ]),
            Goal.aggregate([
                { $match: { employeeId: { $in: employeeIds } } },
                { $group: { _id: null, totalGoals: { $sum: 1 }, approvedGoals: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } }, totalWeightage: { $sum: "$weightage" } } }
            ])
        ]);
        res.json({ goalStatus, updateStatus, totals: totals[0] || { totalGoals: 0, approvedGoals: 0, totalWeightage: 0 } });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get("/distribution", async (req, res) => {
    try {
        const employeeIds = await activeEmployeeIdsFor(req.user);
        const base = [{ $match: { employeeId: { $in: employeeIds } } }];
        const [byThrustArea, byUom, byStatus] = await Promise.all([
            Goal.aggregate([...base, { $group: { _id: "$thrustArea", count: { $sum: 1 } } }, { $project: { _id: 0, label: "$_id", count: 1 } }]),
            Goal.aggregate([...base, { $group: { _id: "$uomType", count: { $sum: 1 } } }, { $project: { _id: 0, label: "$_id", count: 1 } }]),
            Goal.aggregate([...base, { $group: { _id: "$status", count: { $sum: 1 } } }, { $project: { _id: 0, label: "$_id", count: 1 } }])
        ]);
        res.json({ byThrustArea, byUom, byStatus });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get("/manager-effectiveness", async (req, res) => {
    try {
        const match = scopeEmployeeMatch(req.user);
        const data = await GoalUpdate.aggregate([
            { $lookup: { from: "goals", localField: "goalId", foreignField: "_id", as: "goal" } },
            { $unwind: "$goal" },
            { $lookup: { from: "users", localField: "goal.employeeId", foreignField: "_id", as: "employee" } },
            { $unwind: "$employee" },
            { $match: { ...match, "employee.isActive": true } },
            { $lookup: { from: "users", localField: "employee.managerId", foreignField: "_id", as: "manager" } },
            { $unwind: { path: "$manager", preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: "$employee.managerId",
                    managerName: { $first: { $ifNull: ["$manager.name", "Unassigned"] } },
                    checkIns: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $or: [{ $ne: ["$managerCommentedAt", null] }, { $gt: [{ $strLenCP: { $ifNull: ["$managerComment", ""] } }, 0] }] }, 1, 0] } }
                }
            },
            { $project: { _id: 0, managerId: "$_id", managerName: 1, checkIns: 1, completed: 1, pending: { $subtract: ["$checkIns", "$completed"] }, completionRate: { $cond: ["$checkIns", { $round: [{ $multiply: [{ $divide: ["$completed", "$checkIns"] }, 100] }, 0] }, 0] } } },
            { $sort: { completionRate: -1, managerName: 1 } }
        ]);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get("/heatmap", async (req, res) => {
    try {
        const employeeIds = await activeEmployeeIdsFor(req.user);
        const data = await GoalUpdate.aggregate([
            { $lookup: { from: "goals", localField: "goalId", foreignField: "_id", as: "goal" } },
            { $unwind: "$goal" },
            { $match: { "goal.employeeId": { $in: employeeIds } } },
            { $lookup: { from: "users", localField: "goal.employeeId", foreignField: "_id", as: "employee" } },
            { $unwind: "$employee" },
            { $lookup: { from: "users", localField: "employee.managerId", foreignField: "_id", as: "manager" } },
            { $unwind: { path: "$manager", preserveNullAndEmptyArrays: true } },
            {
                $group: {
                    _id: { department: "$employee.department", quarter: "$quarter" },
                    updates: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ["$progressStatus", "Completed"] }, 1, 0] } },
                    managerCheckIns: { $sum: { $cond: [{ $or: [{ $ne: ["$managerCommentedAt", null] }, { $gt: [{ $strLenCP: { $ifNull: ["$managerComment", ""] } }, 0] }] }, 1, 0] } }
                }
            },
            { $project: { _id: 0, department: { $ifNull: ["$_id.department", "Unassigned"] }, quarter: "$_id.quarter", updates: 1, completed: 1, managerCheckIns: 1, completionRate: { $cond: ["$updates", { $round: [{ $multiply: [{ $divide: ["$completed", "$updates"] }, 100] }, 0] }, 0] } } },
            { $sort: { department: 1, quarter: 1 } }
        ]);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.get("/dashboard", async (req, res) => {
    try {
        const [qoqTrends, completionStats, distribution, managerEffectiveness, heatmap] = await Promise.all([
            fetchInternal(req, "/qoq-trends"),
            fetchInternal(req, "/completion-stats"),
            fetchInternal(req, "/distribution"),
            fetchInternal(req, "/manager-effectiveness"),
            fetchInternal(req, "/heatmap")
        ]);
        res.json({ qoqTrends, completionStats, distribution, managerEffectiveness, heatmap });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

async function fetchInternal(req, path) {
    const routes = {
        "/qoq-trends": async () => {
            const employeeIds = await activeEmployeeIdsFor(req.user);
            return GoalUpdate.aggregate([
                { $lookup: { from: "goals", localField: "goalId", foreignField: "_id", as: "goal" } },
                { $unwind: "$goal" },
                { $match: { "goal.employeeId": { $in: employeeIds } } },
                { $group: { _id: "$quarter", averageScore: { $avg: "$progressScore" }, updates: { $sum: 1 } } },
                { $project: { _id: 0, quarter: "$_id", averageScore: { $round: ["$averageScore", 1] }, updates: 1 } },
                { $sort: { quarter: 1 } }
            ]);
        },
        "/completion-stats": async () => {
            const employeeIds = await activeEmployeeIdsFor(req.user);
            const totalGoals = await Goal.countDocuments({ employeeId: { $in: employeeIds } });
            const approvedGoals = await Goal.countDocuments({ employeeId: { $in: employeeIds }, status: "approved" });
            const updates = await GoalUpdate.countDocuments();
            return { totals: { totalGoals, approvedGoals, updates } };
        },
        "/distribution": async () => {
            const employeeIds = await activeEmployeeIdsFor(req.user);
            const byStatus = await Goal.aggregate([{ $match: { employeeId: { $in: employeeIds } } }, { $group: { _id: "$status", count: { $sum: 1 } } }, { $project: { _id: 0, label: "$_id", count: 1 } }]);
            return { byStatus };
        },
        "/manager-effectiveness": async () => [],
        "/heatmap": async () => []
    };
    return routes[path]();
}

module.exports = router;
