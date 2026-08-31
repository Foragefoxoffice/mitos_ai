// Third/final step of the one-time Hindi reference extraction — see
// extractHindiReference.js for the full context. Filters the raw
// consolidated data down to what's actually safe to use as translation
// rules: fixedTemplates only keeps boilerplate seen >=3 times where one
// wording dominates (>=60% share) — genuinely established convention,
// not noise or something too inconsistent in real papers to enforce.
// terminology keeps everything seen >=2 times, with a secondary
// "alternates" list for terms where a second wording appears often
// enough (>=25%) to be worth surfacing rather than silently dropped.
const fs = require("fs");
const OUT_DIR = process.env.HINDI_EXTRACTION_OUT_DIR || "/tmp/hindi_extraction";

const templates = JSON.parse(fs.readFileSync(`${OUT_DIR}/raw_templates.json`, "utf8"));
const terms = JSON.parse(fs.readFileSync(`${OUT_DIR}/raw_terms.json`, "utf8"));

const normalize = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

const consolidate = (items) => {
  const map = new Map();
  for (const item of items) {
    if (!item.english || !item.hindi) continue;
    const key = normalize(item.english);
    if (!map.has(key)) map.set(key, { english: item.english.trim(), variants: new Map() });
    const entry = map.get(key);
    const hindiTrim = item.hindi.trim();
    entry.variants.set(hindiTrim, (entry.variants.get(hindiTrim) || 0) + 1);
  }
  return [...map.values()].map((e) => {
    const variantList = [...e.variants.entries()].sort((a, b) => b[1] - a[1]);
    const totalCount = variantList.reduce((s, [, c]) => s + c, 0);
    return { english: e.english, variantList, totalCount };
  }).sort((a, b) => b.totalCount - a.totalCount);
};

const consolidatedTemplates = consolidate(templates);
const consolidatedTerms = consolidate(terms);

// Fixed templates: only keep ones seen >=3 times AND where the top variant
// dominates (>=60% share) — genuinely established conventions, not noise
// or genuinely-ambiguous ones we shouldn't hard-enforce.
const fixedTemplates = consolidatedTemplates
  .filter((e) => e.totalCount >= 3 && (e.variantList[0][1] / e.totalCount) >= 0.6)
  .map((e) => ({ english: e.english, hindi: e.variantList[0][0], confidence: e.variantList[0][1] / e.totalCount, seenCount: e.totalCount }));

// Terminology lookup: keep all terms seen >=2 times (filters out one-off
// extraction noise) with their dominant variant AND any secondary variant
// that appears meaningfully often (>=25% share) — for genuinely
// context-dependent words like "product" (math vs chemistry sense).
const terminology = consolidatedTerms
  .filter((e) => e.totalCount >= 2)
  .map((e) => {
    const primary = e.variantList[0][0];
    const alternates = e.variantList.slice(1).filter(([, c]) => c / e.totalCount >= 0.25).map(([h]) => h);
    return { english: e.english, hindi: primary, alternates: alternates.length ? alternates : undefined, seenCount: e.totalCount };
  });

fs.writeFileSync(
  "/Users/arundurai/mitos/ai-service/src/data/hindiExamTemplates.json",
  JSON.stringify(fixedTemplates, null, 2)
);
fs.writeFileSync(
  "/Users/arundurai/mitos/ai-service/src/data/hindiTerminology.json",
  JSON.stringify(terminology, null, 2)
);

console.log("fixed templates:", fixedTemplates.length, "of", consolidatedTemplates.length, "unique");
console.log("terminology entries:", terminology.length, "of", consolidatedTerms.length, "unique");
console.log("terms with alternates:", terminology.filter(t => t.alternates).length);
