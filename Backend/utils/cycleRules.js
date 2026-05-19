const CycleConfig = require("../models/CycleConfig");

const DEFAULT_CYCLE_WINDOWS = [
    {
        key: "goalSetting",
        label: "Phase 1 - Goal Setting",
        openMonths: [5],
        action: "Goal Creation, Submission & Approval"
    },
    {
        key: "Q1",
        label: "Q1 Check-in",
        openMonths: [7],
        action: "Progress Update - Planned vs. Actual"
    },
    {
        key: "Q2",
        label: "Q2 Check-in",
        openMonths: [10],
        action: "Progress Update - Planned vs. Actual"
    },
    {
        key: "Q3",
        label: "Q3 Check-in",
        openMonths: [1],
        action: "Progress Update - Planned vs. Actual"
    },
    {
        key: "Q4",
        label: "Q4 / Annual",
        openMonths: [3, 4],
        action: "Final Achievement Capture"
    }
];

function normalizeMonths(openMonths) {
    if (!Array.isArray(openMonths)) return null;
    const months = [...new Set(openMonths.map(Number))]
        .filter((month) => Number.isInteger(month) && month >= 1 && month <= 12)
        .sort((a, b) => a - b);
    return months.length ? months : null;
}

async function getMergedCycles() {
    const stored = await CycleConfig.find();
    const storedByKey = new Map(stored.map((cycle) => [cycle.key, cycle]));

    return DEFAULT_CYCLE_WINDOWS.map((defaultCycle) => {
        const override = storedByKey.get(defaultCycle.key);
        if (!override) return defaultCycle;
        return {
            key: override.key,
            label: override.label || defaultCycle.label,
            openMonths: override.openMonths?.length ? override.openMonths : defaultCycle.openMonths,
            action: override.action || defaultCycle.action,
            updatedAt: override.updatedAt,
            updatedBy: override.updatedBy
        };
    });
}

async function getCycleWindow(key) {
    const cycles = await getMergedCycles();
    return cycles.find((cycle) => cycle.key === key) || null;
}

async function getCycleWindowError(key, label) {
    const currentMonth = new Date().getMonth() + 1;
    const cycle = await getCycleWindow(key);

    if (cycle && cycle.openMonths.includes(currentMonth)) {
        return null;
    }

    const openMonths = cycle?.openMonths?.join(", ") || "configured";
    return `${label} window is closed. Open month(s): ${openMonths}`;
}

module.exports = {
    DEFAULT_CYCLE_WINDOWS,
    normalizeMonths,
    getMergedCycles,
    getCycleWindow,
    getCycleWindowError
};
