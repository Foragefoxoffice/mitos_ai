const OpenAI = require("openai");

// DeepSeek's API is OpenAI-compatible — same client, different base URL.
let client;
const getClient = () => {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: "https://api.deepseek.com" });
  }
  return client;
};

// Common provider interface: generate({ model, system, prompt, maxTokens, temperature, jsonMode })
//   -> { text, inputTokens, outputTokens }
//
// thinking: { type: "disabled" } is NOT optional — deepseek-v4-flash is a
// reasoning model by default. Verified live (2026-08-22): with thinking
// left on, it burned its entire token budget on hidden reasoning before
// writing any visible output — 16 of 21 real extraction calls came back
// with truncated/empty JSON even at 600 tokens, and three retested at 4000
// tokens still spent 1,171-1,918 tokens on invisible reasoning alone
// (10-17s per call). `reasoning_effort: "low"`/`"minimal"` did NOT fix
// this (still hit the cap with pure reasoning, zero output) — only fully
// disabling thinking did: 21/21 success, ~1.1s/call, valid JSON every time.
// None of these short structured-JSON tasks need deep reasoning anyway.
const generate = async ({ model, system, prompt, maxTokens = 1024, temperature, jsonMode = false }) => {
  const response = await getClient().chat.completions.create({
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt },
    ],
    max_tokens: maxTokens,
    thinking: { type: "disabled" },
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
