const prisma = require("../utils/prismaClient");
const {
  startDictionaryBatch,
  getIsRunning,
  startAutoRun,
  stopAutoRun,
  getIsAutoLoopRunning,
  JOB_TYPE,
} = require("../jobs/dictionaryBatchRunner");
const { retryTerm, startRetryFailedBatch, getIsRetrying } = require("../services/dictionaryRetryService");

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
  res.json({
    job,
    isProcessing: getIsRunning(),
    isAutoLoopRunning: getIsAutoLoopRunning(),
    isRetrying: getIsRetrying(),
  });
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

  // source: "practice" — a test-series question can share the same numeric
  // id as a practice question (independent id sequences), so this must stay
  // scoped now that ai_dictionary_mapping disambiguates by source. See
  // testSeriesDictionaryController.js for the test-series equivalent.
  const mappings = await prisma.ai_dictionary_mapping.findMany({
    where: { questionId, source: "practice", dictionary: { status: "completed" } },
    select: { dictionary: { select: { id: true, term: true } } },
  });

  res.json({ questionId, terms: mappings.map((m) => m.dictionary) });
};

const getTermExplanation = async (req, res) => {
  const term = req.params.term?.toLowerCase().trim();
  if (!term) {
    return res.status(400).json({ message: "Missing term" });
  }

  // findFirst, not findUnique — `term` alone stopped being a unique key
  // once entries got scoped by subject (term_subject is the real unique
  // key now, see schema.prisma), and the mobile client doesn't send a
  // subject here (the WebView term-tap handler only round-trips the bare
  // term string — see highlightTerms.js/HighlightedMathText.jsx). An
  // app-side fix to thread the subject (or dictionary id, which the
  // client already has from getTermsForQuestion) through would let this
  // go back to an exact lookup; until then, best-effort "any completed
  // entry for this term" is far better than 500ing on every single tap.
  // Not a rare edge case either — 2,749 of 45,882 completed entries
  // (~6%, measured 2026-08-28) share a term across subjects, skewed
  // toward common cross-subject vocabulary (pressure/energy/density/
  // temperature/etc.), so this can genuinely show the wrong subject's
  // explanation until the client-side fix lands. orderBy pins it to the
  // same (lowest-id) entry every time at least, so a given term shows a
  // consistent explanation across repeat taps instead of flapping.
  const entry = await prisma.ai_dictionary.findFirst({
    where: { term, status: "completed" },
    orderBy: { id: "asc" },
  });

  if (!entry) {
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

// Single term, synchronous — works for both an existing "failed" row and a
// brand-new term the extractor never picked up (an admin manually adding
// an important keyword). Runs inline (not fire-and-forget) since it's one
// provider call, same latency class as a single chat reply, which already
// completes within backend's 15s proxy timeout.
const retryOne = async (req, res) => {
  const term = req.body?.term;
  if (!term || !String(term).trim()) {
    return res.status(400).json({ message: "term is required" });
  }

  try {
    const entry = await retryTerm(term);
    res.json({ entry });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Bounded sweep of failed rows — fire-and-forget, same shape as runBatch
// (202 + started flag; admin polls /progress for currentActivity and
// totalCreated/totalFailed movement).
const MAX_RETRY_BATCH_SIZE = Number(process.env.DICTIONARY_MAX_RETRY_BATCH_SIZE) || 20;

const retryFailed = (req, res) => {
  const requested = Number(req.body?.limit) || 5;
  const limit = Math.min(requested, MAX_RETRY_BATCH_SIZE);

  const result = startRetryFailedBatch({ limit });

  if (!result.started) {
    return res.status(409).json(result);
  }

  res.status(202).json(result);
};

module.exports = {
  runBatch,
  getProgress,
  listEntries,
  getTermsForQuestion,
  getTermExplanation,
  retryOne,
  retryFailed,
  startAuto,
  stopAuto,
};
