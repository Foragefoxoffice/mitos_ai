const { runTask } = require("../router/aiRouter");
const { buildKeywordExtractionPrompt } = require("../prompts/keywordExtractionPrompt");
const { parseJsonResponse } = require("../utils/parseJson");
const { stripHtml } = require("../utils/stripHtml");
const { stripLatex } = require("../utils/stripLatex");
const { stripCitations } = require("../utils/stripCitations");

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

// A single bare letter/symbol (e.g. "m", "t", "l") is never a valid
// dictionary term on its own — no false-positive risk, since no real
// vocabulary word is one character. Caught real garbage from the local
// Ollama model (weaker instruction-following than Gemini): question 624's
// dimensional-formula hint ("[MLT⁻²][L] = [ML²T⁻²]") produced "m"/"l"/"t"
// as standalone "terms" despite the prompt explicitly excluding them.
const SINGLE_CHAR = /^.$/;

// Bracket characters and the literal words "superscript"/"subscript" only
// ever show up when a model is describing a dimensional-formula fragment
// it couldn't fully strip out (e.g. "[ml2t-2]" or the observed
// "ml superscript negative one t superscript negative two") — never in a
// genuine vocabulary term, so safe to hard-block.
const FORMULA_NOTATION = /[[\]{}]|superscript|subscript/i;

// Words that only ever describe a formula variable spoken aloud (e.g. "v
// squared", "u squared", "x prime") — never legitimate standalone
// vocabulary modifiers on their own. Narrow and conservative on purpose: a
// real compound term built on a single letter (e.g. "g force", "c value")
// still passes through fine below, since its second word isn't in this set.
const FORMULA_DESCRIPTOR_WORDS = new Set(["squared", "cubed", "prime"]);

// A term where EVERY space-separated token is either a single letter, a
// bare (possibly signed) number, or one of the formula-descriptor words
// above is a formula fragment rather than a word — either dimensional
// notation spelled with spaces (e.g. "mlt −2" as two tokens, "ml 2 t −2" as
// four) or a variable name spoken as a phrase ("v squared" as two tokens).
// No legitimate multi-word technical phrase is built entirely out of these.
const isFormulaFragment = (term) => {
  const tokens = term.split(/\s+/).filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.every((t) => /^[a-z]$/i.test(t) || /^[-−+]?\d+$/.test(t) || FORMULA_DESCRIPTOR_WORDS.has(t))
  );
};

// Bare generic measurement/geometry nouns the prompt already explicitly
// names as always-exclude — the local Ollama model (weaker
// instruction-following than Gemini) still returns these sometimes anyway
// (verified: "distance", "time", "volume", "area" leaked through on a
// 12-question re-test even with the strengthened prompt). Exact-match only,
// so a genuine compound phrase built on one of these (e.g. "distance-time
// graph", "surface area") is untouched — only the bare generic noun itself
// is blocked.
const GENERIC_NOUNS = new Set([
  "distance",
  "time",
  "length",
  "area",
  "volume",
  "radius",
  "direction",
  "second",
  "minute",
  "units",
  "unit",
  "differentiate",
  "differentiating",
]);

// A term containing "ncert" or exactly "neet" is always leaked citation
// text, never real vocabulary — safe to hard-block regardless of how it's
// mangled. stripCitations() should catch the clean form before the model
// ever sees it, but a model that garbles a citation into something
// unrecognizable (observed live: "ncertainc?") can still slip past
// input-side stripping; this catches it either way. "neet" is exact-match
// rather than substring — unlike "ncert" it's a real 4-letter word/acronym
// on its own, but nothing in the actual vocabulary space here would ever
// contain it as a substring, so exact-match is the more conservative
// choice. Also verified live to be a genuine whack-a-mole: the exam-year
// citation this catches ("[NEET 2021]", "(NEET2019)", ...) has already
// been observed in three different bracket/spacing styles across
// different questions in the same bank — this filter is the backstop for
// whichever shape stripCitations() hasn't been taught yet.
const CITATION_LIKE = /ncert/i;
const isCitationLeak = (term) => CITATION_LIKE.test(term) || term === "neet";

// One AI call per question — replaces the old rule-based extraction, which
// could only filter by word length/a fixed stopword list and had no way to
// tell "mitochondria" (worth explaining) apart from "containing" (not).
// An LLM can actually judge technical-vs-everyday, which is the point.
const extractKeywordsWithAI = async (questionText, hintText) => {
  const cleanQuestion = stripCitations(stripLatex(stripHtml(questionText)));
  const cleanHint = stripCitations(stripLatex(stripHtml(hintText)));

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
    .filter((t) => !LATEX_LIKE.test(t))
    .filter((t) => !SINGLE_CHAR.test(t))
    .filter((t) => !FORMULA_NOTATION.test(t))
    .filter((t) => !isFormulaFragment(t))
    .filter((t) => !GENERIC_NOUNS.has(t))
    .filter((t) => !isCitationLeak(t));
};

module.exports = { extractKeywordsWithAI };
