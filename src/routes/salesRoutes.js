const express = require("express");
const ctrl = require("../controllers/salesAgentController");

const router = express.Router();

router.post("/reply", ctrl.postReply);

module.exports = router;
