const mongoose = require("mongoose");

const goalUpdateSchema = new mongoose.Schema({

    goalId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Goal",
        required: true
    },

    quarter: {
        type: String,
        enum: ["Q1", "Q2", "Q3", "Q4"],
        required: true
    },

    plannedTarget: {
        type: Number,
        required: true
    },

    actualAchievement: {
        type: Number,
        required: true
    },

    completionDate: {
        type: Date
    },

    progressStatus: {
        type: String,
        enum: ["Not Started", "On Track", "Completed"],
        required: true
    },

    progressScore: {
        type: Number
    },

    employeeComment: {
        type: String
    },

    managerComment: {
        type: String
    },

    managerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
    },

    managerCommentedAt: {
        type: Date,
        default: null
    }

}, {
    timestamps: true
});

goalUpdateSchema.index({ goalId: 1, quarter: 1 });

module.exports = mongoose.model("GoalUpdate", goalUpdateSchema);
