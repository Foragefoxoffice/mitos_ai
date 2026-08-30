const prisma = require("../utils/prismaClient");
const practiceRunner = require("../jobs/translationBatchRunner");
const testSeriesRunner = require("../jobs/testSeriesTranslationBatchRunner");

// Mirrors dictionaryController.js/testSeriesDictionaryController.js's
// split, but as one controller with a `source` selector rather than two
// separate files — the two runners are genuinely near-identical (same
// job factory, different fetch function/source tag), so a switch here is
// less duplication than two whole controller files.
const runnerFor = (source) => (source === "test_series" ? testSeriesRunner : practiceRunner);

// Hard server-side ceiling, same rationale as dictionaryController.js's
// MAX_BATCH_SIZE — independent of whatever the admin UI requests.
const MAX_BATCH_SIZE = Number(process.env.TRANSLATION_MAX_BATCH_SIZE) || 20;

const runBatch = (req, res) => {
  const source = req.body?.source === "test_series" ? "test_series" : "practice";
  const requested = Number(req.body?.batchSize) || 5;
  const batchSize = Math.min(requested, MAX_BATCH_SIZE);

  const result = runnerFor(source).startTranslationBatch({ batchSize });

  if (!result.started) {
    return res.status(409).json(result);
  }

  res.status(202).json(result);
};

// Returns BOTH sources' job status together — the admin UI shows practice
// and test_series progress side by side, same as it does for AI
// Dictionary's two separate pages, but this pipeline's progress endpoint
// is cheap enough (two ai_job reads) to just return both in one call.
const getProgress = async (req, res) => {
  const [practiceJob, testSeriesJob] = await Promise.all([
    prisma.ai_job.findUnique({ where: { type: practiceRunner.JOB_TYPE } }),
    prisma.ai_job.findUnique({ where: { type: testSeriesRunner.JOB_TYPE } }),
  ]);

  res.json({
    practice: { job: practiceJob, isProcessing: practiceRunner.getIsRunning() },
    test_series: { job: testSeriesJob, isProcessing: testSeriesRunner.getIsRunning() },
  });
};

const MAX_PAGE_SIZE = 100;

const listEntries = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || 20));
  const status = ["pending", "generating", "completed", "failed"].includes(req.query.status) ? req.query.status : undefined;
  const source = ["practice", "test_series"].includes(req.query.source) ? req.query.source : undefined;
  // languageId, not language code — the client doesn't need to know the
  // internal id, but filtering by it directly avoids a join for this one
  // read; the entries list only needs to show the language name, which
  // getLanguages already gives the admin UI to build a picker from.
  const languageId = Number(req.query.languageId) || undefined;
  // Exact match, not a text search — questionId is a soft ref to another
  // database's numeric PK, not something to fuzzy-match on.
  const questionId = Number(req.query.questionId) || undefined;

  const where = {
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(languageId ? { languageId } : {}),
    ...(questionId ? { questionId } : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.ai_question_translation.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.ai_question_translation.count({ where }),
  ]);

  res.json({ entries, total, page, pageSize });
};

const getLanguages = async (req, res) => {
  const languages = await prisma.ai_language.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } });
  res.json({ languages });
};

// Student-facing read (via backend's proxy) — deliberately never triggers
// generation, same "if it's not there yet, it's just not there" contract
// as dictionaryController.js's getTermsForQuestion. Falls back to null
// (not an error) when no completed translation exists yet for this
// question+language — the design doc's §6 says the API should always
// return something renderable, with the client falling back to English;
// returning null here (rather than 404) lets the backend proxy do exactly
// that without needing to special-case a 404.
const getTranslationForQuestion = async (req, res) => {
  const questionId = Number(req.params.questionId);
  if (!Number.isInteger(questionId)) {
    return res.status(400).json({ message: "Invalid questionId" });
  }

  const source = req.query.source === "test_series" ? "test_series" : "practice";
  const languageCode = req.query.lang || "hi";

  const language = await prisma.ai_language.findUnique({ where: { code: languageCode } });
  if (!language) {
    return res.json({ questionId, translation: null });
  }

  const translation = await prisma.ai_question_translation.findFirst({
    where: { questionId, languageId: language.id, source, status: "completed" },
  });

  res.json({ questionId, translation: translation || null });
};

module.exports = { runBatch, getProgress, listEntries, getLanguages, getTranslationForQuestion };
