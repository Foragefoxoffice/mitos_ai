// Removes source citations before text is sent for keyword extraction —
// belt-and-braces on top of the prompt instruction, same idea as
// stripLatex.js. Without this, a citation gets handed straight to the
// model, which can latch onto it as if it were a vocabulary term.
//
// Three shapes seen in the real question bank:
//  - bracketed textbook reference with a "Reference:" prefix
//    ("[Reference:NCERT Biology 11th Pg.NO: 19, Para 2]") — observed
//    extracted as "ncern biology", "ncot biology 11th", once garbled
//    entirely into "ncertainc?".
//  - the same textbook reference, bare, on its own line with no brackets
//    ("NCERT Biology 11th Pg.NO: 19, Para 2").
//  - a short exam-year citation trailing the QUESTION text itself —
//    observed in THREE different bracket/spacing styles across different
//    questions in the same bank, apparently from inconsistent manual
//    content authoring: "[NEET 2021]", "[NEET 2024 Re]" (trailing "Re" =
//    re-exam), and "(NEET2019)" (parens, no space before the year). Each
//    variant was caught live only after the previous regex missed it and
//    "neet" leaked through as a term — the match below covers all three
//    known shapes (either bracket type, optional space before the year,
//    open-ended trailing content), but given how inconsistent this
//    formatting has already proven to be, don't assume this is
//    exhaustive — see the CITATION_LIKE output-side filter in
//    keywordExtractor.js for the safety net that catches "neet" even if a
//    citation shape slips past this stripper entirely.
// All shapes always appear as a distinct trailing citation, never blended
// into a sentence, so stripping wherever they match is safe.
const stripCitations = (text) => {
  if (!text) return "";

  return text
    .replace(/\[Reference\s*:[^\]]*\]/gi, " ") // bracketed textbook form, whatever's inside
    .replace(/NCERT\s+\w+\s+\d+(?:th|st|nd|rd)?\s+Pg\.?\s*NO\s*:\s*\d+\s*,\s*Para\s*\d+/gi, " ") // bare textbook form
    .replace(/[[(][A-Z]{3,}\s*\d{4}[^\])]*[\])]/g, " ") // exam-year citation, any bracket style
    .replace(/\s+/g, " ")
    .trim();
};

module.exports = { stripCitations };
