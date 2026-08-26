const prisma = require("../utils/prismaClient");
const logger = require("../utils/logger");
const { extractKeywordsWithAI } = require("../services/keywordExtractor");
const { generateDictionaryEntry } = require("../services/dictionaryGenerator");
const { sleep } = require("../utils/sleep");
const { subjectForId } = require("../utils/subjectMap");

// Gemini's free tier is 5 requests/minute — a batch with no throttling burns
// through that in seconds. Default spacing (15s = 4/min) leaves margin
// under the limit for the rolling window (verified live: 13s spacing still
// hit a 429 when stacked with other manual calls in the same minute); only
// applied before calls that actually hit a provider, never on the
// dedup-skip path. Raise/lower via env once real quota (or a paid tier) is
// known. With DICTIONARY_CONCURRENCY > 1, this delay applies independently
// within each concurrent lane (see processQuestion) rather than globally —
// several lanes pacing themselves this way is still a real, if soft, rate
// limiter without needing a shared cross-lane clock.
const AI_CALL_DELAY_MS = Number(process.env.AI_CALL_DELAY_MS) || 15000;

// How many questions to process at once (2026-08-21). Most of a call's
// wall-clock time is spent waiting on the AI provider's response, not local
// work — the old one-at-a-time loop left that time completely idle. Running
// several questions concurrently multiplies throughput roughly linearly
// instead. Kept modest by default so a first run stays comfortably under
// Gemini's paid-tier rate limits without needing to know the exact number;
// raise via env once headroom at the current value is confirmed live.
const DICTIONARY_CONCURRENCY = Number(process.env.DICTIONARY_CONCURRENCY) || 5;

// Runs `worker` over `items` with at most `limit` running at once. Each of
// `limit` lanes pulls the next unclaimed item from a shared index as soon as
// it finishes its current one (rather than waiting on fixed-size groups with
// a barrier between them), so a few slow items never stall the other lanes.
// Results come back in the SAME order as `items`, regardless of which
// finished first — callers that need ordered semantics (cursor advancement
// below) can rely on that without re-sorting.
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

// Builds a full dictionary-generation batch job — resumable cursor, batch
// runner, auto-run loop, the works — for one QUESTION SOURCE. `jobType` is
// the ai_job.type this instance owns; `fetchQuestionBatch` reads the next
// slice of questions from wherever that source's data actually lives;
// `mappingSource` tags every ai_dictionary_mapping row this instance creates
// so a questionId can be told apart between sources that have their own
// independent id sequences (e.g. the main `question` table vs.
// `testseriesquestionbank`) — see the schema comment on
// ai_dictionary_mapping.source for why that matters.
//
// The underlying ai_dictionary term table (and its (term, subject) unique
// scoping) is intentionally NOT parameterized — terms/definitions are
// shared across every source. A word means the same thing regardless of
// which question bank it was first seen in; only the question<->term
// MAPPING needs to know its source.
const createDictionaryBatchJob = ({ jobType, fetchQuestionBatch, mappingSource }) => {
  // Processes ONE question end-to-end: extract its terms, generate any that
  // are new, map them to the question. Deliberately doesn't touch job.cursor
  // or currentBatchProcessed directly — under concurrency, questions finish in
  // whatever order their AI calls happen to complete, so only the caller (see
  // runDictionaryBatch), after seeing every question's outcome, can safely
  // decide how far the cursor is allowed to move.
  //
  // totalCreated/totalSkipped/totalFailed ARE still updated live here (as
  // before) rather than batched up — Prisma's `{ increment: 1 }` compiles to
  // an atomic `UPDATE ... SET x = x + 1`, so concurrent lanes writing the same
  // counter is safe with no lost updates, unlike the cursor field.
  const processQuestion = async (question, jobId, knownTermsBySubject) => {
    // Scopes dedup/generation per subject — "cell" in a Biology question and
    // "cell" in a Physics/Chemistry question are different words that happen
    // to share spelling, so each subject gets its own ai_dictionary row (see
    // the (term, subject) unique constraint) rather than one global
    // definition winning for every subject that uses the word.
    const subject = subjectForId(question.subjectId);

    let terms;
    try {
      terms = await extractKeywordsWithAI(question.question, question.hint, knownTermsBySubject[subject] || []);
    } catch (error) {
      logger.warn(`[createDictionaryBatchJob:${jobType}] keyword extraction failed for question ${question.id}: ${error.message}`);
      return { question, extractionFailed: true, created: 0, skipped: 0, failed: 0 };
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const term of terms) {
      await sleep(AI_CALL_DELAY_MS);

      let dictEntry = await prisma.ai_dictionary.findUnique({ where: { term_subject: { term, subject } } });

      // A term with no entry needs generating. A term stuck in "failed"
      // ALSO needs (re)generating — a previous failure isn't a completed
      // result, and without this check a failed term would be skipped
      // forever, silently counted as "already have it". Only a completed
      // or manually-edited entry is actually reused.
      const needsGeneration = !dictEntry || (dictEntry.status === "failed" && !dictEntry.manuallyEdited);

      if (needsGeneration) {
        try {
          const generated = await generateDictionaryEntry(term, subject);
          dictEntry = await prisma.ai_dictionary.upsert({
            where: { term_subject: { term, subject } },
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
              subject,
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
            where: { id: jobId },
            data: { totalCreated: { increment: 1 }, lastRunAt: new Date() },
          });
        } catch (error) {
          logger.warn(`[createDictionaryBatchJob:${jobType}] generation failed for "${term}" (${subject}): ${error.message}`);
          await prisma.ai_dictionary
            .upsert({
              where: { term_subject: { term, subject } },
              update: { status: "failed", failureReason: error.message },
              create: { term, subject, status: "failed", failureReason: error.message },
            })
            .catch(() => {});
          failed++;
          await prisma.ai_job.update({
            where: { id: jobId },
            data: { totalFailed: { increment: 1 }, lastRunAt: new Date() },
          });
          continue;
        }
      } else {
        skipped++;
        await prisma.ai_job.update({ where: { id: jobId }, data: { totalSkipped: { increment: 1 } } });
      }

      // Two concurrent lanes can occasionally discover the same brand-new
      // (term, subject) pair at the same time and both attempt to generate
      // it — harmless: the unique constraint means the upsert above resolves
      // to one row either way, the worst case is one wasted duplicate AI
      // call, never a duplicate/corrupt dictionary entry.
      await prisma.ai_dictionary_mapping.upsert({
        where: {
          dictionaryId_questionId_source: { dictionaryId: dictEntry.id, questionId: question.id, source: mappingSource },
        },
        update: {},
        create: { dictionaryId: dictEntry.id, questionId: question.id, source: mappingSource },
      });
    }

    return { question, extractionFailed: false, created, skipped, failed };
  };

  // Runs ONE batch and stops — never the whole question bank in one call.
  // Resumable: picks up from job.cursor (the highest question id processed so
  // far), so calling this again later — including after new questions get
  // added to the bank — always continues instead of restarting or
  // reprocessing. Terms are deduped against ai_dictionary before any AI call,
  // so a term shared across many questions is only ever generated once.
  const runDictionaryBatch = async ({ batchSize } = {}) => {
    let job = await prisma.ai_job.findUnique({ where: { type: jobType } });

    if (!job) {
      job = await prisma.ai_job.create({
        data: { type: jobType, status: "running", batchSize: batchSize || 20, startedAt: new Date() },
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

    const lanes = Math.min(DICTIONARY_CONCURRENCY, questions.length);
    await prisma.ai_job.update({
      where: { id: job.id },
      data: {
        currentBatchTotal: questions.length,
        currentBatchProcessed: 0,
        currentActivity: `Processing ${questions.length} question${questions.length === 1 ? "" : "s"} (${lanes} at a time)…`,
      },
    });

    // Fetched once per batch (not per question) — feeds the consistency pass
    // in keywordExtractor.js: an already-established term for a subject
    // always gets included in any future question in that subject where it
    // literally appears, so the same word/meaning doesn't end up tappable in
    // one question and silently missing in another purely because the AI's
    // fresh per-question judgment varied (reported directly as an issue:
    // "velocity" showing up in one question's extraction but not another
    // near-identical one). Deliberately not filtered by mappingSource — the
    // term pool is shared across sources (see the comment on
    // createDictionaryBatchJob above), so a term already established from a
    // practice question should just as reliably show up when the same word
    // appears in a test-series question, and vice versa.
    const knownTermRows = await prisma.ai_dictionary.findMany({
      where: { status: "completed" },
      select: { term: true, subject: true },
    });
    const knownTermsBySubject = {};
    for (const row of knownTermRows) {
      (knownTermsBySubject[row.subject] ??= []).push(row.term);
    }

    // A single "currentActivity" string can't meaningfully describe several
    // questions' individual steps at once without flickering between lanes,
    // so per-question step text (extracting/generating "term") is intentionally
    // not surfaced during concurrent runs — currentBatchProcessed below is the
    // real-time signal admin polling relies on instead.
    const results = await runWithConcurrency(questions, lanes, async (question) => {
      const result = await processQuestion(question, job.id, knownTermsBySubject);
      await prisma.ai_job
        .update({ where: { id: job.id }, data: { currentBatchProcessed: { increment: 1 } } })
        .catch(() => {});
      return result;
    });

    // Concurrent questions finish in whatever order their AI calls settle,
    // but the resumable cursor must never skip past a question that failed
    // extraction — same guarantee the old sequential version got from
    // stopping its loop on the first failure. `results` is in the ORIGINAL
    // (ascending question-id) order (guaranteed by runWithConcurrency), so
    // walking it from the start and stopping at the first extraction failure
    // reproduces that guarantee exactly. Anything after that point is real,
    // valid work already saved (its dictionary entries + mappings exist) —
    // just not reflected in the cursor yet, so it gets harmlessly redone
    // (fast: dedup skips already-generated terms) whenever this resumes.
    let created = 0;
    let skipped = 0;
    let failed = 0;
    let cursorAdvanceTo = job.cursor;
    let processedCount = 0;

    for (const result of results) {
      if (result.extractionFailed) break;
      created += result.created;
      skipped += result.skipped;
      failed += result.failed;
      cursorAdvanceTo = result.question.id;
      processedCount++;
    }

    const finalJob = await prisma.ai_job.update({
      where: { id: job.id },
      data: {
        cursor: cursorAdvanceTo,
        totalProcessed: { increment: processedCount },
        currentActivity: null,
      },
    });

    return { job: finalJob, processed: questions.length, created, skipped, failed };
  };

  // In-memory guard against overlapping runs of THIS job instance —
  // ai-service is a single process, so a plain flag is enough to stop a
  // double-click (or a second admin) from starting a second batch of the
  // SAME source while one is already in flight. Each createDictionaryBatchJob
  // instance gets its own closure over this, so a practice batch running
  // never blocks a test-series batch starting, or vice versa.
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
        logger.error(`[createDictionaryBatchJob:${jobType}] batch run crashed: ${error.message}`);
        // Without this, a crash (e.g. bad DB credentials, network failure)
        // leaves the job silently stuck at "running" forever — admin polling
        // /progress would see no error and no further movement, with no way
        // to tell the batch actually failed short of reading server logs.
        await prisma.ai_job
          .updateMany({
            where: { type: jobType },
            data: { status: "failed", lastError: error.message, currentActivity: null },
          })
          .catch(() => {});
      })
      .finally(() => {
        isRunning = false;
      });

    return { started: true, message: "Batch started" };
  };

  // How long to wait, when auto-run has caught up to the source (no new
  // questions right now), before checking again — new questions get added
  // over time and auto-run should pick them up without needing Start clicked
  // again. Broken into small chunks (checkAutoRunEnabled below) rather
  // than one long sleep, so Stop takes effect quickly even during this idle
  // wait, not just between questions.
  const AUTO_IDLE_POLL_MS = 60000;
  const AUTO_IDLE_CHECK_EVERY_MS = 10000;

  let autoLoopRunning = false;

  const getIsAutoLoopRunning = () => autoLoopRunning;

  // Sleeps in small chunks, checking autoRunEnabled between each — returns
  // false the moment it sees the flag turned off, so an idle wait for new
  // questions doesn't delay Stop by the full AUTO_IDLE_POLL_MS.
  const sleepWhileAutoRunEnabled = async (totalMs) => {
    let waited = 0;
    while (waited < totalMs) {
      const chunk = Math.min(AUTO_IDLE_CHECK_EVERY_MS, totalMs - waited);
      await sleep(chunk);
      waited += chunk;
      const job = await prisma.ai_job.findUnique({ where: { type: jobType } });
      if (!job?.autoRunEnabled) return false;
    }
    return true;
  };

  // The actual continuous loop: processes one question at a time
  // (batchSize: 1, per the "one by one" requirement), checking
  // autoRunEnabled after every single question — never mid-question — so
  // Stop always takes effect at a clean boundary, with the cursor already
  // correctly past whatever was last completed. When caught up to the
  // source, waits and rechecks instead of exiting, so newly added questions
  // get picked up automatically without needing Start clicked again.
  const runAutoLoop = async () => {
    if (autoLoopRunning) return;
    autoLoopRunning = true;

    try {
      for (;;) {
        const job = await prisma.ai_job.findUnique({ where: { type: jobType } });
        if (!job?.autoRunEnabled) break;

        if (isRunning) {
          // A manual "Run Batch" is currently in flight — wait rather than
          // overlap two runs touching the same job row.
          await sleep(2000);
          continue;
        }

        isRunning = true;
        let result;
        try {
          result = await runDictionaryBatch({ batchSize: 1 });
        } catch (error) {
          logger.error(`[createDictionaryBatchJob:${jobType}] auto-run batch crashed: ${error.message}`);
          await prisma.ai_job
            .updateMany({
              where: { type: jobType },
              data: { status: "failed", lastError: error.message, currentActivity: null },
            })
            .catch(() => {});
        } finally {
          isRunning = false;
        }

        const stillEnabled = await prisma.ai_job.findUnique({ where: { type: jobType } });
        if (!stillEnabled?.autoRunEnabled) break;

        if (result?.processed === 0) {
          const keepGoing = await sleepWhileAutoRunEnabled(AUTO_IDLE_POLL_MS);
          if (!keepGoing) break;
        }
      }
    } finally {
      autoLoopRunning = false;
    }
  };

  const startAutoRun = async () => {
    const job = await prisma.ai_job.upsert({
      where: { type: jobType },
      update: { autoRunEnabled: true },
      create: { type: jobType, autoRunEnabled: true, status: "pending" },
    });

    runAutoLoop().catch((error) => {
      logger.error(`[createDictionaryBatchJob:${jobType}] unexpected crash outside the loop body: ${error.message}`);
    });

    return job;
  };

  // Only flips the flag — the loop itself notices on its own next check
  // (after the current question finishes) and exits cleanly. Doesn't force
  // anything to stop mid-question.
  const stopAutoRun = async () => {
    const job = await prisma.ai_job.update({ where: { type: jobType }, data: { autoRunEnabled: false } });
    return job;
  };

  // Called once at server boot — if autoRunEnabled was left on from before
  // a restart (crash, redeploy, manual restart during dev), resumes the loop
  // automatically instead of silently going quiet until someone notices and
  // clicks Start again. "Keep running until I stop it" should survive the
  // process bouncing, not just the browser tab staying open.
  const resumeAutoRunIfEnabled = async () => {
    const job = await prisma.ai_job.findUnique({ where: { type: jobType } });
    if (job?.autoRunEnabled) {
      logger.info(`[createDictionaryBatchJob:${jobType}] resuming auto-run on boot (was left enabled before restart)`);
      runAutoLoop().catch((error) => {
        logger.error(`[createDictionaryBatchJob:${jobType}] unexpected crash outside the loop body: ${error.message}`);
      });
    }
  };

  return {
    runDictionaryBatch,
    startDictionaryBatch,
    getIsRunning,
    startAutoRun,
    stopAutoRun,
    getIsAutoLoopRunning,
    resumeAutoRunIfEnabled,
    JOB_TYPE: jobType,
  };
};

module.exports = { createDictionaryBatchJob };
