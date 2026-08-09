const { runTask } = require("../router/aiRouter");
const { buildKeywordExtractionPrompt } = require("../prompts/keywordExtractionPrompt");
const { parseJsonResponse } = require("../utils/parseJson");
const { stripHtml } = require("../utils/stripHtml");
const { stripLatex } = require("../utils/stripLatex");

// A returned "term" that still looks like LaTeX/math (backslash, bare
// digits, or a command name with NO standalone English/scientific meaning)
// gets dropped even if the model returned it anyway — output-side safety
// net on top of the input-side stripping and the prompt instruction, so a
// formula fragment can't slip through all three. Deliberately does NOT
// block Greek-letter names (alpha, beta, theta, omega, ...) — those are
// legitimate standalone physics/chemistry vocabulary (e.g. "alpha
// particle") as well as LaTeX command names, so blocking them by name
// would remove genuinely valid terms, not just formula leakage.
const LATEX_LIKE = /\\|^\d+$|^(dfrac|frac|sqrt|cdot|infty|nabla|partial|leq|geq|neq)$/i;

// One AI call per question — replaces the old rule-based extraction, which
// could only filter by word length/a fixed stopword list and had no way to
// tell "mitochondria" (worth explaining) apart from "containing" (not).
// An LLM can actually judge technical-vs-everyday, which is the point.
const extractKeywordsWithAI = async (questionText, hintText) => {
  const cleanQuestion = stripLatex(stripHtml(questionText));
  const cleanHint = stripLatex(stripHtml(hintText));

  const { system, prompt } = buildKeywordExtractionPrompt(cleanQuestion, cleanHint);
  // Bumped from 400 — the prompt now allows up to 12 terms (was 10) plus
  // few-shot examples in the system prompt push the model toward longer,
  // more thorough completions; same class of truncation risk already hit
  // and fixed for chat (700 -> 1500).
  const result = await runTask("keywordExtraction", { system, prompt, maxTokens: 600, jsonMode: true });
  const parsed = parseJsonResponse(result.text);

  const terms = Array.isArray(parsed.terms) ? parsed.terms : [];
  return terms
    .map((t) => String(t).toLowerCase().trim())
    .filter(Boolean)
    .filter((t) => !LATEX_LIKE.test(t));
};

module.exports = { extractKeywordsWithAI };
