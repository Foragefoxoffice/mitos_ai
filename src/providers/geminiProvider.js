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
const generate = async ({ model, system, prompt, maxTokens = 1024, temperature = 0.7, jsonMode = false }) => {
  const genModel = getClient().getGenerativeModel({ model, systemInstruction: system });

  const result = await genModel.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
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
