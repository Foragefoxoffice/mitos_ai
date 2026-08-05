const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/dictionaryController");

router.post("/generate-batch", ctrl.runBatch);
router.get("/progress", ctrl.getProgress);

module.exports = router;
