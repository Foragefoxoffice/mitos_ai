const axios = require("axios");

// Local-only provider — points at an Ollama instance running on the same
// machine as ai-service (default: http://localhost:11434). This is
// deliberately NOT a viable primary in production: the deployed ai-service
// runs on a remote server with no Ollama installed, so a call here would
// just fail with ECONNREFUSED there — which is fine, aiRouter.js already
// falls through to the configured fallback provider on any error. Meant
// for local dev (free, no API cost, no rate limit) via per-task provider
// overrides in .env — see modelConfig.js.
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

// Common provider interface: generate({ model, system, prompt, maxTokens, temperature, jsonMode })
//   -> { text, inputTokens, outputTokens }
// Uses /api/chat (not /api/generate) so system and user content stay
// separate, matching every other provider adapter here. jsonMode uses
// Ollama's own "format: json" constrained-output mode, same idea as
// Gemini's responseMimeType / OpenAI's response_format.
const generate = async ({ model, system, prompt, maxTokens = 1024, temperature = 0.7, jsonMode = false }) => {
  const response = await axios.post(
    `${OLLAMA_BASE_URL}/api/chat`,
    {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      stream: false,
      ...(jsonMode ? { format: "json" } : {}),
      options: {
        num_predict: maxTokens,
        temperature,
      },
    },
    // Local generation on a 14B model can take a while on CPU — well above
    // the other providers' effective latency, so this needs its own
    // generous timeout rather than inheriting a short default.
    { timeout: 120000 }
  );

  const data = response.data;

  return {
    text: data.message?.content ?? "",
    inputTokens: data.prompt_eval_count ?? 0,
    outputTokens: data.eval_count ?? 0,
  };
};

module.exports = { generate };
