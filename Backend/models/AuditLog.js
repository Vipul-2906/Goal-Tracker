const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({

    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },

    action: {
        type: String,
        required: true
    },

    entityType: {
        type: String
    },

    entityId: {
        type: mongoose.Schema.Types.ObjectId
    },

    oldValue: {
        type: Object
    },

    newValue: {
        type: Object
    }

}, {
    timestamps: true
});

module.exports =
    mongoose.model("AuditLog", auditLogSchema);