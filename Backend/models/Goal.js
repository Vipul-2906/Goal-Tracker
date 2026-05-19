const mongoose = require("mongoose");

const goalSchema = new mongoose.Schema({

    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    
    sharedGoalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "SharedGoal"
    },

    isShared: {
        type: Boolean,
        default: false
    },

    thrustArea: {
        type: String,
        required: true
    },

    title: {
        type: String,
        required: true
    },

    description: {
        type: String
    },

    uomType: {
        type: String,
        enum: ["numeric", "percentage", "timeline", "zero"],
        required: true
    },

    target: {
        type: Number,
        required: true
    },

    scoreType: {
        type: String,
        enum: ["min", "max", "timeline", "zero"],
        required: true
    },

    deadline: {
        type: Date
    },

    weightage: {
        type: Number,
        required: true
    },

    status: {
        type: String,
        enum: ["draft", "submitted", "returned", "approved"],
        default: "draft"
    },

    managerNotes: {
        type: String,
        default: null
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("Goal", goalSchema);