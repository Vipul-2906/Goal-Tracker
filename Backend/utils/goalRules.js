const VALID_UOM_TYPES = ["numeric", "percentage", "timeline", "zero"];
const VALID_SCORE_TYPES = ["min", "max", "timeline", "zero"];
const NUMERIC_SCORE_TYPES = ["min", "max"];

function normalizeGoalDefinition(definition) {
    const uomType = String(definition.uomType || "").trim();
    const incomingScoreType = definition.scoreType ? String(definition.scoreType).trim() : "";
    const deadline = definition.deadline || null;

    if (!VALID_UOM_TYPES.includes(uomType)) {
        return { ok: false, message: "Valid UoM type is required" };
    }

    if (incomingScoreType && !VALID_SCORE_TYPES.includes(incomingScoreType)) {
        return { ok: false, message: "Valid score type is required" };
    }

    if (uomType === "timeline") {
        if (incomingScoreType && incomingScoreType !== "timeline") {
            return { ok: false, message: "Timeline goals must use timeline score type" };
        }

        if (!deadline) {
            return { ok: false, message: "Deadline is required for timeline goals" };
        }

        const target = definition.target === undefined || definition.target === null || definition.target === ""
            ? 0
            : Number(definition.target);

        if (Number.isNaN(target) || target < 0) {
            return { ok: false, message: "Timeline target must be a non-negative number when provided" };
        }

        return {
            ok: true,
            normalized: {
                uomType,
                scoreType: "timeline",
                target,
                deadline
            }
        };
    }

    if (uomType === "zero") {
        if (incomingScoreType && incomingScoreType !== "zero") {
            return { ok: false, message: "Zero-based goals must use zero score type" };
        }

        return {
            ok: true,
            normalized: {
                uomType,
                scoreType: "zero",
                target: 0,
                deadline
            }
        };
    }

    if (!NUMERIC_SCORE_TYPES.includes(incomingScoreType)) {
        return { ok: false, message: "Numeric and percentage goals must use min or max score type" };
    }

    const target = Number(definition.target);
    if (Number.isNaN(target) || target <= 0) {
        return { ok: false, message: "Target must be greater than 0 for numeric and percentage goals" };
    }

    return {
        ok: true,
        normalized: {
            uomType,
            scoreType: incomingScoreType,
            target,
            deadline
        }
    };
}

function validateWeightage(weightage) {
    const value = Number(weightage);

    if (Number.isNaN(value)) {
        return { ok: false, message: "Weightage must be a valid number" };
    }

    if (value < 10) {
        return { ok: false, message: "Minimum weightage is 10%" };
    }

    if (value > 100) {
        return { ok: false, message: "Weightage cannot exceed 100%" };
    }

    return { ok: true, value };
}

function totalWeightage(goals) {
    return goals.reduce((sum, goal) => sum + Number(goal.weightage || 0), 0);
}

function calculateProgressScore(goal, payload) {
    const actualAchievement = Number(payload.actualAchievement);

    if (Number.isNaN(actualAchievement)) {
        return { ok: false, message: "Actual achievement must be a valid number" };
    }

    if (actualAchievement < 0) {
        return { ok: false, message: "Actual achievement must be non-negative" };
    }

    let progressScore = 0;

    if (goal.scoreType === "min") {
        progressScore = Number(goal.target) === 0 ? 0 : (actualAchievement / Number(goal.target)) * 100;
    }

    if (goal.scoreType === "max") {
        progressScore = actualAchievement === 0 ? 100 : (Number(goal.target) / actualAchievement) * 100;
    }

    if (goal.scoreType === "zero") {
        progressScore = actualAchievement === 0 ? 100 : 0;
    }

    if (goal.scoreType === "timeline") {
        const completionDate = payload.completionDate ? new Date(payload.completionDate) : null;
        if (!completionDate || Number.isNaN(completionDate.getTime()) || !goal.deadline) {
            return { ok: false, message: "Completion date and deadline are required for timeline goals" };
        }
        const deadline = new Date(goal.deadline);
        progressScore = completionDate <= deadline ? 100 : 0;
    }

    return {
        ok: true,
        progressScore: Math.max(0, Math.min(100, Number(progressScore) || 0))
    };
}

module.exports = {
    VALID_UOM_TYPES,
    VALID_SCORE_TYPES,
    normalizeGoalDefinition,
    validateWeightage,
    totalWeightage,
    calculateProgressScore
};
