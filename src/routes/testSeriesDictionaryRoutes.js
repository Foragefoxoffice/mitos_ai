const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/testSeriesDictionaryController");

router.post("/generate-batch", ctrl.runBatch);
router.post("/auto/start", ctrl.startAuto);
router.post("/auto/stop", ctrl.stopAuto);
router.get("/progress", ctrl.getProgress);
router.get("/for-question/:questionId", ctrl.getTermsForQuestion);

module.exports = router;
