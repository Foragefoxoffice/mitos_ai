const prisma = require("../utils/prismaClient");
const logger = require("../utils/logger");
const { extractKeywordsWithAI } = require("../services/keywordExtractor");
const { generateDictionaryEntry } = require("../services/dictionaryGenerator");
const { fetchQuestionBatch } = require("../services/questionSource");
const { sleep } = require("../utils/sleep");

const JOB_TYPE = "dictionary_generation";

// Gemini's free tier is 5 requests/minute — a batch with no throttling burns
// through that in seconds. Default spacing (15s = 4/min) leaves margin
// under the limit for the rolling window (verified live: 13s spacing still
// hit a 429 when stacked with other manual calls in the same minute); only
// applied before calls that actually hit a provider, never on the
// dedup-skip path. Raise/lower via env once real quota (or a paid tier) is
// known.
const AI_CALL_DELAY_MS = Number(process.env.AI_CALL_DELAY_MS) || 15000;

// Small helper: updates what the batch is doing RIGHT NOW, so admin
// polling /progress sees real activity instead of just totals that jump
// occasionally every ~15s. Cheap write, called often on purpose.
const setActivity = (jobId, text) =>
  prisma.ai_job.update({ where: { id: jobId }, data: { currentActivity: text } }).catch(() => {});

// Runs ONE batch and stops — never the whole question bank in one call.
// Resumable: picks up from job.cursor (the highest question id processed so
// far), so calling this again later — including after new questions get
// added to the bank — always continues instead of restarting or
// reprocessing. Terms are deduped against ai_dictionary before any AI call,
// so a term shared across many questions is only ever generated once.
//
// Progress (cursor, totalProcessed/Created/Skipped/Failed) is persisted
// after every term and every question, not batched up for one write at the
// end — with throttled calls this can run for minutes, so a crash mid-run
// loses at most the current in-flight term, and admin polling /progress
// sees live movement instead of one jump at completion.
const runDictionaryBatch = async ({ batchSize } = {}) => {
  let job = await prisma.ai_job.findUnique({ where: { type: JOB_TYPE } });

  if (!job) {
    job = await prisma.ai_job.create({
      data: { type: JOB_TYPE, status: "running", batchSize: batchSize || 20, startedAt: new Date() },
    });
  } else {
    job = await prisma.ai_job.update({ where: { id: job.id }, data: { status: "running" } });
  }

  const effectiveBatchSize = batchSize || job.batchSize;
  const questions = await fetchQuestionBatch({ afterId: job.cursor, limit: effectiveBatchSize });

  if (questions.length === 0) {
    const idleJob = await prisma.ai_job.update({
      where: { id: job.id },
      data: {
        status: "idle",
        lastRunAt: new Date(),
        currentActivity: null,
        currentBatchTotal: null,
        currentBatchProcessed: null,
      },
    });
    return { job: idleJob, processed: 0, created: 0, skipped: 0, failed: 0, message: "No new questions to process" };
  }

  await prisma.ai_job.update({
    where: { id: job.id },
    data: {
      currentBatchTotal: questions.length,
      currentBatchProcessed: 0,
      currentActivity: `Starting batch of ${questions.length} question${questions.length === 1 ? "" : "s"}…`,
    },
  });

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let hasCalledProvider = false;

  for (const [index, question] of questions.entries()) {
    const position = `${index + 1}/${questions.length}`;

    // Extraction is now an AI call (per question, not per term) — an LLM
    // can actually judge "technical term worth explaining" vs "everyday
    // word", which a rule-based length/stopword filter never could. Same
    // throttle applies to this call as to term generation below.
    if (hasCalledProvider) {
      await setActivity(job.id, `Question ${question.id} (${position}): waiting to respect rate limit…`);
      await sleep(AI_CALL_DELAY_MS);
    }
    hasCalledProvider = true;

    await setActivity(job.id, `Question ${question.id} (${position}): extracting keywords…`);

    let terms;
    try {
      terms = await extractKeywordsWithAI(question.question, question.hint);
    } catch (error) {
      logger.warn(`[dictionaryBatchRunner] keyword extraction failed for question ${question.id}: ${error.message}`);
      // Don't advance the cursor past a question we couldn't extract
      // terms from — stop here so the next batch run retries this same
      // question instead of silently skipping it forever.
      break;
    }

    for (const term of terms) {
      let dictEntry = await prisma.ai_dictionary.findUnique({ where: { term } });

      // A term with no entry needs generating. A term stuck in "failed"
      // ALSO needs (re)generating — a previous failure isn't a completed
      // result, and without this check a failed term would be skipped
      // forever, silently counted as "already have it". Only a completed
      // or manually-edited entry is actually reused.
      const needsGeneration = !dictEntry || (dictEntry.status === "failed" && !dictEntry.manuallyEdited);

      if (needsGeneration) {
        if (hasCalledProvider) {
          await setActivity(job.id, `Question ${question.id} (${position}): waiting to respect rate limit…`);
          await sleep(AI_CALL_DELAY_MS);
        }
        hasCalledProvider = true;

        await setActivity(job.id, `Question ${question.id} (${position}): generating explanation for "${term}"…`);

        try {
          const generated = await generateDictionaryEntry(term);
          dictEntry = await prisma.ai_dictionary.upsert({
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
          created++;
          await prisma.ai_job.update({
            where: { id: job.id },
            data: { totalCreated: { increment: 1 }, lastRunAt: new Date() },
          });
        } catch (error) {
          logger.warn(`[dictionaryBatchRunner] generation failed for "${term}": ${error.message}`);
          await prisma.ai_dictionary
            .upsert({
              where: { term },
              update: { status: "failed", failureReason: error.message },
              create: { term, status: "failed", failureReason: error.message },
            })
            .catch(() => {});
          failed++;
          await prisma.ai_job.update({
            where: { id: job.id },
            data: { totalFailed: { increment: 1 }, lastRunAt: new Date() },
          });
          continue;
        }
      } else {
        skipped++;
        await prisma.ai_job.update({ where: { id: job.id }, data: { totalSkipped: { increment: 1 } } });
      }

      await prisma.ai_dictionary_mapping.upsert({
        where: { dictionaryId_questionId: { dictionaryId: dictEntry.id, questionId: question.id } },
        update: {},
        create: { dictionaryId: dictEntry.id, questionId: question.id },
      });
    }

    await prisma.ai_job.update({
      where: { id: job.id },
      data: { cursor: question.id, totalProcessed: { increment: 1 }, currentBatchProcessed: index + 1 },
    });
  }

  const finalJob = await prisma.ai_job.update({
    where: { id: job.id },
    data: { currentActivity: null },
  });

  return { job: finalJob, processed: questions.length, created, skipped, failed };
};

// In-memory guard against overlapping runs — ai-service is a single
// process, so a plain flag is enough to stop a double-click (or a second
// admin) from starting a second batch while one is already in flight.
let isRunning = false;

const getIsRunning = () => isRunning;

// Fire-and-forget: starts a batch and returns immediately instead of
// blocking the HTTP request for however long the (throttled, potentially
// multi-minute) batch takes. Callers poll getDictionaryProgress-style reads
// of the ai_job row (and isRunning, for "actively working right now" vs.
// the job's persisted status) to watch it complete.
const startDictionaryBatch = ({ batchSize } = {}) => {
  if (isRunning) {
    return { started: false, message: "A batch is already running" };
  }

  isRunning = true;
  runDictionaryBatch({ batchSize })
    .catch(async (error) => {
      logger.error(`[dictionaryBatchRunner] batch run crashed: ${error.message}`);
      // Without this, a crash (e.g. bad DB credentials, network failure)
      // leaves the job silently stuck at "running" forever — admin polling
      // /progress would see no error and no further movement, with no way
      // to tell the batch actually failed short of reading server logs.
      await prisma.ai_job
        .updateMany({
          where: { type: JOB_TYPE },
          data: { status: "failed", lastError: error.message, currentActivity: null },
        })
        .catch(() => {});
    })
    .finally(() => {
      isRunning = false;
    });

  return { started: true, message: "Batch started" };
};

module.exports = { runDictionaryBatch, startDictionaryBatch, getIsRunning, JOB_TYPE };
