const mongoose = require("mongoose");

const cycleConfigSchema = new mongoose.Schema({
    key: {
        type: String,
        enum: ["goalSetting", "Q1", "Q2", "Q3", "Q4"],
        required: true,
        unique: true
    },

    label: {
        type: String,
        required: true
    },

    openMonths: [{
        type: Number,
        min: 1,
        max: 12
    }],

    action: {
        type: String,
        required: true
    },

    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model("CycleConfig", cycleConfigSchema);
