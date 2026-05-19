const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },

    password: {
        type: String,
        required: true
    },

    role: {
        type: String,
        enum: ["employee", "manager", "admin"],
        required: true
    },

    department: {
        type: String,
        default: null
    },

    jobTitle: {
        type: String,
        default: null
    },

    officeLocation: {
        type: String,
        default: null
    },

    managerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
    },

    managerAzureId: {
        type: String,
        default: null
    },

    microsoftId: {
        type: String,
        default: null,
        index: true
    },

    aadGroupIds: {
        type: [String],
        default: []
    },

    aadGroupNames: {
        type: [String],
        default: []
    },

    aadEmail: {
        type: String,
        default: null,
        lowercase: true
    },

    isActive: {
        type: Boolean,
        default: true
    },

    createdAt: {
        type: Date,
        default: Date.now
    },

    updatedAt: {
        type: Date,
        default: Date.now
    }

}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);
