const mongoose = require("mongoose");

const escalationSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    manager: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
    },

    type: {
        type: String,
        enum: ["goal_not_submitted", "approval_pending", "quarterly_checkin_overdue"],
        required: true
    },

    message: {
        type: String,
        required: true
    },

    resolved: {
        type: Boolean,
        default: false
    },

    resolvedAt: {
        type: Date,
        default: null
    },

    resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
    },

    resolutionNote: {
        type: String,
        default: null
    },

    lastNotifiedAt: {
        type: Date,
        default: null
    },

    notificationCount: {
        type: Number,
        default: 0
    },

    metadata: {
        type: Object,
        default: {}
    }
}, {
    timestamps: true
});

escalationSchema.index({ employee: 1, type: 1, resolved: 1 });

module.exports = mongoose.model("Escalation", escalationSchema);
