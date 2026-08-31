// One-time extraction script (run 2026-08-31) that produced
// src/data/hindiExamTemplates.json and src/data/hindiTerminology.json —
// kept for reproducibility (re-run if more past-year papers are added
// later), not part of any ongoing pipeline. Source PDFs live in
// /Users/arundurai/mitos/Hindi/Hindi Past Year NEET QPs/ (8 real NEET
// papers, 2018-2026, printed bilingually English/Hindi). These use
// legacy non-Unicode fonts (SHREE-DEV-0708E) — plain text extraction
// produces garbage, which is why this reads rendered page IMAGES via
// Gemini vision instead (see buildHindiDataFiles.js for the consolidation
// step, and hindiReferenceMatcher.js for how the output is actually used).
//
// PAGES_DIR must be repopulated before re-running — rendered via:
//   pdftoppm -png -r 150 "<pdf>" <PAGES_DIR>/<name>
// for each PDF in that folder (see project memory for the exact commands).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const PAGES_DIR = process.env.HINDI_PAGES_DIR || "/tmp/hindi_pages";
const OUT_DIR = process.env.HINDI_EXTRACTION_OUT_DIR || "/tmp/hindi_extraction";
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPT = `This page is from a real NEET (Indian medical entrance exam) question paper, printed bilingually — English on the left, the official Hindi translation on the right, question by question. Some pages may be instructions/cover pages with little or no question content — if so, return empty arrays.

Extract as JSON:
1. "fixedTemplates": INSTRUCTIONAL boilerplate phrases that aren't specific to one question's content — assertion-reason framing, "choose the correct answer from the options given below", matching-list instructions, the 4 standard A/R answer options, "which of the following", etc. Give the English phrase and its EXACT Hindi equivalent as printed on this page.
2. "terminologyPairs": scientific/technical terms in the English text and their EXACT Hindi equivalent as used on this page.

Return ONLY valid JSON: {"fixedTemplates":[{"english":"...","hindi":"..."}],"terminologyPairs":[{"english":"...","hindi":"..."}]}. No markdown fencing, no commentary.`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const processPage = async (imagePath) => {
  const imageData = fs.readFileSync(imagePath).toString("base64");
  const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: PROMPT }, { inlineData: { mimeType: "image/png", data: imageData } }] }],
    generationConfig: { maxOutputTokens: 3000, thinkingConfig: { thinkingBudget: 1 } },
  });
  const text = result.response.text().trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(text);
};

const runWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await worker(items[i]);
      } catch (e) {
        results[i] = { error: e.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
};

(async () => {
  const files = fs.readdirSync(PAGES_DIR).filter((f) => f.endsWith(".png")).sort();
  console.log(`[start] ${files.length} pages to process`);

  const allTemplates = [];
  const allTerms = [];
  let errors = 0;
  let done = 0;

  const batchSize = 20;
  for (let b = 0; b < files.length; b += batchSize) {
    const batch = files.slice(b, b + batchSize);
    const results = await runWithConcurrency(batch, 4, (f) => processPage(path.join(PAGES_DIR, f)));

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r?.error) {
        errors++;
        console.warn(`[warn] ${batch[i]}: ${r.error}`);
        continue;
      }
      if (r?.fixedTemplates) allTemplates.push(...r.fixedTemplates.map((t) => ({ ...t, source: batch[i] })));
      if (r?.terminologyPairs) allTerms.push(...r.terminologyPairs.map((t) => ({ ...t, source: batch[i] })));
    }
    done += batch.length;
    console.log(`[progress] ${done}/${files.length} pages | templates so far: ${allTemplates.length} | terms so far: ${allTerms.length} | errors: ${errors}`);

    fs.writeFileSync(path.join(OUT_DIR, "raw_templates.json"), JSON.stringify(allTemplates, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, "raw_terms.json"), JSON.stringify(allTerms, null, 2));
  }

  console.log(`[DONE] total templates: ${allTemplates.length}, total terms: ${allTerms.length}, errors: ${errors}`);
})().catch((e) => { console.error("[SCRIPT FAILED]", e); process.exit(1); });
