const express = require("express");
const router = express.Router();
const { verifyInternalService } = require("../middlewares/internalAuth");

router.use("/health", require("./healthRoutes"));

// Everything under /internal requires the shared service-key header —
// only backend calls these. Feature routes (dictionary, chat, wallet...)
// get mounted here sprint by sprint.
const internal = express.Router();
internal.use(verifyInternalService);
internal.use("/ai/dictionary", require("./dictionaryRoutes"));
internal.use("/ai/chat", require("./chatRoutes"));

router.use("/internal", internal);

module.exports = router;
