const express = require("express");
const router = express.Router();

const AuditLog = require("../models/AuditLog");
const { authenticate, authorizeRole } = require("../middleware/authMiddleware");

router.use(authenticate, authorizeRole("admin"));


// GET ALL AUDIT LOGS
router.get("/", async (req, res) => {

    try {

        const logs = await AuditLog.find()
            .populate("userId", "name email")
            .sort({ createdAt: -1 });

        res.json(logs);

    } catch (error) {

        res.status(500).json({
            message: error.message
        });

    }

});

module.exports = router;
