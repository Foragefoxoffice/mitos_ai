// One-time driver to re-translate all practice-source Hindi translations
// using the new reference-aware prompt (2026-08-31 client-quality fix).
// Deliberately makes ONLY HTTP calls to the already-running ai-service —
// no direct Prisma/DB connection of its own — the exact structural fix
// adopted after the original 2000-question run hit a MySQL lock timeout
// caused by a standalone script's zombie DB connections. See
// project_regional_language_translation.md for that incident.
//
// Prerequisite: ai_job.cursor for type "questionTranslation:hi" must
// already be reset to 0 (done once, directly, before starting this) so
// fetchQuestionBatchForTranslation re-walks every existing question
// instead of only new ones — the upsert in createTranslationBatchJob.js
// overwrites each row in place.
require("dotenv").config();

const BASE_URL = process.env.AI_SERVICE_URL || "http://localhost:4001";
const KEY = process.env.INTERNAL_SERVICE_KEY;
const BATCH_SIZE = Number(process.env.RERUN_BATCH_SIZE) || 20;
const TARGET_TOTAL = Number(process.env.RERUN_TARGET_TOTAL) || 2012;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = async (path, body) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-key": KEY },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json() };
};

const getProgress = async () => {
  const res = await fetch(`${BASE_URL}/internal/ai/translation/progress`, {
    headers: { "x-internal-key": KEY },
  });
  return res.json();
};

(async () => {
  if (!KEY) throw new Error("INTERNAL_SERVICE_KEY not set");

  let startingTotalProcessed = null;
  let consecutiveNoOp = 0;

  while (true) {
    const before = await getProgress();
    const job = before.practice.job;

    if (startingTotalProcessed === null) startingTotalProcessed = job.totalProcessed;
    const reprocessedSoFar = job.totalProcessed - startingTotalProcessed;

    console.log(
      `[rerun] cursor=${job.cursor} status=${job.status} totalProcessed=${job.totalProcessed} reprocessedSoFar=${reprocessedSoFar}/${TARGET_TOTAL} totalFailed=${job.totalFailed}`
    );

    if (reprocessedSoFar >= TARGET_TOTAL) {
      console.log("[rerun] target reached — done");
      break;
    }

    if (before.practice.isProcessing) {
      await sleep(5000);
      continue;
    }

    const { status, body } = await post("/internal/ai/translation/generate-batch", { source: "practice", batchSize: BATCH_SIZE });

    if (status === 409) {
      await sleep(5000);
      continue;
    }
    if (status !== 202) {
      console.error("[rerun] unexpected batch-start response:", status, JSON.stringify(body));
      await sleep(10000);
      continue;
    }

    // Poll until this batch finishes (isProcessing flips back to false).
    let waited = 0;
    while (true) {
      await sleep(3000);
      waited += 3000;
      const p = await getProgress();
      if (!p.practice.isProcessing) break;
      if (waited > 5 * 60 * 1000) {
        console.warn("[rerun] batch still running after 5 min, continuing to poll...");
      }
    }

    const after = await getProgress();
    if (after.practice.job.totalFailed > job.totalFailed) {
      console.warn(`[rerun] a question failed this batch (totalFailed now ${after.practice.job.totalFailed}) — cursor did not advance, will retry`);
    }

    if (after.practice.job.cursor === job.cursor && after.practice.job.totalProcessed === job.totalProcessed) {
      consecutiveNoOp++;
      if (consecutiveNoOp >= 5) {
        console.error("[rerun] no progress for 5 consecutive batches — stopping");
        break;
      }
    } else {
      consecutiveNoOp = 0;
    }
  }

  console.log("[rerun] FINISHED");
})().catch((e) => {
  console.error("[rerun] FAILED", e);
  process.exit(1);
});
