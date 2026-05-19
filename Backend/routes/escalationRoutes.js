const express = require("express");
const router = express.Router();

const Escalation = require("../models/Escalation");
const AuditLog = require("../models/AuditLog");
const { authenticate, authorizeRole } = require("../middleware/authMiddleware");
const { runEscalationChecks } = require("../utils/escalationService");

router.use(authenticate);

const getEscalationsHandler = async (req, res) => {
    try {
        const query = req.user.role === "manager" ? { manager: req.user._id } : {};
        if (req.query.resolved === "true") query.resolved = true;
        if (req.query.resolved === "false") query.resolved = false;

        const escalations = await Escalation.find(query)
            .populate("employee", "name email department")
            .populate("manager", "name email")
            .sort({ resolved: 1, createdAt: -1 });

        res.json(escalations);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

router.get("/", authorizeRole("admin", "manager"), getEscalationsHandler);
router.get("", authorizeRole("admin", "manager"), getEscalationsHandler);

router.post("/run-checks", authorizeRole("admin"), async (req, res) => {
    try {
        const created = await runEscalationChecks();
        res.json({ message: "Escalation checks completed", created: created.length });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

router.put("/:id/resolve", authorizeRole("admin", "manager"), async (req, res) => {
    try {
        const escalation = await Escalation.findById(req.params.id);
        if (!escalation) return res.status(404).json({ message: "Escalation not found" });
        if (req.user.role === "manager" && escalation.manager?.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Managers may only resolve their own escalations" });
        }

        escalation.resolved = true;
        escalation.resolvedAt = new Date();
        escalation.resolvedBy = req.user._id;
        escalation.resolutionNote = req.body?.note || null;
        await escalation.save();

        await AuditLog.create({
            userId: req.user._id,
            action: "Escalation resolved",
            entityType: "Escalation",
            entityId: escalation._id,
            newValue: { resolved: true, note: req.body?.note || null }
        });

        res.json(escalation);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
