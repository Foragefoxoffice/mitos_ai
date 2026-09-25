// Unlike stripLatex.js (which discards math entirely — fine for keyword
// extraction, which only needs surrounding prose), translation needs the
// exact original math preserved verbatim: formulas/units/numbers must
// never be "helpfully" rephrased by a translation model. Same 4 delimiter
// forms stripLatex.js matches (question content can use any of them —
// see highlightTerms.js's identical MATH_SPAN_PATTERN on the mobile side).
const MATH_PATTERN = /(\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;

// Replaces every math region with a placeholder token, returning the
// de-mathed text plus the regions themselves in order — restoreLatex
// splices them back in later. Tokens are deliberately unlike natural
// language (no spaces, no punctuation a translator would try to
// "helpfully" render into the target script) so they survive translation
// untouched; the prompt also explicitly instructs the model never to
// translate or alter them.
//
// `startIndex` lets a caller protecting several fields of one question
// number tokens globally across all of them (question uses §MATH0§-§MATH2§,
// optionA continues at §MATH3§, ...). Per-field numbering restarting at 0
// let the model copy e.g. an option's §MATH0§ into a field that had no
// math at all, which then leaked into the saved row as literal text
// (found live 2026-09-25: 63 Hindi rows showed a raw "§MATH0§" to students).
const protectLatex = (text, startIndex = 0) => {
  if (!text) return { protectedText: text ?? null, mathRegions: [] };

  const mathRegions = [];
  const protectedText = text.replace(MATH_PATTERN, (match) => {
    const token = `§MATH${startIndex + mathRegions.length}§`;
    mathRegions.push(match);
    return token;
  });

  return { protectedText, mathRegions };
};

// Splices the original math regions back into their placeholder positions
// in translated text. If a translated field is missing a placeholder the
// original had (the model dropped or mangled it), that placeholder's
// original math is simply not restored — logged by the caller as a
// mismatch rather than silently producing wrong output, since callers
// need to know when this happened to decide whether to trust the row.
const restoreLatex = (translatedText, mathRegions, startIndex = 0) => {
  if (!translatedText || mathRegions.length === 0) {
    return { text: translatedText, restoredCount: 0, expectedCount: mathRegions.length, duplicatedCount: 0 };
  }

  let result = translatedText;
  let restoredCount = 0;
  let duplicatedCount = 0;
  mathRegions.forEach((region, i) => {
    const token = `§MATH${startIndex + i}§`;
    const parts = result.split(token);
    if (parts.length > 1) {
      restoredCount++;
      if (parts.length > 2) duplicatedCount++;
      result = parts.join(region);
    }
  });

  return { text: result, restoredCount, expectedCount: mathRegions.length, duplicatedCount };
};

// Anything still shaped like a placeholder after restoreLatex ran is a
// token the model invented or mangled (e.g. "§MATH7§" for a field that
// only had §MATH0§-§MATH2§, or "§ MATH0 §" with spaces) — it would render
// as literal junk text, so callers must treat its presence as a failure.
const LEFTOVER_TOKEN_PATTERN = /§\s*MATH\s*\d+\s*§|§MATH|MATH\d+§/;
const hasLeftoverToken = (text) => !!text && LEFTOVER_TOKEN_PATTERN.test(text);

module.exports = { protectLatex, restoreLatex, hasLeftoverToken, MATH_PATTERN };
