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
const protectLatex = (text) => {
  if (!text) return { protectedText: text ?? null, mathRegions: [] };

  const mathRegions = [];
  const protectedText = text.replace(MATH_PATTERN, (match) => {
    const token = `§MATH${mathRegions.length}§`;
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
const restoreLatex = (translatedText, mathRegions) => {
  if (!translatedText || mathRegions.length === 0) {
    return { text: translatedText, restoredCount: 0, expectedCount: mathRegions.length };
  }

  let result = translatedText;
  let restoredCount = 0;
  mathRegions.forEach((region, i) => {
    const token = `§MATH${i}§`;
    if (result.includes(token)) {
      result = result.split(token).join(region);
      restoredCount++;
    }
  });

  return { text: result, restoredCount, expectedCount: mathRegions.length };
};

module.exports = { protectLatex, restoreLatex };
