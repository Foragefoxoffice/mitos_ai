const prisma = require("../utils/prismaClient");
const logger = require("../utils/logger");
const { extractKeywords } = require("../utils/extractKeywords");
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

// Runs ONE batch and stops — never the whole question bank in one call.
// Resumable: picks up from job.cursor (the highest question id processed so
// far), so calling this again later — including after new questions get
// added to the bank — always continues instead of restarting or
// reprocessing. Terms are deduped against ai_dictionary before any AI call,
// so a term shared across many questions is only ever generated once.
const runDictionaryBatch = async ({ batchSize } = {}) => {
  let job = await prisma.ai_job.findUnique({ where: { type: JOB_TYPE } });

  if (!job) {
    job = await prisma.ai_job.create({
      data: { type: JOB_TYPE, status: "running", batchSize: batchSize || 20, startedAt: new Date() },
    });
  }

  const effectiveBatchSize = batchSize || job.batchSize;
  const questions = await fetchQuestionBatch({ afterId: job.cursor, limit: effectiveBatchSize });

  if (questions.length === 0) {
    const idleJob = await prisma.ai_job.update({
      where: { id: job.id },
      data: { status: "idle", lastRunAt: new Date() },
    });
    return { job: idleJob, processed: 0, created: 0, skipped: 0, failed: 0, message: "No new questions to process" };
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;
  let maxId = job.cursor;
  let hasCalledProvider = false;

  for (const question of questions) {
    maxId = Math.max(maxId, question.id);

    const text = [question.question, question.optionA, question.optionB, question.optionC, question.optionD]
      .filter(Boolean)
      .join(" ");
    const terms = extractKeywords(text);

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
          await sleep(AI_CALL_DELAY_MS);
        }
        hasCalledProvider = true;

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
          continue;
        }
      } else {
        skipped++;
      }

      await prisma.ai_dictionary_mapping.upsert({
        where: { dictionaryId_questionId: { dictionaryId: dictEntry.id, questionId: question.id } },
        update: {},
        create: { dictionaryId: dictEntry.id, questionId: question.id },
      });
    }
  }

  const updatedJob = await prisma.ai_job.update({
    where: { id: job.id },
    data: {
      cursor: maxId,
      status: "running",
      totalProcessed: { increment: questions.length },
      totalCreated: { increment: created },
      totalSkipped: { increment: skipped },
      totalFailed: { increment: failed },
      lastRunAt: new Date(),
    },
  });

  return { job: updatedJob, processed: questions.length, created, skipped, failed };
};

module.exports = { runDictionaryBatch, JOB_TYPE };
