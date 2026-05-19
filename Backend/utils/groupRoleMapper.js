const rawGroupMapping = process.env.AZURE_GROUP_ROLE_MAP || "{}";

function parseGroupMapping(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) {
            return {};
        }
        return parsed;
    } catch (error) {
        console.warn("Unable to parse AZURE_GROUP_ROLE_MAP; falling back to no group mapping.", error.message);
        return {};
    }
}

const roleGroupMap = parseGroupMapping(rawGroupMapping);
const normalizedRoleGroupMap = Object.keys(roleGroupMap).reduce((acc, role) => {
    const values = Array.isArray(roleGroupMap[role]) ? roleGroupMap[role] : [roleGroupMap[role]];
    acc[role] = values
        .filter(Boolean)
        .map(value => value.toString().trim().toLowerCase());
    return acc;
}, {});

function getGroupIdentifiers(groups) {
    if (!Array.isArray(groups)) return [];
    return groups.flatMap(group => {
        if (typeof group === "string") return [group.toLowerCase()];
        if (group && typeof group === "object") {
            return [group.id, group.displayName, group.name]
                .filter(Boolean)
                .map(value => value.toString().trim().toLowerCase());
        }
        return [];
    });
}

function getRoleFromGroups(groups) {
    const identifiers = getGroupIdentifiers(groups);
    if (!identifiers.length) return null;

    for (const role of ["admin", "manager", "employee"]) {
        const mappedValues = normalizedRoleGroupMap[role] || [];
        if (mappedValues.some(value => identifiers.includes(value))) {
            return role;
        }
    }
    return null;
}

function getConfiguredGroupMapping() {
    return normalizedRoleGroupMap;
}

module.exports = {
    getRoleFromGroups,
    getConfiguredGroupMapping
};
