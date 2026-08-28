const Anthropic = require("@anthropic-ai/sdk");

// Lazy singleton — see openaiProvider.js for why.
let client;
const getClient = () => {
  if (!client) {
    // Both defaults (timeout: 10 min, maxRetries: 2) are wrong for this
    // service's use — aiRouter.js already falls through to the next
    // provider on failure, so a stuck request here should fail fast into
    // that fallback rather than sit for up to 10 minutes, and the SDK's
    // own internal retries would silently double/triple that wait before
    // aiRouter even sees an error. 30s, not something shorter — live-
    // tested 2026-08-28: a real successful "complex"-tier chat reply
    // (the "explain step by step" case) took 16.2s on the fastest/
    // leading provider alone; an earlier attempt at 12s would have
    // killed that legitimate call and forced an unnecessary fallback.
    // A full 4-provider chain can still exceed backend's 60s budget in
    // the rare case every provider is degraded at once — that's an
    // accepted, deliberately-not-fully-closed tail risk (a slow eventual
    // success past 60s could still get silently charged the same way
    // the original bug did), traded off against not cutting off the
    // common case of one real provider answering slowly-but-normally.
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 30000, maxRetries: 0 });
  }
  return client;
};

// Common provider interface: generate({ model, system, prompt, maxTokens, temperature, jsonMode })
//   -> { text, inputTokens, outputTokens }
// jsonMode is accepted for interface parity but not enforced here — the
// Messages API doesn't have a response_format equivalent; structured output
// would need tool-use instead. Not wired up since no task routes to Claude
// with jsonMode yet (performanceAnalysis, if it needs structured output
// later, should implement tool-use here rather than relying on prompting).
const generate = async ({ model, system, prompt, maxTokens = 1024, temperature = 0.7, jsonMode = false }) => {
  const response = await getClient().messages.create({
    model,
    system,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    text,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
};

module.exports = { generate };
