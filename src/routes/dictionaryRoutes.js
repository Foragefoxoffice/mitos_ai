const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/dictionaryController");

router.post("/generate-batch", ctrl.runBatch);
router.get("/progress", ctrl.getProgress);
router.get("/entries", ctrl.listEntries);

module.exports = router;
