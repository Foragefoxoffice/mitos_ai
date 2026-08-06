const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/chatController");

router.post("/message", ctrl.postMessage);
router.get("/history/:questionId", ctrl.getHistoryHandler);

module.exports = router;
