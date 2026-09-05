const prisma = require("../utils/prismaClient");
const logger = require("../utils/logger");
const { translateQuestion } = require("../services/questionTranslator");
const { sleep } = require("../utils/sleep");

// Same throttle rationale as createDictionaryBatchJob.js's AI_CALL_DELAY_MS
// — kept as a separate env var (not shared) since translation and
// dictionary generation are different call volumes/patterns and may need
// different spacing once both are run for real.
const AI_CALL_DELAY_MS = Number(process.env.TRANSLATION_CALL_DELAY_MS) || 3000;
const TRANSLATION_CONCURRENCY = Number(process.env.TRANSLATION_CONCURRENCY) || 3;

// Bump whenever translationPrompt.js's actual output changes meaningfully
// — lets a future pass selectively regenerate only rows still on an older
// version (schema's own doc comment on this column). 2 = the reference-
// aware Hindi prompt (hindiReferenceMatcher.js, 2026-08-31); 1 = the
// original generic prompt.
const PROMPT_VERSION = 2;

// Identical helper to createDictionaryBatchJob.js's runWithConcurrency —
// duplicated rather than extracted to a shared util, since these two job
// files are otherwise independent and a shared dependency between them
// isn't worth the coupling for one small function.
const runWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const runLane = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  const lanes = Array.from({ length: Math.min(limit, items.length) }, () => runLane());
  await Promise.all(lanes);
  return results;
};

// Builds a full translation batch job — resumable cursor, batch runner,
// auto-run loop — for one (question source, language) pair. Mirrors
// createDictionaryBatchJob.js's shape closely (same ai_job usage, same
// resumable-cursor-stops-at-first-failure guarantee, same fire-and-forget
// startBatch), but simpler: no cross-question consistency prefetch is
// needed here (each question's translation is fully independent, unlike
// keyword extraction's term-dedup concern).
//
// `source` tags every ai_question_translation row this instance creates
// ("practice" | "test_series") — see that model's `source` column comment
// for why (mirrors ai_dictionary_mapping's identical need).
// `languageId`, not a `language` object — runner instantiation (see
// translationBatchRunner.js) happens synchronously at module load, same
// as dictionaryBatchRunner.js, but the language's name/nativeName live in
// the DB. Resolved fresh inside runTranslationBatch (once per batch call,
// not per question) instead — also means an admin editing a language's
// name takes effect on the next batch run with no server restart needed.
const createTranslationBatchJob = ({ jobType, fetchQuestionBatch, source, languageId }) => {
  // Translates ONE question's fields and upserts the result. Never
  // advances job.cursor or currentBatchProcessed directly — same reason
  // as createDictionaryBatchJob.js: under concurrency, questions finish
  // out of order, so only the caller (after seeing every outcome) can
  // safely decide how far the cursor may move.
  const processQuestion = async (question, jobId, language) => {
    try {
      const result = await translateQuestion({
        language,
        fields: {
          question: question.question,
          optionA: question.optionA,
          optionB: question.optionB,
          optionC: question.optionC,
          optionD: question.optionD,
          hint: question.hint,
        },
      });

      if (result.mathWarnings) {
        logger.warn(
          `[createTranslationBatchJob:${jobType}] question ${question.id}: math placeholder mismatch — ${JSON.stringify(result.mathWarnings)}`
        );
      }

      // Not a defect — just flags questions the current reference data
      // (past-paper extraction only, NCERT not yet processed) doesn't
      // cover, so they only got the always-on fixed templates, not
      // syllabus-term grounding. Grep for this line to audit coverage.
      if (result.matchedTermCount === 0) {
        logger.info(
          `[createTranslationBatchJob:${jobType}] question ${question.id}: 0 terminology matches (fixed templates only)`
        );
      }

      await prisma.ai_question_translation.upsert({
        where: { questionId_languageId_source: { questionId: question.id, languageId: language.id, source } },
        update: {
          question: result.question,
          optionA: result.optionA,
          optionB: result.optionB,
          optionC: result.optionC,
          optionD: result.optionD,
          hint: result.hint,
          status: "completed",
          failureReason: null,
          generatedByProvider: result.provider,
          generatedByModel: result.model,
          sourceHash: result.sourceHash,
          promptVersion: PROMPT_VERSION,
        },
        create: {
          questionId: question.id,
          languageId: language.id,
          source,
          question: result.question,
          optionA: result.optionA,
          optionB: result.optionB,
          optionC: result.optionC,
          optionD: result.optionD,
          hint: result.hint,
          status: "completed",
          generatedByProvider: result.provider,
          generatedByModel: result.model,
          sourceHash: result.sourceHash,
          promptVersion: PROMPT_VERSION,
        },
      });

      await prisma.ai_job.update({
        where: { id: jobId },
        data: { totalCreated: { increment: 1 }, lastRunAt: new Date() },
      });

      return { question, failed: false };
    } catch (error) {
      logger.warn(`[createTranslationBatchJob:${jobType}] translation failed for question ${question.id}: ${error.message}`);

      await prisma.ai_question_translation
        .upsert({
          where: { questionId_languageId_source: { questionId: question.id, languageId: language.id, source } },
          update: { status: "failed", failureReason: error.message },
          create: { questionId: question.id, languageId: language.id, source, status: "failed", failureReason: error.message },
        })
        .catch(() => {});

      await prisma.ai_job.update({
        where: { id: jobId },
        data: { totalFailed: { increment: 1 }, lastRunAt: new Date() },
      });

      return { question, failed: true };
    }
  };

  // Runs ONE batch and stops. Resumable via job.cursor — same guarantee as
  // createDictionaryBatchJob.js: a failed question halts cursor
  // advancement right there (its own row is still saved as "failed" for
  // later retry), everything after it in this batch is valid completed
  // work that just gets harmlessly redone (fast — upsert overwrites) on
  // the next run before the cursor catches up to it.
  const runTranslationBatch = async ({ batchSize } = {}) => {
    const language = await prisma.ai_language.findUnique({ where: { id: languageId } });
    if (!language) {
      throw new Error(`ai_language id ${languageId} not found — was it deleted?`);
    }

    let job = await prisma.ai_job.findUnique({ where: { type: jobType } });

    if (!job) {
      job = await prisma.ai_job.create({
        data: { type: jobType, status: "running", batchSize: batchSize || 10, startedAt: new Date() },
      });
    } else {
      job = await prisma.ai_job.update({ where: { id: job.id }, data: { status: "running" } });
    }

    const effectiveBatchSize = batchSize || job.batchSize;
    const questions = await fetchQuestionBatch({ afterId: job.cursor, limit: effectiveBatchSize });

    if (questions.length === 0) {
      const idleJob = await prisma.ai_job.update({
        where: { id: job.id },
        data: { status: "idle", lastRunAt: new Date(), currentActivity: null, currentBatchTotal: null, currentBatchProcessed: null },
      });
      return { job: idleJob, processed: 0, failed: 0, message: "No new questions to process" };
    }

    const lanes = Math.min(TRANSLATION_CONCURRENCY, questions.length);
    await prisma.ai_job.update({
      where: { id: job.id },
      data: {
        currentBatchTotal: questions.length,
        currentBatchProcessed: 0,
        currentActivity: `Translating ${questions.length} question${questions.length === 1 ? "" : "s"} to ${language.name} (${lanes} at a time)…`,
      },
    });

    const results = await runWithConcurrency(questions, lanes, async (question) => {
      await sleep(AI_CALL_DELAY_MS);
      const result = await processQuestion(question, job.id, language);
      await prisma.ai_job.update({ where: { id: job.id }, data: { currentBatchProcessed: { increment: 1 } } }).catch(() => {});
      return result;
    });

    let cursorAdvanceTo = job.cursor;
    let processedCount = 0;
    let failedCount = 0;

    for (const result of results) {
      if (result.failed) {
        failedCount++;
        break;
      }
      cursorAdvanceTo = result.question.id;
      processedCount++;
    }

    const finalJob = await prisma.ai_job.update({
      where: { id: job.id },
      data: { cursor: cursorAdvanceTo, totalProcessed: { increment: processedCount }, currentActivity: null },
    });

    return { job: finalJob, processed: questions.length, completed: processedCount, failed: failedCount };
  };

  let isRunning = false;
  const getIsRunning = () => isRunning;

  const startTranslationBatch = ({ batchSize } = {}) => {
    if (isRunning) {
      return { started: false, message: "A batch is already running" };
    }

    isRunning = true;
    runTranslationBatch({ batchSize })
      .catch(async (error) => {
        logger.error(`[createTranslationBatchJob:${jobType}] batch run crashed: ${error.message}`);
        await prisma.ai_job
          .updateMany({ where: { type: jobType }, data: { status: "failed", lastError: error.message, currentActivity: null } })
          .catch(() => {});
      })
      .finally(() => {
        isRunning = false;
      });

    return { started: true, message: "Batch started" };
  };

  return {
    runTranslationBatch,
    startTranslationBatch,
    getIsRunning,
    JOB_TYPE: jobType,
  };
};

module.exports = { createTranslationBatchJob };
