const { runTask } = require("../router/aiRouter");
const { buildKeywordExtractionPrompt } = require("../prompts/keywordExtractionPrompt");
const { parseJsonResponse } = require("../utils/parseJson");
const { stripHtml } = require("../utils/stripHtml");

// One AI call per question — replaces the old rule-based extraction, which
// could only filter by word length/a fixed stopword list and had no way to
// tell "mitochondria" (worth explaining) apart from "containing" (not).
// An LLM can actually judge technical-vs-everyday, which is the point.
const extractKeywordsWithAI = async (questionText, hintText) => {
  const { system, prompt } = buildKeywordExtractionPrompt(stripHtml(questionText), stripHtml(hintText));
  const result = await runTask("keywordExtraction", { system, prompt, maxTokens: 400, jsonMode: true });
  const parsed = parseJsonResponse(result.text);

  const terms = Array.isArray(parsed.terms) ? parsed.terms : [];
  return terms.map((t) => String(t).toLowerCase().trim()).filter(Boolean);
};

module.exports = { extractKeywordsWithAI };
