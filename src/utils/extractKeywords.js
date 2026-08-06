// Naive, rule-based keyword extraction — deliberately NOT an AI call, since
// extraction runs on every question in the batch and generation (the actual
// AI cost) should only ever happen once per genuinely new term. Quality can
// be improved later (proper NLP, a curated subject glossary, etc.) without
// changing the job/dedup mechanism built around this.
const STOPWORDS = new Set([
  "which", "following", "correct", "incorrect", "true", "false", "statement",
  "statements", "regarding", "respect", "given", "above", "below", "these",
  "those", "there", "their", "about", "would", "could", "should", "among",
  "between", "during", "while", "where", "when", "what", "with", "from",
  "into", "onto", "than", "that", "this", "does", "each", "both", "either",
  "neither", "option", "options", "answer", "reason", "assertion",
  "explanation", "value", "values", "process", "processes", "shown",
  "figure", "table", "given", "based",
]);

// Default raised from 5 to 15 — a single question realistically contains
// several distinct meaningful terms (e.g. "mitochondria", "cristae", "ATP
// synthase" all in one question), and capping too low was cutting off
// real terms before ever reaching them, not just filtering noise.
// Configurable since a higher cap means more genuinely-new terms surface
// per question, which means more throttled AI calls per batch (more cost,
// slower runs) — tune via env once real coverage/cost tradeoffs are known.
const DEFAULT_MAX = Number(process.env.KEYWORD_MAX_PER_QUESTION) || 15;

const extractKeywords = (text, { max = DEFAULT_MAX, minLength = 5 } = {}) => {
  if (!text) return [];

  const words = text
    .replace(/<[^>]*>/g, " ")
    .replace(/[^a-zA-Z\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  const seen = new Set();
  const keywords = [];

  for (const word of words) {
    const normalized = word.toLowerCase();
    if (normalized.length < minLength) continue;
    if (STOPWORDS.has(normalized)) continue;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    keywords.push(normalized);

    if (keywords.length >= max) break;
  }

  return keywords;
};

module.exports = { extractKeywords };
