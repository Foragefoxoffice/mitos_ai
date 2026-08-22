// Models sometimes wrap JSON in a markdown code fence despite being told
// not to — strip it before parsing rather than failing the whole entry.
//
// dictionaryPrompt.js explicitly asks for real LaTeX (\theta, \frac{}{},
// \, for thin-space, ...) inside JSON string fields — a model that actually
// complies emits a raw single backslash, which is invalid JSON (only \\, \",
// \/, \b, \f, \n, \r, \t, \uXXXX are legal escapes). Verified live: Gemini
// follows the LaTeX instruction faithfully — and inconsistently escapes it —
// so a single response can mix correctly-doubled backslashes (\\theta) with
// bare ones (\circ, \,) even for the same command elsewhere in the same
// reply. This broke ~1 in 3-4 term-generation calls with "Bad escaped
// character in JSON". First attempt only escaped backslash-before-a-letter
// (catches \theta, \circ, \vec) but missed punctuation-led LaTeX spacing
// commands (\, \; \!) — verified live against real captured failures
// (moment of inertia's "$\int r^2 \, dm$" still failed). Second attempt
// escaped every lone backslash except the 4 valid escape starts, but
// processed backslashes one at a time with a lookahead — which corrupts an
// ALREADY-correctly-escaped pair like "\\vec" (two literal backslashes):
// the lookahead skips the first backslash (correctly, since it's followed by
// another backslash), then re-examines that SAME second backslash on its own
// and — now followed by a letter, not another backslash — escapes it too,
// turning a valid "\\vec" into a broken "\\\vec" (odd number of backslashes).
// Verified live: "zero vector"'s "$\\vec{0}$" still failed with the
// lookahead version. Fix: match whole tokens instead of single characters —
// either a complete valid escape (\\, \", \/, \uXXXX), consumed as one unit
// so its second character is never re-examined, or a lone backslash, which
// gets doubled. This can't distinguish a genuine \n/\t/\r/\b/\f control
// escape from a LaTeX command starting with the same letter (e.g. \theta vs
// \t), so an intentional newline would get flattened to literal "\n" text
// rather than an actual line break. Accepted trade-off: these explanation
// fields are prose/formulas that essentially never need a real control
// character, and a cosmetic flattened newline is a far smaller problem than
// losing the entire term's explanation to a parse failure.
const escapeBareLatexBackslashes = (text) =>
  text.replace(/\\\\|\\"|\\\/|\\u[0-9a-fA-F]{4}|\\/g, (match) => (match === "\\" ? "\\\\" : match));

const parseJsonResponse = (text) => {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  return JSON.parse(escapeBareLatexBackslashes(cleaned));
};

module.exports = { parseJsonResponse };
