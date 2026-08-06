const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/dictionaryController");

router.post("/generate-batch", ctrl.runBatch);
router.get("/progress", ctrl.getProgress);
router.get("/entries", ctrl.listEntries);
router.get("/for-question/:questionId", ctrl.getTermsForQuestion);
router.get("/term/:term", ctrl.getTermExplanation);

module.exports = router;
