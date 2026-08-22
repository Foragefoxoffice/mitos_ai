const OpenAI = require("openai");

// Lazy singleton: constructing the client throws if OPENAI_API_KEY isn't set,
// and we don't want requiring this module to crash the service for a key
// that isn't needed yet (e.g. only Gemini configured so far).
let client;
const getClient = () => {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
};

// Common provider interface: generate({ model, system, prompt, maxTokens, temperature, jsonMode })
//   -> { text, inputTokens, outputTokens }
//
// temperature has NO default here (unlike the other providers) — reasoning
// models in the gpt-5 family reject any non-default value outright ("400
// Unsupported value: 'temperature' does not support 0.7 with this model.
// Only the default (1) value is supported"). None of today's callers
// (keywordExtractor.js, dictionaryGenerator.js) pass one, so this was
// silently failing 100% of the time whenever a call actually reached
// OpenAI — masked until now by the account also being over quota, which
// made it look like quota was the only blocker. Omitting the param
// entirely lets each model fall back to its own safe default; callers that
// genuinely need a specific temperature (compatible models only) can still
// pass one explicitly.
// reasoning_effort: "minimal" — the configured model (gpt-5-mini) is a
// reasoning model that spends part of max_completion_tokens on a hidden
// chain-of-thought before writing any visible output. Verified live:
// without this, both keyword-extraction (600 tokens) and dictionary-entry
// (1500 tokens) calls silently consumed the ENTIRE budget on hidden
// reasoning and returned empty content — no error, just nothing, which
// would have looked like a parsing bug rather than the real cause. Every
// task here (short structured JSON) is well within "minimal" reasoning's
// capability, so there's no quality cost to turning it down. This assumes
// the configured model is always gpt-5-family; a future non-reasoning
// OpenAI model would need this made conditional.
const generate = async ({ model, system, prompt, maxTokens = 1024, temperature, jsonMode = false }) => {
  const response = await getClient().chat.completions.create({
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt },
    ],
    max_completion_tokens: maxTokens,
    reasoning_effort: "minimal",
    ...(temperature !== undefined ? { temperature } : {}),
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  const choice = response.choices[0];

  return {
    text: choice.message.content,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  };
};

module.exports = { generate };
