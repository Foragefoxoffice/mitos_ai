const prisma = require("../utils/prismaClient");
const {
  startDictionaryBatch,
  getIsRunning,
  startAutoRun,
  stopAutoRun,
  getIsAutoLoopRunning,
  JOB_TYPE,
} = require("../jobs/testSeriesDictionaryBatchRunner");

// Sibling to dictionaryController.js's batch/progress/auto-run endpoints,
// pointed at the test-series job instance. listEntries is intentionally
// NOT duplicated here — ai_dictionary terms are shared across sources (see
// createDictionaryBatchJob.js), so the existing "View Entries" admin page
// already shows everything this job produces too; only the job-scoped
// (progress/batch/auto-run) and mapping-scoped (student-facing lookup)
// operations need a source-specific version.
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
  res.json({
    job,
    isProcessing: getIsRunning(),
    isAutoLoopRunning: getIsAutoLoopRunning(),
  });
};

const startAuto = async (req, res) => {
  const job = await startAutoRun();
  res.status(202).json({ started: true, job });
};

const stopAuto = async (req, res) => {
  const job = await stopAutoRun();
  res.json({ stopped: true, job });
};

// Student-facing read, mirrors dictionaryController.js's
// getTermsForQuestion — scoped to source: "test_series" so a test-series
// question never picks up a practice question's mappings (or vice versa)
// just because they happen to share a numeric id.
const getTermsForQuestion = async (req, res) => {
  const questionId = Number(req.params.questionId);
  if (!Number.isInteger(questionId)) {
    return res.status(400).json({ message: "Invalid questionId" });
  }

  const mappings = await prisma.ai_dictionary_mapping.findMany({
    where: { questionId, source: "test_series", dictionary: { status: "completed" } },
    select: { dictionary: { select: { id: true, term: true } } },
  });

  res.json({ questionId, terms: mappings.map((m) => m.dictionary) });
};

module.exports = { runBatch, getProgress, startAuto, stopAuto, getTermsForQuestion };
