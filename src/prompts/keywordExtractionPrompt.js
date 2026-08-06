const buildKeywordExtractionPrompt = (questionText, hintText) => ({
  system: [
    "You extract genuinely technical, subject-specific vocabulary from a NEET (Indian medical entrance exam) exam question, for a tap-to-learn dictionary feature.",
    'Return ONLY a JSON object — no markdown, no commentary — with one key "terms": an array of strings.',
    "Include ONLY words/short phrases a NEET student might NOT already understand: scientific terms, named structures, processes, named laws/principles, technical vocabulary specific to Biology/Chemistry/Physics.",
    'EXCLUDE: common everyday English words, question-boilerplate phrasing (e.g. "which of the following", "correct answer", "regarding"), generic verbs, and anything a student would already understand without explanation.',
    "Each term should be a single word or a short (2-3 word) technical phrase, in its base/singular form, lowercase.",
    "Return at most 10 terms. If there are no genuinely technical terms, return an empty array.",
  ].join(" "),
  prompt: `Question: ${questionText}\n\nHint/Explanation: ${hintText || "(none)"}`,
});

module.exports = { buildKeywordExtractionPrompt };
