const { runTask } = require("../router/aiRouter");
const { buildDictionaryPrompt } = require("../prompts/dictionaryPrompt");
const { parseJsonResponse } = require("../utils/parseJson");

// Exactly one AI call per term — called only for terms that don't already
// exist in ai_dictionary (see dictionaryBatchRunner.js for the dedup check).
const generateDictionaryEntry = async (term) => {
  const { system, prompt } = buildDictionaryPrompt(term);
  // 6 explanation fields as JSON needs more headroom than a single answer —
  // 700 was truncating mid-response (verified: cut off mid-string, not a
  // formatting issue). 1500 was still occasionally truncating too — live
  // reproduced against real "failed" DB rows: same term, same prompt,
  // sometimes a longer completion runs out of room ("Unexpected end of
  // JSON input" / "Unterminated string"). This is response-length variance
  // per call, not a fixed content size, so raised again with more margin.
  const result = await runTask("wordExplain", { system, prompt, maxTokens: 2500, jsonMode: true });
  const parsed = parseJsonResponse(result.text);

  return {
    meaning: parsed.meaning ?? null,
    simpleExplanation: parsed.simpleExplanation ?? null,
    eli5: parsed.eli5 ?? null,
    detailedExplanation: parsed.detailedExplanation ?? null,
    mnemonic: parsed.mnemonic ?? null,
    realLifeExample: parsed.realLifeExample ?? null,
    provider: result.provider,
    model: result.model,
  };
};

module.exports = { generateDictionaryEntry };
