const express = require("express");
const router = express.Router();

const CycleConfig = require("../models/CycleConfig");
const AuditLog = require("../models/AuditLog");
const { authenticate, authorizeRole } = require("../middleware/authMiddleware");
const {
    DEFAULT_CYCLE_WINDOWS,
    normalizeMonths,
    getMergedCycles
} = require("../utils/cycleRules");

router.use(authenticate);

router.get("/", async (req, res) => {
    try {
        const cycles = await getMergedCycles();
        res.json(cycles);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.put("/:key", authorizeRole("admin"), async (req, res) => {
    try {
        const defaultCycle = DEFAULT_CYCLE_WINDOWS.find((cycle) => cycle.key === req.params.key);
        if (!defaultCycle) {
            return res.status(404).json({ message: "Cycle window not found" });
        }

        const openMonths = normalizeMonths(req.body.openMonths);
        if (!openMonths) {
            return res.status(400).json({ message: "At least one valid month from 1 to 12 is required" });
        }

        const oldValue = await CycleConfig.findOne({ key: req.params.key });
        const updated = await CycleConfig.findOneAndUpdate(
            { key: req.params.key },
            {
                key: req.params.key,
                label: req.body.label || defaultCycle.label,
                openMonths,
                action: req.body.action || defaultCycle.action,
                updatedBy: req.user._id
            },
            { returnDocument: "after", upsert: true, setDefaultsOnInsert: true }
        );

        await AuditLog.create({
            userId: req.user._id,
            action: "Updated cycle window",
            entityType: "CycleConfig",
            entityId: updated._id,
            oldValue: oldValue ? oldValue.toObject() : defaultCycle,
            newValue: updated.toObject()
        });

        res.json(updated);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = {
    router,
    DEFAULT_CYCLE_WINDOWS,
    getMergedCycles
};
