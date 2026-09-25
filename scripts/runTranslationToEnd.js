// Drives one translation source (practice | test_series) batch after batch
// until the whole bank is translated. HTTP calls to the already-running
// ai-service only — no DB connection of its own — the structural fix
// adopted after the 2026-08-30 lock-timeout incident (see
// rerunHindiTranslations.js). Survives ai-service restarts/network blips:
// every failure just waits and retries.
//
// Usage: node scripts/runTranslationToEnd.js practice
//        node scripts/runTranslationToEnd.js test_series
require("dotenv").config();

const BASE_URL = process.env.AI_SERVICE_URL || "http://localhost:4001";
const KEY = process.env.INTERNAL_SERVICE_KEY;
const SOURCE = process.argv[2] === "test_series" ? "test_series" : "practice";
const BATCH_SIZE = Number(process.env.TRANSLATION_DRIVER_BATCH_SIZE) || 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`${new Date().toISOString()} [${SOURCE}] ${msg}`);

const call = async (method, path, body) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-internal-key": KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
};

const getState = async () => (await call("GET", "/internal/ai/translation/progress")).body[SOURCE];

(async () => {
  if (!KEY) throw new Error("INTERNAL_SERVICE_KEY not set");

  while (true) {
    try {
      const before = await getState();
      if (before.isProcessing) {
        await sleep(5000);
        continue;
      }

      const { status, body } = await call("POST", "/internal/ai/translation/generate-batch", { source: SOURCE, batchSize: BATCH_SIZE });
      if (status === 409) {
        await sleep(5000);
        continue;
      }
      if (status !== 202) {
        log(`unexpected batch-start response ${status}: ${JSON.stringify(body)}`);
        await sleep(15000);
        continue;
      }

      await sleep(2000);
      let state = await getState();
      while (state.isProcessing) {
        await sleep(5000);
        state = await getState();
      }

      const { job } = state;
      log(`cursor ${before.job.cursor} -> ${job.cursor} | totalProcessed=${job.totalProcessed} totalFailed=${job.totalFailed} status=${job.status}`);

      // "idle" is only set when a batch found no questions past the cursor.
      if (job.status === "idle") {
        log("no questions left — done");
        break;
      }
      // Cursor stuck = transient failure on the first question of the
      // batch (network/provider) — back off before retrying it.
      if (job.cursor === before.job.cursor) {
        log(`cursor did not move (lastError: ${job.lastError}) — backing off 60s`);
        await sleep(60000);
      }
    } catch (error) {
      log(`driver error: ${error.message} — retrying in 30s`);
      await sleep(30000);
    }
  }
})();
