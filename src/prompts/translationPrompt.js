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
const buildTranslationPrompt = ({ language, questionType, fields }) => {
  const { question, optionA, optionB, optionC, optionD, hint } = fields;

  const fieldLines = [
    question != null ? `"question": ${JSON.stringify(question)}` : null,
    optionA != null ? `"optionA": ${JSON.stringify(optionA)}` : null,
    optionB != null ? `"optionB": ${JSON.stringify(optionB)}` : null,
    optionC != null ? `"optionC": ${JSON.stringify(optionC)}` : null,
    optionD != null ? `"optionD": ${JSON.stringify(optionD)}` : null,
    hint != null ? `"hint": ${JSON.stringify(hint)}` : null,
  ].filter(Boolean);

  return {
    system: [
      `You translate NEET (Indian medical entrance exam) exam-prep question content from English into ${language.name} (${language.nativeName}), for students preparing in that regional language.`,
      "Translate naturally and clearly, the way an actual NEET regional-language question paper would phrase it — not a stiff word-for-word translation. Keep the scientific register (this is a Physics/Chemistry/Biology exam question, not casual conversation).",
      `Some text is replaced with placeholder tokens that look like §MATH0§, §MATH1§, etc. — these stand in for formulas, numbers, units, and equations. NEVER translate, alter, remove, or reorder these tokens. Copy each one through completely unchanged, in the same position relative to the surrounding ${language.name} text (adjust word order around a token as needed for natural ${language.name} grammar, but the token itself must appear verbatim, exactly once, wherever it belongs in the translated sentence).`,
      "Proper nouns, standard scientific terms with no common regional equivalent, and chemical formulas/element symbols embedded in prose (outside the §MATHn§ tokens) may stay in their standard form if that's how they'd actually appear in a real regional-language NEET paper — don't force an awkward translation where the original notation is already standard practice.",
      "Return ONLY a JSON object — no markdown, no commentary — with exactly the same keys you were given (only translate keys that were provided; never invent extra keys or omit given ones).",
    ].join(" "),
    prompt: `${questionType ? `Question type: ${questionType}\n` : ""}Translate the following fields:\n{\n  ${fieldLines.join(",\n  ")}\n}`,
  };
};

module.exports = { buildTranslationPrompt };
