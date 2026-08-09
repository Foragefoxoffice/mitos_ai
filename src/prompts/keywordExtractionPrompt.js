const buildKeywordExtractionPrompt = (questionText, hintText) => ({
  system: [
    "You extract genuinely technical, subject-specific vocabulary from a NEET (Indian medical entrance exam) exam question, for a tap-to-learn dictionary feature students use while practicing.",
    'Return ONLY a JSON object — no markdown, no commentary — with one key "terms": an array of strings.',
    "Include ANY word/short phrase a NEET student could benefit from tapping to learn more about: scientific terms, named structures/organs/organelles, processes, named laws/principles/theorems, techniques, instruments, and technical vocabulary specific to Biology/Chemistry/Physics — even ones a strong student might already know. This feature is opt-in (a student only taps a term if they want to), so a missed important term is a worse outcome than an extra one the student already knows and simply ignores — when in doubt, include it.",
    'EXCLUDE: common everyday English words, question-boilerplate phrasing (e.g. "which of the following", "correct answer", "regarding", "consider the statements"), generic verbs, and words a student would already understand purely from everyday English, not subject knowledge.',
    "EXCLUDE, ALWAYS: mathematical formulas, equations, numbers, units, standalone symbols/variables, and any LaTeX/math markup or command names (e.g. dfrac, frac, theta, omega, or anything that looks like it came from a LaTeX expression rather than plain English prose). A formula fragment is never a valid term, even if it looks unfamiliar.",
    "Each term should be a single word or a short (2-3 word) technical phrase, in its base/singular form, lowercase.",
    "Return up to 12 terms, ordered from most to least essential to understanding the core concept being tested. If a question genuinely has more than 12 worthwhile terms, keep the 12 most essential ones — never drop a genuinely important term just to shorten the list further than that. If there are no genuinely technical terms, return an empty array.",
    "",
    "Examples of the level of thoroughness expected:",
    'Physics — Question: "A vernier caliper has a main scale reading of 4 cm and 6 divisions of the vernier scale coincide with the main scale, with least count 0.01 cm. Find the zero error if the zero of the vernier scale is ahead of the main scale zero." → {"terms": ["vernier caliper", "main scale reading", "vernier scale", "least count", "zero error", "coincide"]}',
    'Chemistry — Question: "Which of the following exhibits Schottky defect in its crystal lattice due to missing cations and anions in equal number?" → {"terms": ["schottky defect", "crystal lattice", "cation", "anion"]}',
    'Biology — Question: "The mitochondria is the site of oxidative phosphorylation, which generates ATP using the electron transport chain." → {"terms": ["mitochondria", "oxidative phosphorylation", "atp", "electron transport chain"]}',
  ].join("\n"),
  prompt: `Question: ${questionText}\n\nHint/Explanation: ${hintText || "(none)"}`,
});

module.exports = { buildKeywordExtractionPrompt };
