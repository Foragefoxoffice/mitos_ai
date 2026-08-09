const prisma = require("../utils/prismaClient");
const logger = require("../utils/logger");
const { generateDictionaryEntry } = require("./dictionaryGenerator");
const { sleep } = require("../utils/sleep");
const { JOB_TYPE } = require("../jobs/dictionaryBatchRunner");

// Same spacing dictionaryBatchRunner.js uses for provider calls — kept as
// its own read here rather than importing that module's constant, since
// it's a single env lookup with a matching fallback, not shared state.
const AI_CALL_DELAY_MS = Number(process.env.AI_CALL_DELAY_MS) || 15000;

const incrementJobCounter = (field) =>
  prisma.ai_job
    .updateMany({ where: { type: JOB_TYPE }, data: { [field]: { increment: 1 }, lastRunAt: new Date() } })
    .catch(() => {});

// Regenerates ONE term — works whether it's an existing "failed" row (the
// cursor-driven batch runner never revisits those on its own once it's
// moved past every question that referenced them, see dictionaryBatchRunner
// comments) or a brand-new term an admin is adding by hand because
// extraction missed it. Bypasses the batch runner's manuallyEdited guard on
// purpose — an explicit admin click here should always proceed, regardless
// of that flag.
const retryTerm = async (rawTerm) => {
  const term = String(rawTerm || "").toLowerCase().trim();
  if (!term) {
    throw new Error("term is required");
  }

  try {
    const generated = await generateDictionaryEntry(term);
    const entry = await prisma.ai_dictionary.upsert({
      where: { term },
      update: {
        meaning: generated.meaning,
        simpleExplanation: generated.simpleExplanation,
        eli5: generated.eli5,
        detailedExplanation: generated.detailedExplanation,
        mnemonic: generated.mnemonic,
        realLifeExample: generated.realLifeExample,
        status: "completed",
        failureReason: null,
        generatedByProvider: generated.provider,
        generatedByModel: generated.model,
      },
      create: {
        term,
        meaning: generated.meaning,
        simpleExplanation: generated.simpleExplanation,
        eli5: generated.eli5,
        detailedExplanation: generated.detailedExplanation,
        mnemonic: generated.mnemonic,
        realLifeExample: generated.realLifeExample,
        status: "completed",
        generatedByProvider: generated.provider,
        generatedByModel: generated.model,
      },
    });
    await incrementJobCounter("totalCreated");
    return entry;
  } catch (error) {
    logger.warn(`[dictionaryRetryService] retry failed for "${term}": ${error.message}`);
    const entry = await prisma.ai_dictionary.upsert({
      where: { term },
      update: { status: "failed", failureReason: error.message },
      create: { term, status: "failed", failureReason: error.message },
    });
    await incrementJobCounter("totalFailed");
    return entry;
  }
};

const setActivity = (text) =>
  prisma.ai_job.updateMany({ where: { type: JOB_TYPE }, data: { currentActivity: text } }).catch(() => {});

// Sweeps up to `limit` failed rows, same throttle spacing as the batch
// runner between provider calls. Bounded like "Run Next Batch" (not "retry
// everything at once") so this can't turn into an unbounded run.
const runRetryFailedBatch = async ({ limit = 5 } = {}) => {
  const failedEntries = await prisma.ai_dictionary.findMany({
    where: { status: "failed" },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  let succeeded = 0;
  let stillFailed = 0;

  for (const [index, entry] of failedEntries.entries()) {
    if (index > 0) {
      await setActivity(`Retrying failed terms: waiting to respect rate limit…`);
      await sleep(AI_CALL_DELAY_MS);
    }
    await setActivity(`Retrying failed terms (${index + 1}/${failedEntries.length}): "${entry.term}"…`);
    const result = await retryTerm(entry.term);
    if (result.status === "completed") {
      succeeded++;
    } else {
      stillFailed++;
    }
  }

  await setActivity(null);
  return { attempted: failedEntries.length, succeeded, stillFailed };
};

// In-memory guard, same reasoning as dictionaryBatchRunner's isRunning: a
// single ai-service process, so a plain flag is enough to stop a double
// click (or a second admin) from starting an overlapping retry sweep.
let isRetrying = false;
const getIsRetrying = () => isRetrying;

// Fire-and-forget — mirrors startDictionaryBatch. backend's proxy to
// ai-service has a 15s axios timeout (see aiController.js); a batch of
// several throttled (15s-spaced) provider calls would blow well past that
// if this blocked the request, so this returns immediately and the admin
// UI polls /progress (currentActivity + totalCreated/totalFailed) the same
// way it already does for "Run Next Batch".
const startRetryFailedBatch = ({ limit } = {}) => {
  if (isRetrying) {
    return { started: false, message: "A retry sweep is already running" };
  }

  isRetrying = true;
  runRetryFailedBatch({ limit })
    .catch((error) => {
      logger.error(`[dictionaryRetryService] retry sweep crashed: ${error.message}`);
    })
    .finally(() => {
      isRetrying = false;
    });

  return { started: true, message: "Retry sweep started" };
};

module.exports = { retryTerm, startRetryFailedBatch, getIsRetrying };
