const Anthropic = require("@anthropic-ai/sdk");

// Lazy singleton — see openaiProvider.js for why.
let client;
const getClient = () => {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
