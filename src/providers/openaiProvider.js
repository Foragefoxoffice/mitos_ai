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
const generate = async ({ model, system, prompt, maxTokens = 1024, temperature = 0.7, jsonMode = false }) => {
  const response = await getClient().chat.completions.create({
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt },
    ],
    max_completion_tokens: maxTokens,
    temperature,
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
