const { GoogleGenerativeAI } = require("@google/generative-ai");

// Lazy singleton — see openaiProvider.js for why.
let genAI;
const getClient = () => {
  if (!genAI) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
};

// Common provider interface: generate({ model, system, prompt, maxTokens, temperature, jsonMode })
//   -> { text, inputTokens, outputTokens }
// jsonMode uses Gemini's actual structured-output mode (responseMimeType) —
// asking nicely in the prompt alone is not reliable, it still returns
// markdown-wrapped text often enough to matter.
//
// thinkingConfig.thinkingBudget: gemini-3.6-flash (the current default
// model, see modelConfig.js) is a "thinking" model that otherwise burns
// most of maxOutputTokens on invisible reasoning before writing the actual
// answer — live-verified 2026-08-19: a real chat request with
// maxOutputTokens:1500 spent 915 tokens on thoughtsTokenCount and got cut
// off mid-sentence (finishReason MAX_TOKENS) with no visible error, just a
// truncated reply. Budget 0 (fully disabled) is rejected by this model
// with a 400 — 1 is the minimum accepted value and is enough to stop
// thinking from crowding out the real answer (confirmed: same prompt at
// budget 1 finished with STOP and a complete reply).
const generate = async ({ model, system, prompt, maxTokens = 1024, temperature = 0.7, jsonMode = false }) => {
  const genModel = getClient().getGenerativeModel({ model, systemInstruction: system });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      thinkingConfig: { thinkingBudget: 1 },
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  });

  const response = result.response;
  const usage = response.usageMetadata || {};

  return {
    text: response.text(),
    inputTokens: usage.promptTokenCount ?? 0,
    outputTokens: usage.candidatesTokenCount ?? 0,
  };
};

module.exports = { generate };
