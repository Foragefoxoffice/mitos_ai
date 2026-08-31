const fixedTemplates = require("../data/hindiExamTemplates.json");
const terminology = require("../data/hindiTerminology.json");

// Extracted from all 369 pages of the 8 real NEET Hindi past-year papers
// (2018-2026, bilingual English/Hindi) — see project memory for the full
// extraction process. fixedTemplates are near-universal instructional
// boilerplate (>=60% of observed occurrences agree on one wording) —
// small enough (45 entries) to include in full on every call.
// terminology is a 955-entry lookup table — too large to include in
// full, so callers match it against the specific question's text and
// only the terms that actually appear get included in that prompt.

// Case-insensitive whole-word/phrase match — a term like "product" must
// match as its own word, not as a substring inside "byproduct" or
// "production", which would misfire.
const buildWordBoundaryRegex = (phrase) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
};

// Pre-built once at module load, not per-call — matching against 955
// terms for every translation would be wasteful to rebuild each time.
const termMatchers = terminology.map((t) => ({ ...t, regex: buildWordBoundaryRegex(t.english) }));

// Returns only the terms that actually appear in this specific
// question's combined text — keeps each prompt lean instead of
// embedding all 955 terms in every single call.
const matchTerminology = (combinedText) => {
  if (!combinedText) return [];
  return termMatchers.filter((t) => t.regex.test(combinedText)).map(({ english, hindi, alternates }) => ({ english, hindi, alternates }));
};

module.exports = { fixedTemplates, matchTerminology };
