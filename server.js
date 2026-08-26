const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

// Only backend should ever call this service. No browser origin needs access.
app.use(
  cors({
    origin: process.env.ALLOWED_CALLER_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  })
);

app.use("/", require("./src/routes"));

const PORT = process.env.PORT || 4001;

app.listen(PORT, () => {
  console.log(`✅ ai-service running on port ${PORT}`);

  // If auto-run was left enabled before this process last stopped (crash,
  // redeploy, manual restart), resume it — "keep running until I stop it"
  // is meant to survive the process bouncing, not just the browser tab
  // staying open.
  require("./src/jobs/dictionaryBatchRunner")
    .resumeAutoRunIfEnabled()
    .catch((error) => console.error("❌ Failed to check/resume auto-run on boot:", error.message));

  require("./src/jobs/testSeriesDictionaryBatchRunner")
    .resumeAutoRunIfEnabled()
    .catch((error) => console.error("❌ Failed to check/resume test-series auto-run on boot:", error.message));
});
