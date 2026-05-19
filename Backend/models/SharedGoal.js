const mongoose = require("mongoose");

const sharedGoalSchema = new mongoose.Schema({

    primaryOwnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
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

    scoreType: {
        type: String,
        enum: ["min", "max", "timeline", "zero"],
        required: true
    },

    deadline: {
        type: Date,
        default: null
    },

    target: {
        type: Number,
        required: true
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("SharedGoal", sharedGoalSchema);