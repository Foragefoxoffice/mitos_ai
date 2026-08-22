// One call returns all six explanation variants as JSON — six separate
// calls per term would multiply system-prompt/overhead cost by 6x for no
// quality benefit.
//
// `subject` ("physics" | "chemistry" | "biology" | "general") scopes which
// sense of the term to define — a word like "cell" (a biological cell vs.
// an electrochemical cell) or "horn" (an animal structure vs. a
// sound-producing instrument in a wave-physics question) means something
// different depending on which subject it was encountered in. Each
// subject gets its own ai_dictionary row (see the (term, subject) unique
// constraint), so the definition generated here only ever needs to cover
// ONE sense, not disambiguate between all of them.
const buildDictionaryPrompt = (term, subject = "general") => {
  const subjectLine =
    subject === "general"
      ? "This term's subject wasn't identified when it was extracted — write the definition for whichever subject (Physics, Chemistry, or Biology) the term is most commonly associated with."
      : `This term was extracted from a ${subject.toUpperCase()} question. Define it specifically as it's used in ${subject} — if this exact word also means something different in another NEET subject (e.g. "cell" as a biological cell vs. an electrochemical cell, "horn" as an animal structure vs. a sound-wave instrument, "current" as electric current vs. a water/ocean current, "power" as physics power vs. political/biological power), do NOT mention or blend in that other subject's sense at all. Write only the ${subject} definition, as if the other senses don't exist for this entry.`;

  return {
    system: [
      "You generate dictionary entries for a NEET (Indian medical entrance exam) exam-prep app, covering the NCERT-aligned 11th and 12th grade Physics, Chemistry, and Biology syllabus.",
      subjectLine,
      'Given a term from the question bank, return ONLY a JSON object — no markdown, no commentary — with exactly these keys:',
      '"meaning" (one-line formal definition),',
      '"simpleExplanation" (2-3 plain-language sentences),',
      '"eli5" (explain like the reader is 12 years old),',
      '"detailedExplanation" (a thorough NEET-syllabus-level paragraph, calibrated to what an 11th/12th-grade NCERT textbook would say — not more advanced/collegiate than that, and not missing standard syllabus context a NEET student is expected to know),',
      '"mnemonic" (ONE single memory aid, not several alternatives to choose from — pick the single best hook and commit to it. Keep it to one short sentence, under 15 words. It must be genuinely memorable (a vivid image, a sound-alike, a simple acronym) — not a rephrasing of the definition, and not a vague/tenuous association a student would have to strain to connect back to the term. Write only the final, clean mnemonic itself — never show your own reasoning process, a rejected first idea, or a self-correction like "actually, think of it as..." within the field; if you reconsider mid-thought, keep only the version you land on. If nothing genuinely catchy fits, return null rather than forcing a weak one.),',
      '"realLifeExample" (a relatable real-world example, or null if none fits naturally).',
      "Whenever any field includes a formula, equation, ratio, unit exponent, or Greek letter, write it as real LaTeX. The app's renderer ONLY supports INLINE math delimited with single $...$ — verified live: $...$ renders correctly (including fractions like $\\frac{an^2}{V^2}$), but display-math delimiters (\\[...\\] or $$...$$) render as broken raw text, showing the literal backslashes and brackets to the student instead of a formula. So: NEVER use \\[...\\] or $$...$$, no matter how long or complex the equation is — always wrap it in single $...$ instead, even a full multi-term equation like $\\left(P + \\frac{an^2}{V^2}\\right)(V - nb) = nRT$. Never fall back to a plain-text approximation like \"theta = s / r\" or \"M^0 L^0 T^0\" or \"F/A\" either — use proper LaTeX commands (\\theta, \\frac{}{}, ^{...}, _{...}) inside the single-dollar delimiters so the app renders an actual formula instead of literal text.",
    ].join(" "),
    prompt: `Term: "${term}"${subject !== "general" ? ` (Subject: ${subject})` : ""}`,
  };
};

module.exports = { buildDictionaryPrompt };
