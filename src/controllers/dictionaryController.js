const prisma = require("../utils/prismaClient");
const {
  startDictionaryBatch,
  getIsRunning,
  startAutoRun,
  stopAutoRun,
  getIsAutoLoopRunning,
  JOB_TYPE,
} = require("../jobs/dictionaryBatchRunner");

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
  res.json({ job, isProcessing: getIsRunning(), isAutoLoopRunning: getIsAutoLoopRunning() });
};

const startAuto = async (req, res) => {
  const job = await startAutoRun();
  res.status(202).json({ started: true, job });
};

// Only flips the flag — the current question (if any) still finishes
// normally, the loop notices and exits after that, never mid-question.
const stopAuto = async (req, res) => {
  const job = await stopAutoRun();
  res.json({ stopped: true, job });
};

const MAX_PAGE_SIZE = 100;

const listEntries = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 20));
  const status = ["pending", "completed", "failed"].includes(req.query.status) ? req.query.status : undefined;
  const search = req.query.search?.trim();

  const where = {
    ...(status ? { status } : {}),
    ...(search ? { term: { contains: search } } : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.ai_dictionary.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ai_dictionary.count({ where }),
  ]);

  res.json({ entries, total, page, pageSize });
};

// Student-facing reads (via backend's proxy) — deliberately NEVER trigger
// generation. If a term hasn't been processed by a batch yet, it's just
// not returned/found; there is no live AI fallback here, on purpose (that
// would reintroduce the per-question AI cost this whole design avoids).

const getTermsForQuestion = async (req, res) => {
  const questionId = Number(req.params.questionId);
  if (!Number.isInteger(questionId)) {
    return res.status(400).json({ message: "Invalid questionId" });
  }

  const mappings = await prisma.ai_dictionary_mapping.findMany({
    where: { questionId, dictionary: { status: "completed" } },
    select: { dictionary: { select: { id: true, term: true } } },
  });

  res.json({ questionId, terms: mappings.map((m) => m.dictionary) });
};

const getTermExplanation = async (req, res) => {
  const term = req.params.term?.toLowerCase().trim();
  if (!term) {
    return res.status(400).json({ message: "Missing term" });
  }

  const entry = await prisma.ai_dictionary.findUnique({ where: { term } });

  if (!entry || entry.status !== "completed") {
    return res.status(404).json({ message: "Term not found" });
  }

  res.json({
    term: entry.term,
    meaning: entry.meaning,
    simpleExplanation: entry.simpleExplanation,
    eli5: entry.eli5,
    detailedExplanation: entry.detailedExplanation,
    mnemonic: entry.mnemonic,
    realLifeExample: entry.realLifeExample,
  });
};

module.exports = {
  runBatch,
  getProgress,
  listEntries,
  getTermsForQuestion,
  getTermExplanation,
  startAuto,
  stopAuto,
};
