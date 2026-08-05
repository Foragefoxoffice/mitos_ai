const prisma = require("../utils/prismaClient");
const { startDictionaryBatch, getIsRunning, JOB_TYPE } = require("../jobs/dictionaryBatchRunner");

// Hard server-side ceiling — independent of whatever the caller (admin UI)
// requests. Protects against an accidental large run regardless of what the
// client sends.
const MAX_BATCH_SIZE = Number(process.env.DICTIONARY_MAX_BATCH_SIZE) || 50;

const runBatch = (req, res) => {
  const requested = Number(req.body?.batchSize) || 20;
  const batchSize = Math.min(requested, MAX_BATCH_SIZE);

  const result = startDictionaryBatch({ batchSize });

  if (!result.started) {
    return res.status(409).json(result);
  }

  res.status(202).json(result);
};

const getProgress = async (req, res) => {
  const job = await prisma.ai_job.findUnique({ where: { type: JOB_TYPE } });
  res.json({ job, isProcessing: getIsRunning() });
};

module.exports = { runBatch, getProgress };
