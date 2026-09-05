// One-time spot-check comparing OLD (promptVersion 1, generic) vs NEW
// (reference-aware, see hindiReferenceMatcher.js) Hindi translations on a
// sample of already-translated practice questions, WITHOUT overwriting any
// existing ai_question_translation rows — read-only against both DBs, only
// writes its own output file. Run before deciding whether to re-translate
// all 2012 rows for real (see project_regional_language_translation.md).
require("dotenv").config();
const fs = require("fs");
const prisma = require("../src/utils/prismaClient");
const { translateQuestion } = require("../src/services/questionTranslator");

const SAMPLE_SIZE = Number(process.env.SPOT_CHECK_SAMPLE_SIZE) || 25;
const OUT_FILE = process.env.SPOT_CHECK_OUT_FILE || "/tmp/hindi_prompt_spot_check.md";

const mysql = require("mysql2/promise");

(async () => {
  const language = await prisma.ai_language.findUnique({ where: { code: "hi" } });
  if (!language) throw new Error("Hindi language row not found");

  // Evenly spaced sample across the full range of existing translations,
  // not just the first N — avoids sampling only early, possibly
  // unrepresentative rows.
  const total = await prisma.ai_question_translation.count({
    where: { languageId: language.id, source: "practice", status: "completed" },
  });
  console.log(`[spot-check] ${total} completed practice translations to sample from`);

  const step = Math.max(1, Math.floor(total / SAMPLE_SIZE));
  const sampleRows = [];
  for (let offset = 0; offset < total && sampleRows.length < SAMPLE_SIZE; offset += step) {
    const [row] = await prisma.ai_question_translation.findMany({
      where: { languageId: language.id, source: "practice", status: "completed" },
      orderBy: { questionId: "asc" },
      skip: offset,
      take: 1,
    });
    if (row) sampleRows.push(row);
  }
  console.log(`[spot-check] sampled ${sampleRows.length} rows`);

  const pool = mysql.createPool({ uri: process.env.CORE_DB_READONLY_URL, connectionLimit: 3 });
  const questionIds = sampleRows.map((r) => r.questionId);
  const [sourceRows] = await pool.query(
    `SELECT id, question, optionA, optionB, optionC, optionD, hint FROM question WHERE id IN (${questionIds.map(() => "?").join(",")})`,
    questionIds
  );
  const sourceById = new Map(sourceRows.map((r) => [r.id, r]));

  let md = `# Hindi Translation Prompt Upgrade — Spot Check\n\n`;
  md += `Comparing OLD translations (promptVersion ${sampleRows[0]?.promptVersion ?? 1}, generic AI phrasing) vs NEW translations (reference-aware, grounded in 369 real NEET Hindi past-paper pages) on ${sampleRows.length} already-translated practice questions, sampled evenly across the full range.\n\n`;
  md += `**This script did not write anything to the database** — old rows are untouched, new translations were generated in-memory only for this comparison.\n\n`;

  let done = 0;
  for (const row of sampleRows) {
    const source = sourceById.get(row.questionId);
    if (!source) {
      console.warn(`[spot-check] source question ${row.questionId} not found, skipping`);
      continue;
    }

    const fresh = await translateQuestion({
      language,
      fields: {
        question: source.question,
        optionA: source.optionA,
        optionB: source.optionB,
        optionC: source.optionC,
        optionD: source.optionD,
        hint: source.hint,
      },
    });

    md += `## Question ${row.questionId}\n\n`;
    md += `**English:** ${source.question}\n\n`;
    md += `**OLD:** ${row.question}\n\n`;
    md += `**NEW:** ${fresh.question}\n\n`;
    md += `---\n\n`;

    done++;
    console.log(`[spot-check] ${done}/${sampleRows.length} done (question ${row.questionId})`);
    fs.writeFileSync(OUT_FILE, md);

    await new Promise((r) => setTimeout(r, 2000));
  }

  await pool.end();
  console.log(`[spot-check] DONE — written to ${OUT_FILE}`);
})()
  .catch((e) => {
    console.error("[spot-check] FAILED", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
