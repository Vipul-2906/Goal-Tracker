const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const authRoutes = require("./routes/authRoutes");
const goalRoutes = require("./routes/goalRoutes");
const updateRoutes = require("./routes/updateRoutes");
const sharedGoalRoutes = require("./routes/sharedGoalRoutes");
const auditRoutes = require("./routes/auditRoutes");
const reportRoutes = require("./routes/reportRoutes");
const cycleRoutes = require("./routes/cycleRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const escalationRoutes = require("./routes/escalationRoutes");
const { startEscalationScheduler } = require("./utils/escalationService");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/goals", goalRoutes);
app.use("/api/updates", updateRoutes);
app.use("/api/shared-goals", sharedGoalRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/cycles", cycleRoutes.router);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/escalations", escalationRoutes);

// Debug: confirm escalations route is mounted
app.get("/api/escalations/__health", (req, res) => {
    res.json({ ok: true });
});


app.get("/", (req, res) => {
    res.send("Goal Tracker Backend Running");
});

// Debug: verify base API works
app.get("/api/__health", (req, res) => {
    res.json({ ok: true });
});


const PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGO_URI)
.then(() => {
    console.log("MongoDB Connected");

    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        startEscalationScheduler();
    });
})
.catch((err) => {
    console.log(err);
});
