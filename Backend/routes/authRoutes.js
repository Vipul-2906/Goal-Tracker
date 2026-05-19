const express = require("express");
const bcrypt = require("bcrypt");
const { createToken, authenticate, authorizeRole } = require("../middleware/authMiddleware");
const { validateIdToken, getGraphUserData } = require("../utils/azureAuth");
const { getRoleFromGroups } = require("../utils/groupRoleMapper");
const { syncUserHierarchy } = require("../utils/hierarchySync");
const router = express.Router();

const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// LOGIN (public route)
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        if (!EMAIL_PATTERN.test(normalizedEmail)) {
            return res.status(400).json({ message: "Enter a valid email address" });
        }

        // Find user and check if active
        const user = await User.findOne({ email: normalizedEmail });

        if (!user || !user.isActive) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        const isHashed = /^\$2[ayb]\$\d{2}\$/.test(user.password || "");
        const passwordMatches = isHashed
            ? await bcrypt.compare(password, user.password)
            : user.password === password;

        if (!passwordMatches) {
            return res.status(401).json({
                message: "Invalid email or password"
            });
        }

        if (!isHashed) {
            user.password = await bcrypt.hash(password, 10);
            await user.save();
        }

        const token = createToken(user);
        const userData = user.toObject();
        delete userData.password;

        res.json({
            message: "Login successful",
            user: userData,
            token
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// MICROSOFT ENTRA ID LOGIN (preserves existing local JWT auth)
router.post("/microsoft", async (req, res) => {
    try {
        const { idToken, accessToken } = req.body;

        if (!idToken) {
            return res.status(400).json({ message: "Microsoft idToken is required" });
        }

        const claims = await validateIdToken(idToken);
        const email = (claims.email || claims.preferred_username || claims.upn || "").toLowerCase();

        if (!email || !EMAIL_PATTERN.test(email)) {
            return res.status(400).json({ message: "Microsoft account email is invalid" });
        }

        let graphData = null;
        let groups = Array.isArray(claims.groups) ? claims.groups : [];

        if (accessToken) {
            try {
                graphData = await getGraphUserData(accessToken);
                groups = graphData.groups.length ? graphData.groups : groups;
            } catch (error) {
                console.warn("Microsoft Graph sync failed:", error.message);
            }
        }

        let user = await User.findOne({
            $or: [
                { microsoftId: claims.oid || claims.sub },
                { aadEmail: email },
                { email }
            ]
        });

        if (user && !user.isActive) {
            return res.status(401).json({ message: "Account is inactive" });
        }

        if (user && user.microsoftId === (claims.oid || claims.sub)) {
            const role = getRoleFromGroups(groups) || user.role;
            const groupIds = Array.isArray(groups)
                ? groups.map(group => (typeof group === "string" ? group : group.id)).filter(Boolean)
                : [];
            const groupNames = Array.isArray(groups)
                ? groups.map(group => (typeof group === "string" ? null : group.displayName || group.name)).filter(Boolean)
                : [];

            user.name = claims.name || user.name;
            user.role = role;
            user.aadEmail = user.aadEmail || email;
            user.aadGroupIds = groupIds.length ? groupIds : user.aadGroupIds;
            user.aadGroupNames = groupNames.length ? groupNames : user.aadGroupNames;
            user.department = graphData?.user?.department || user.department;
            user.jobTitle = graphData?.user?.jobTitle || user.jobTitle;
            user.officeLocation = graphData?.user?.officeLocation || user.officeLocation;
            await user.save();

            await syncUserHierarchy(user, graphData || { user: { id: claims.oid || claims.sub, displayName: claims.name, email } }, role, groups);

            await AuditLog.create({
                userId: user._id,
                action: "Microsoft login successful",
                entityType: "User",
                entityId: user._id,
                newValue: {
                    email: user.email,
                    aadEmail: user.aadEmail,
                    role: user.role,
                    managerId: user.managerId,
                    department: user.department
                }
            });

            const token = createToken(user);
            const userData = user.toObject();
            delete userData.password;

            return res.json({
                message: "Microsoft login successful",
                user: userData,
                token
            });
        }

        return res.json({
            linkRequired: true,
            email,
            message: "Microsoft account is not linked. Please sign into an existing account to link this Microsoft identity."
        });
    } catch (error) {
        console.error("Microsoft login error:", error);
        res.status(error.status || 401).json({ message: error.message || "Microsoft login failed" });
    }
});

// LINK EXISTING USER TO MICROSOFT ACCOUNT
router.post("/microsoft/link", async (req, res) => {
    try {
        const { idToken, accessToken, email, password } = req.body;

        if (!idToken || !email || !password) {
            return res.status(400).json({ message: "idToken, email, and password are required to link a Microsoft account." });
        }

        const normalizedEmail = email.trim().toLowerCase();
        if (!EMAIL_PATTERN.test(normalizedEmail)) {
            return res.status(400).json({ message: "Enter a valid email address." });
        }

        const claims = await validateIdToken(idToken);
        const microsoftId = claims.oid || claims.sub;
        if (!microsoftId) {
            return res.status(400).json({ message: "Microsoft token does not contain a valid user identifier." });
        }

        const user = await User.findOne({ email: normalizedEmail });
        if (!user || !user.isActive) {
            return res.status(401).json({ message: "Invalid email or password." });
        }

        const isHashed = /^\$2[ayb]\$\d{2}\$/.test(user.password || "");
        const passwordMatches = isHashed
            ? await bcrypt.compare(password, user.password)
            : user.password === password;

        if (!passwordMatches) {
            return res.status(401).json({ message: "Invalid email or password." });
        }

        if (user.microsoftId && user.microsoftId !== microsoftId) {
            return res.status(409).json({ message: "This account is already linked to a different Microsoft identity." });
        }

        let graphData = null;
        let groups = Array.isArray(claims.groups) ? claims.groups : [];

        if (accessToken) {
            try {
                graphData = await getGraphUserData(accessToken);
                groups = graphData.groups.length ? graphData.groups : groups;
            } catch (error) {
                console.warn("Microsoft Graph sync failed during link:", error.message);
            }
        }

        const groupIds = Array.isArray(groups)
            ? groups.map(group => (typeof group === "string" ? group : group.id)).filter(Boolean)
            : [];
        const groupNames = Array.isArray(groups)
            ? groups.map(group => (typeof group === "string" ? null : group.displayName || group.name)).filter(Boolean)
            : [];

        user.microsoftId = microsoftId;
        user.aadEmail = normalizedEmail;
        user.aadGroupIds = groupIds.length ? groupIds : user.aadGroupIds;
        user.aadGroupNames = groupNames.length ? groupNames : user.aadGroupNames;
        user.name = claims.name || user.name;
        user.department = graphData?.user?.department || user.department;
        user.jobTitle = graphData?.user?.jobTitle || user.jobTitle;
        user.officeLocation = graphData?.user?.officeLocation || user.officeLocation;
        await user.save();

        await syncUserHierarchy(user, graphData || { user: { id: microsoftId, displayName: claims.name, email: normalizedEmail } }, user.role, groups);

        await AuditLog.create({
            userId: user._id,
            action: "Linked Microsoft account to existing user",
            entityType: "User",
            entityId: user._id,
            newValue: {
                email: user.email,
                microsoftId: user.microsoftId,
                aadEmail: user.aadEmail,
                role: user.role
            }
        });

        const token = createToken(user);
        const userData = user.toObject();
        delete userData.password;

        res.json({
            message: "Microsoft account linked and login successful.",
            user: userData,
            token
        });
    } catch (error) {
        console.error("Microsoft link error:", error);
        res.status(error.status || 500).json({ message: error.message || "Failed to link Microsoft account." });
    }
});

// PASSWORD RESET REQUEST (public route)
router.post("/forgot-password", async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                message: "Email is required"
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        if (!EMAIL_PATTERN.test(normalizedEmail)) {
            return res.status(400).json({ message: "Enter a valid email address" });
        }
        const user = await User.findOne({ email: normalizedEmail, isActive: true });

        if (user) {
            await AuditLog.create({
                userId: user._id,
                action: "Password reset requested",
                entityType: "User",
                entityId: user._id,
                newValue: {
                    email: normalizedEmail
                }
            });
        }

        res.json({
            message: "If an active account exists for this email, a reset request has been sent to the administrator."
        });
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Authenticated team directory for role workflows
router.get("/team", authenticate, authorizeRole("manager", "admin"), async (req, res) => {
    try {
        const query = req.user.role === "manager"
            ? { managerId: req.user._id, isActive: true, role: "employee" }
            : { isActive: true, role: "employee" };

        const employees = await User.find(query)
            .select("-password")
            .populate("managerId", "name email");

        res.json(employees);
    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Admin-only: Create user
router.post("/admin/users", authenticate, authorizeRole("admin"), async (req, res) => {
    try {
        const admin = req.user;

        const { name, email, password, confirmPassword, role, department, managerId, isActive } = req.body;
        const normalizedDepartment = department?.trim() || null;

        // Validate inputs
        if (!name || !email || !password || !role) {
            return res.status(400).json({
                message: "Name, email, password, and role are required"
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({
                message: "Passwords do not match"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                message: "Password must be at least 6 characters"
            });
        }

        if (!["employee", "manager", "admin"].includes(role)) {
            return res.status(400).json({
                message: "Invalid role"
            });
        }

        if (role === "employee") {
            if (!normalizedDepartment) {
                return res.status(400).json({
                    message: "Department is required for employees"
                });
            }

            const departmentManagerCount = await User.countDocuments({
                role: "manager",
                isActive: true,
                department: normalizedDepartment
            });

            if (managerId) {
                const manager = await User.findOne({
                    _id: managerId,
                    role: "manager",
                    isActive: true
                });

                if (!manager || (manager.department?.trim() || "") !== normalizedDepartment) {
                    return res.status(400).json({
                        message: "Assigned manager must be an active manager in the same department"
                    });
                }
            } else if (departmentManagerCount > 0) {
                return res.status(400).json({
                    message: "Employees in this department must be assigned to a manager"
                });
            }
        }

        // Check if email exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(409).json({
                message: "Email already exists"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = await User.create({
            name,
            email: email.toLowerCase(),
            password: hashedPassword,
            role,
            department: department || null,
            managerId: role === "employee" ? managerId : null,
            isActive: isActive !== false
        });

        // Log audit
        const AuditLog = require("../models/AuditLog");
        await AuditLog.create({
            userId: admin._id,
            action: "Created user",
            entityType: "User",
            entityId: user._id,
            newValue: { name, email, role }
        });

        const userData = user.toObject();
        delete userData.password;

        res.status(201).json({
            message: "User created successfully",
            user: userData
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Admin-only: Get all users
router.get("/admin/users", authenticate, authorizeRole("admin"), async (req, res) => {
    try {
        const users = await User.find().select("-password").populate("managerId", "name email");

        res.json(users);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Admin-only: Get single user
router.get("/admin/users/:id", authenticate, authorizeRole("admin"), async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select("-password").populate("managerId", "name email");

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        res.json(user);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Admin-only: Update user
router.put("/admin/users/:id", authenticate, authorizeRole("admin"), async (req, res) => {
    try {
        const admin = req.user;
        const { name, email, role, department, managerId, isActive } = req.body;

        // Find user
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        // Check email uniqueness if changed
        if (email && email.toLowerCase() !== user.email) {
            const existingUser = await User.findOne({ email: email.toLowerCase() });
            if (existingUser) {
                return res.status(409).json({
                    message: "Email already exists"
                });
            }
        }

        // Update fields
        if (name) user.name = name;
        if (email) user.email = email.toLowerCase();
        const nextRole = role && ["employee", "manager", "admin"].includes(role) ? role : user.role;
        if (role && ["employee", "manager", "admin"].includes(role)) user.role = role;
        if (department !== undefined) user.department = department;

        if (nextRole === "employee") {
            const nextDepartment = department !== undefined ? (department?.trim() || user.department) : user.department;
            const normalizedDepartment = nextDepartment?.trim() || null;

            if (!normalizedDepartment) {
                return res.status(400).json({
                    message: "Department is required for employees"
                });
            }

            const managerQuery = {
                role: "manager",
                isActive: true,
                department: normalizedDepartment
            };

            if (user._id && user.role === "manager") {
                managerQuery._id = { $ne: user._id };
            }

            const departmentManagerCount = await User.countDocuments(managerQuery);

            if (managerId) {
                const manager = await User.findOne({
                    _id: managerId,
                    role: "manager",
                    isActive: true
                });

                if (!manager || (manager.department?.trim() || "") !== normalizedDepartment) {
                    return res.status(400).json({
                        message: "Assigned manager must be an active manager in the same department"
                    });
                }
                user.managerId = managerId;
            } else if (departmentManagerCount > 0) {
                return res.status(400).json({
                    message: "Employees in this department must be assigned to a manager"
                });
            } else {
                user.managerId = null;
            }
        }
        if (nextRole !== "employee") user.managerId = null;
        if (isActive !== undefined) user.isActive = isActive;

        await user.save();

        // Log audit
        const AuditLog = require("../models/AuditLog");
        await AuditLog.create({
            userId: admin._id,
            action: "Updated user",
            entityType: "User",
            entityId: user._id,
            newValue: { name, email, role, department, isActive }
        });

        const userData = user.toObject();
        delete userData.password;

        res.json({
            message: "User updated successfully",
            user: userData
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Admin-only: Reset user password
router.put("/admin/users/:id/reset-password", authenticate, authorizeRole("admin"), async (req, res) => {
    try {
        const admin = req.user;
        const { newPassword, confirmPassword } = req.body;

        if (!newPassword || !confirmPassword) {
            return res.status(400).json({
                message: "New password and confirmation are required"
            });
        }

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                message: "Passwords do not match"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                message: "Password must be at least 6 characters"
            });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        // Log audit
        const AuditLog = require("../models/AuditLog");
        await AuditLog.create({
            userId: admin._id,
            action: "Reset password",
            entityType: "User",
            entityId: user._id
        });

        res.json({
            message: "Password reset successfully"
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Admin-only: Delete user
router.delete("/admin/users/:id", authenticate, authorizeRole("admin"), async (req, res) => {
    try {
        const admin = req.user;
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        // Don't allow deleting the last admin
        if (user.role === "admin") {
            const adminCount = await User.countDocuments({ role: "admin" });
            if (adminCount === 1) {
                return res.status(400).json({
                    message: "Cannot delete the only administrator"
                });
            }
        }

        // Log audit before deletion
        const AuditLog = require("../models/AuditLog");
        await AuditLog.create({
            userId: admin._id,
            action: "Deleted user",
            entityType: "User",
            entityId: user._id,
            newValue: { name: user.name, email: user.email, role: user.role }
        });

        await User.findByIdAndDelete(req.params.id);

        res.json({
            message: "User deleted successfully"
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Seed demo users (run once to initialize)
router.post("/seed-demo-users", async (req, res) => {
    try {
        const demoUsers = [
            {
                name: "Admin User",
                email: "admin@test.com",
                password: "admin123",
                role: "admin",
                department: "Management",
                isActive: true
            },
            {
                name: "Manager User",
                email: "manager@test.com",
                password: "manager123",
                role: "manager",
                department: "Sales",
                isActive: true
            },
            {
                name: "Vipul Kumar",
                email: "vipul@test.com",
                password: "employee123",
                role: "employee",
                department: "Engineering",
                isActive: true
            }
        ];

        const results = [];

        for (const demoUser of demoUsers) {
            const existingUser = await User.findOne({ email: demoUser.email });
            const hashedPassword = await bcrypt.hash(demoUser.password, 10);
            const saved = await User.findOneAndUpdate(
                { email: demoUser.email },
                {
                    ...demoUser,
                    password: hashedPassword,
                    isActive: true
                },
                { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
            );

            results.push({
                email: demoUser.email,
                status: existingUser ? "updated" : "created",
                message: existingUser ? "Demo user reset" : "Demo user created",
                userId: saved._id
            });
        }

        // Link manager to employee
        const employee = await User.findOne({ email: "vipul@test.com" });
        const manager = await User.findOne({ email: "manager@test.com" });

        if (employee && manager) {
            employee.managerId = manager._id;
            await employee.save();
        }

        res.json({
            message: "Demo users seed completed",
            results
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

module.exports = router;
