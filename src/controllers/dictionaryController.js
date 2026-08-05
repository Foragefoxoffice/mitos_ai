const prisma = require("../utils/prismaClient");
const { runDictionaryBatch, JOB_TYPE } = require("../jobs/dictionaryBatchRunner");

// Hard server-side ceiling — independent of whatever the caller (admin UI)
// requests. Protects against an accidental large run regardless of what the
// client sends.
const MAX_BATCH_SIZE = Number(process.env.DICTIONARY_MAX_BATCH_SIZE) || 50;

const runBatch = async (req, res) => {
  try {
    const requested = Number(req.body?.batchSize) || 20;
    const batchSize = Math.min(requested, MAX_BATCH_SIZE);

    const result = await runDictionaryBatch({ batchSize });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getProgress = async (req, res) => {
  const job = await prisma.ai_job.findUnique({ where: { type: JOB_TYPE } });
  res.json({ job });
};

module.exports = { runBatch, getProgress };
