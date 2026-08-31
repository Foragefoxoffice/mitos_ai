// Regional Language Translation — one AI call translates all of a
// question's translatable fields at once (question, 4 options, hint),
// mirroring dictionaryPrompt.js's single-call-returns-JSON pattern.
//
// Math/formula safety: callers protect LaTeX regions with protectLatex.js
// BEFORE building this prompt (replacing them with §MATHn§ placeholder
// tokens) and restore them with restoreLatex.js after — this prompt's job
// is just to tell the model never to touch those tokens. See
// docs/superpowers/specs/2026-08-24-regional-language-translation-design.md
// §5 for why: translation models are more likely than extraction models to
// "helpfully" rephrase inline math if not carefully isolated, so the
// isolation happens outside the model's control entirely rather than
// relying on a prompt instruction alone.
//
// `language` is {code, name, nativeName} from the ai_language table — the
// whole point of the languageId-FK design is that adding language #2
// through #13 is a data change, not a prompt/code change, so nothing here
// hardcodes "Hindi".
//
// `fixedTemplates`/`matchedTerms` (optional): real reference data
// extracted from 369 pages of actual bilingual NEET Hindi past-year
// papers (2018-2026) — see hindiReferenceMatcher.js. A client-reported
// quality issue (2026-08-31) traced to generic AI translation not
// matching how real NEET Hindi papers are actually phrased — grammatically
// fine, but foreign-sounding to someone used to reading real ones, or
// using non-standard terminology for words with an established NCERT/NTA
// convention. `fixedTemplates` are near-universal boilerplate (>=60% of
// observed real occurrences agree on one exact wording) — small enough
// (45 entries) to always include. `matchedTerms` is pre-filtered by the
// caller to only the terms that actually appear in THIS question — the
// full terminology table has 955 entries, too many to embed in every
// call, so only the relevant subset is passed in per-question.
// Deliberately Hindi-only for now (empty/omitted for other languages
// until similar reference material exists for them) — this is real
// extracted data, not something to fake for a language it wasn't built
// from.
const buildTranslationPrompt = ({ language, questionType, fields, fixedTemplates, matchedTerms }) => {
  const { question, optionA, optionB, optionC, optionD, hint } = fields;

  const fieldLines = [
    question != null ? `"question": ${JSON.stringify(question)}` : null,
    optionA != null ? `"optionA": ${JSON.stringify(optionA)}` : null,
    optionB != null ? `"optionB": ${JSON.stringify(optionB)}` : null,
    optionC != null ? `"optionC": ${JSON.stringify(optionC)}` : null,
    optionD != null ? `"optionD": ${JSON.stringify(optionD)}` : null,
    hint != null ? `"hint": ${JSON.stringify(hint)}` : null,
  ].filter(Boolean);

  const templateLines = (fixedTemplates || [])
    .map((t) => `"${t.english}" -> "${t.hindi}"`)
    .join("\n");

  const termLines = (matchedTerms || [])
    .map((t) => `"${t.english}" -> "${t.hindi}"${t.alternates?.length ? ` (also acceptable: ${t.alternates.join(", ")})` : ""}`)
    .join("\n");

  return {
    system: [
      `You translate NEET (Indian medical entrance exam) exam-prep question content from English into ${language.name} (${language.nativeName}), for students preparing in that regional language.`,
      "Translate naturally and clearly, the way an actual NEET regional-language question paper would phrase it — not a stiff word-for-word translation. Keep the scientific register (this is a Physics/Chemistry/Biology exam question, not casual conversation).",
      `Some text is replaced with placeholder tokens that look like §MATH0§, §MATH1§, etc. — these stand in for formulas, numbers, units, and equations. NEVER translate, alter, remove, or reorder these tokens. Copy each one through completely unchanged, in the same position relative to the surrounding ${language.name} text (adjust word order around a token as needed for natural ${language.name} grammar, but the token itself must appear verbatim, exactly once, wherever it belongs in the translated sentence).`,
      "Proper nouns, standard scientific terms with no common regional equivalent, and chemical formulas/element symbols embedded in prose (outside the §MATHn§ tokens) may stay in their standard form if that's how they'd actually appear in a real regional-language NEET paper — don't force an awkward translation where the original notation is already standard practice.",
      templateLines
        ? `The following instructional/boilerplate phrases have one well-established standard translation, extracted from real past NEET papers — use these EXACT translations whenever this exact (or near-exact, allowing for punctuation/capitalization differences) English phrase appears, do not paraphrase them:\n${templateLines}`
        : null,
      termLines
        ? `The following scientific/technical terms have an established translation in real NEET Hindi papers — use these exact terms for consistency with how students actually see them in real exam papers, unless the surrounding grammar genuinely requires a different form of the same word:\n${termLines}`
        : null,
      "Return ONLY a JSON object — no markdown, no commentary — with exactly the same keys you were given (only translate keys that were provided; never invent extra keys or omit given ones).",
    ].filter(Boolean).join(" "),
    prompt: `${questionType ? `Question type: ${questionType}\n` : ""}Translate the following fields:\n{\n  ${fieldLines.join(",\n  ")}\n}`,
  };
};

module.exports = { buildTranslationPrompt };
