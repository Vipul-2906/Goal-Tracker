const bcrypt = require("bcrypt");
const User = require("../models/User");
const { getRoleFromGroups } = require("./groupRoleMapper");

async function findOrCreateManager(managerProfile, managerGroups) {
    if (!managerProfile || !managerProfile.email) {
        return null;
    }

    const existingManager = await User.findOne({
        $or: [
            { email: managerProfile.email.toLowerCase() },
            { microsoftId: managerProfile.id }
        ]
    });

    if (existingManager) {
        existingManager.name = managerProfile.displayName || existingManager.name;
        existingManager.jobTitle = managerProfile.jobTitle || existingManager.jobTitle;
        existingManager.department = managerProfile.department || existingManager.department;
        existingManager.officeLocation = managerProfile.officeLocation || existingManager.officeLocation;
        existingManager.microsoftId = existingManager.microsoftId || managerProfile.id;
        existingManager.aadEmail = existingManager.aadEmail || managerProfile.email.toLowerCase();
        await existingManager.save();
        return existingManager;
    }

    const managerRole = getRoleFromGroups(managerGroups) || "manager";
    const placeholderPassword = await bcrypt.hash(`${managerProfile.id}-${Date.now()}`, 10);

    const newManager = await User.create({
        name: managerProfile.displayName || managerProfile.email,
        email: managerProfile.email.toLowerCase(),
        password: placeholderPassword,
        role: managerRole,
        department: managerProfile.department || null,
        jobTitle: managerProfile.jobTitle || null,
        officeLocation: managerProfile.officeLocation || null,
        microsoftId: managerProfile.id,
        aadEmail: managerProfile.email.toLowerCase(),
        managerId: null,
        isActive: true
    });

    return newManager;
}

async function syncUserHierarchy(user, graphData, assignedRole, groupInfo = []) {
    if (!user) {
        throw new Error("User is required for hierarchy synchronization");
    }

    const updatedFields = {};

    if (graphData?.user) {
        updatedFields.name = graphData.user.displayName || user.name;
        updatedFields.department = graphData.user.department || user.department;
        updatedFields.jobTitle = graphData.user.jobTitle || user.jobTitle;
        updatedFields.officeLocation = graphData.user.officeLocation || user.officeLocation;
        updatedFields.microsoftId = graphData.user.id || user.microsoftId;
        updatedFields.aadEmail = graphData.user.email || user.aadEmail;
        updatedFields.aadGroupIds = Array.isArray(groupInfo)
            ? groupInfo.map(g => typeof g === "string" ? g : g.id).filter(Boolean)
            : user.aadGroupIds || [];
        updatedFields.aadGroupNames = Array.isArray(groupInfo)
            ? groupInfo.map(g => typeof g === "string" ? null : (g.displayName || g.name)).filter(Boolean)
            : user.aadGroupNames || [];
    }

    if (assignedRole) {
        updatedFields.role = assignedRole;
    }

    if (graphData?.manager) {
        const manager = await findOrCreateManager(graphData.manager, graphData.manager.groups || []);
        if (manager) {
            updatedFields.managerId = manager._id;
            updatedFields.managerAzureId = manager.microsoftId;
        }
    }

    Object.assign(user, updatedFields);
    await user.save();
    return user;
}

module.exports = {
    syncUserHierarchy,
    findOrCreateManager
};
