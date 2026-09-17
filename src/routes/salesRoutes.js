const express = require("express");
const ctrl = require("../controllers/salesAgentController");

const router = express.Router();

router.post("/reply", ctrl.postReply);
router.get("/knowledge", ctrl.getKnowledge);
router.put("/knowledge", ctrl.updateKnowledge);
router.get("/rules", ctrl.getRules);
router.post("/rules", ctrl.createRule);
router.delete("/rules/:id", ctrl.removeRule);

module.exports = router;
