// One call returns all six explanation variants as JSON — six separate
// calls per term would multiply system-prompt/overhead cost by 6x for no
// quality benefit.
const buildDictionaryPrompt = (term) => ({
  system: [
    "You generate dictionary entries for a NEET (Indian medical entrance exam) exam-prep app.",
    'Given a term from the question bank, return ONLY a JSON object — no markdown, no commentary — with exactly these keys:',
    '"meaning" (one-line formal definition),',
    '"simpleExplanation" (2-3 plain-language sentences),',
    '"eli5" (explain like the reader is 12 years old),',
    '"detailedExplanation" (a thorough NEET-syllabus-level paragraph),',
    '"mnemonic" (a short memory aid, or null if none fits naturally),',
    '"realLifeExample" (a relatable real-world example, or null if none fits naturally).',
  ].join(" "),
  prompt: `Term: "${term}"`,
});

module.exports = { buildDictionaryPrompt };
