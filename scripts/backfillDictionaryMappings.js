// One-time backfill: the dictionary bulk run (2026-08-05 to 2026-08-25)
// generated 43,209 terms progressively over the whole run. The live
// consistency-pass in keywordExtractor.js only checks a question against
// terms that were ALREADY completed at the moment that question's batch
// ran — so a question processed early in the run has no way to link to a
// term that only became established later. This script does a one-time,
// AI-free retroactive pass: now that the full term list is final, scan
// every already-processed question's text against its subject's COMPLETE
// term list and insert any missing mappings.
//
// Cheap-filter-then-verify: a plain substring check (`includes`) first,
// only falling through to the real word-boundary regex (same pattern used
// live) if the substring is present. Avoids running ~680M regex tests
// (41,527 terms x 48,640 questions) by skipping the vast majority where
// the term isn't even a substring.
require("dotenv").config();
const mysql = require("mysql2/promise");
const prisma = require("../src/utils/prismaClient");
const { stripHtml } = require("../src/utils/stripHtml");
const { stripLatex } = require("../src/utils/stripLatex");
const { stripCitations } = require("../src/utils/stripCitations");
const { subjectForId } = require("../src/utils/subjectMap");

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const QUESTION_BATCH_SIZE = 2000;
const INSERT_CHUNK_SIZE = 1000;

const cleanText = (text) => stripCitations(stripLatex(stripHtml(text || ""))).toLowerCase();

const main = async () => {
  console.log("[backfill] loading completed terms...");
  const terms = await prisma.ai_dictionary.findMany({
    where: { status: "completed" },
    select: { id: true, term: true, subject: true },
  });

  const termsBySubject = {};
  for (const t of terms) {
    const termLower = t.term.toLowerCase();
    (termsBySubject[t.subject] ||= []).push({
      id: t.id,
      term: termLower,
      regex: new RegExp(`\\b${escapeRegExp(termLower)}\\b`, "i"),
    });
  }
  for (const subj of Object.keys(termsBySubject)) {
    console.log(`[backfill] ${subj}: ${termsBySubject[subj].length} completed terms`);
  }

  console.log("[backfill] loading existing mappings...");
  const existingMappings = await prisma.ai_dictionary_mapping.findMany({
    select: { dictionaryId: true, questionId: true },
  });
  const existingByQuestion = new Map();
  for (const m of existingMappings) {
    if (!existingByQuestion.has(m.questionId)) existingByQuestion.set(m.questionId, new Set());
    existingByQuestion.get(m.questionId).add(m.dictionaryId);
  }
  console.log(`[backfill] ${existingMappings.length} existing mappings loaded, covering ${existingByQuestion.size} questions`);

  const pool = mysql.createPool({ uri: process.env.CORE_DB_READONLY_URL, connectionLimit: 3 });

  let cursor = 0;
  let questionsScanned = 0;
  let newMappings = [];
  let totalInserted = 0;
  const startedAt = Date.now();

  const flushInserts = async (force = false) => {
    if (newMappings.length === 0) return;
    if (!force && newMappings.length < INSERT_CHUNK_SIZE) return;
    const batch = newMappings;
    newMappings = [];
    const result = await prisma.ai_dictionary_mapping.createMany({ data: batch, skipDuplicates: true });
    totalInserted += result.count;
  };

  while (true) {
    const [rows] = await pool.query(
      "SELECT id, question, hint, subjectId FROM question WHERE id > ? ORDER BY id ASC LIMIT ?",
      [cursor, QUESTION_BATCH_SIZE]
    );
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    for (const row of rows) {
      const subject = subjectForId(row.subjectId);
      const subjectTerms = termsBySubject[subject];
      if (!subjectTerms) continue;

      const text = `${cleanText(row.question)} ${cleanText(row.hint)}`;
      const already = existingByQuestion.get(row.id) || new Set();

      for (const t of subjectTerms) {
        if (already.has(t.id)) continue;
        if (!text.includes(t.term)) continue;
        if (!t.regex.test(text)) continue;
        newMappings.push({ dictionaryId: t.id, questionId: row.id });
        already.add(t.id);
      }
      questionsScanned++;
    }

    await flushInserts();

    if (questionsScanned % 10000 < QUESTION_BATCH_SIZE) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(`[backfill] scanned=${questionsScanned} inserted=${totalInserted} elapsed=${elapsed}s cursor=${cursor}`);
    }
  }

  await flushInserts(true);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`[backfill] DONE: scanned=${questionsScanned} questions, inserted=${totalInserted} new mappings, elapsed=${elapsed}s`);
  process.exit(0);
};

main().catch((err) => {
  console.error("[backfill] FAILED:", err);
  process.exit(1);
});
