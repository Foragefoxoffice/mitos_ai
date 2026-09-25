// Re-translates a specific list of questions in place (e.g. the rows a
// LaTeX audit flagged as broken) through the same validated
// translateQuestion() path the batch job uses. Never touches ai_job, so it
// can't race the running service's job rows — and always disconnects
// Prisma before exiting (see the 2026-08-30 zombie-connection incident in
// project notes).
//
// Usage: node scripts/retranslateQuestions.js practice:814 test_series:2 ...
//    or: node scripts/retranslateQuestions.js --file ids.json   (["practice:814", ...])
require("dotenv").config();
const fs = require("fs");
const mysql = require("mysql2/promise");
const prisma = require("../src/utils/prismaClient");
const { translateQuestion } = require("../src/services/questionTranslator");
const { PROMPT_VERSION } = require("../src/jobs/createTranslationBatchJob");

const TABLE = { practice: "question", test_series: "testseriesquestionbank" };
const LANGUAGE_CODE = process.env.RETRANSLATE_LANG || "hi";
const CONCURRENCY = Number(process.env.RETRANSLATE_CONCURRENCY) || 3;

(async () => {
  const args = process.argv.slice(2);
  const keys = args[0] === "--file" ? JSON.parse(fs.readFileSync(args[1], "utf8")) : args;
  const core = await mysql.createConnection(process.env.CORE_DB_READONLY_URL);
  const language = await prisma.ai_language.findUnique({ where: { code: LANGUAGE_CODE } });
  const summary = { fixed: 0, failed: 0 };

  const queue = [...keys];
  const lane = async () => {
    while (queue.length) {
      const key = queue.shift();
      const [source, idText] = key.split(":");
      const id = Number(idText);
      const [[q]] = await core.query(
        `SELECT id, question, optionA, optionB, optionC, optionD, hint FROM ${TABLE[source]} WHERE id = ?`,
        [id]
      );
      const where = { questionId_languageId_source: { questionId: id, languageId: language.id, source } };
      try {
        const r = await translateQuestion({ language, fields: q });
        const data = {
          question: r.question, optionA: r.optionA, optionB: r.optionB, optionC: r.optionC, optionD: r.optionD, hint: r.hint,
          status: "completed", failureReason: null, generatedByProvider: r.provider, generatedByModel: r.model,
          sourceHash: r.sourceHash, promptVersion: PROMPT_VERSION,
        };
        await prisma.ai_question_translation.upsert({ where, update: data, create: { questionId: id, languageId: language.id, source, ...data } });
        summary.fixed++;
        console.log(`ok   ${key} (attempts: ${r.attempts})`);
      } catch (error) {
        // Validation failures are saved as "failed" so students get the
        // English fallback instead of the old broken row.
        if (error.nonBlocking) {
          await prisma.ai_question_translation.update({ where, data: { status: "failed", failureReason: error.message } });
        }
        summary.failed++;
        console.log(`FAIL ${key}: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, lane));

  console.log(summary);
  await core.end();
  await prisma.$disconnect();
})().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
