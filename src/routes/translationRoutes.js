const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/translationController");

router.post("/generate-batch", ctrl.runBatch);
router.get("/progress", ctrl.getProgress);
router.get("/entries", ctrl.listEntries);
router.get("/languages", ctrl.getLanguages);
router.get("/for-question/:questionId", ctrl.getTranslationForQuestion);

module.exports = router;
