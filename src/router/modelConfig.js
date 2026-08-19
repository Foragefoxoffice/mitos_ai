// Model IDs are read from env so they can be updated without a code change.
// "gemini-3.6-flash" (verified working 2026-08-05) started 503'ing
// ("experiencing high demand") as of 2026-08-19 — the "-latest" alias is
// evidently not a stable escape from Google's model churn after all.
// gemini-2.0-flash and gemini-1.5-flash both now 404 as fully retired;
// Google's own 404 response for 2.0-flash points at gemini-3.6-flash as
// the replacement, and that's what's live-verified working now (2026-08-19,
// real API call, real key). GPT-5/GPT-5-mini and Claude Sonnet entries are
// unverified — no OpenAI/Anthropic key added yet — confirm against
// provider docs once those keys are in .env.
//
// AI_LOCAL_ONLY=true routes every task's primary AND fallback to a local
// Ollama model, with no third-party provider anywhere in the chain — for
// local dev machines that don't have (and shouldn't need) real
// OPENAI_API_KEY/GEMINI_API_KEY/ANTHROPIC_API_KEY set. Deliberately not
// inferred from NODE_ENV — this needs to be an explicit opt-in per
// machine, not something that flips silently. Leave unset in production;
// ecosystem.config.js's env block doesn't set it, so a deployed instance
// always uses the real provider config below regardless of this file.
const LOCAL_ONLY = process.env.AI_LOCAL_ONLY === "true";

if (LOCAL_ONLY) {
  const localRoute = { provider: "ollama", model: process.env.OLLAMA_MODEL || "qwen2.5:14b" };

  module.exports = {
    keywordExtraction: { primary: localRoute, fallback: localRoute },
    wordExplain: { primary: localRoute, fallback: localRoute },
    explainAndChat: { primary: localRoute, fallback: localRoute },
    performanceAnalysis: { primary: localRoute, fallback: localRoute },
    studyPlan: { primary: localRoute, fallback: localRoute },
  };
} else {
  module.exports = {
    keywordExtraction: {
      primary: { provider: "gemini", model: process.env.MODEL_KEYWORDS_PRIMARY || "gemini-3.6-flash" },
      fallback: { provider: "openai", model: process.env.MODEL_KEYWORDS_FALLBACK || "gpt-5-mini" },
    },
    wordExplain: {
      primary: { provider: "gemini", model: process.env.MODEL_WORD_PRIMARY || "gemini-3.6-flash" },
      fallback: { provider: "openai", model: process.env.MODEL_WORD_FALLBACK || "gpt-5-mini" },
    },
    explainAndChat: {
      primary: { provider: "gemini", model: process.env.MODEL_CHAT_PRIMARY || "gemini-3.6-flash" },
      fallback: { provider: "openai", model: process.env.MODEL_CHAT_FALLBACK || "gpt-5-mini" },
    },
    performanceAnalysis: {
      primary: { provider: "claude", model: process.env.MODEL_ANALYSIS_PRIMARY || "claude-sonnet-5" },
      fallback: { provider: "openai", model: process.env.MODEL_ANALYSIS_FALLBACK || "gpt-5-mini" },
    },
    studyPlan: {
      primary: { provider: "openai", model: process.env.MODEL_STUDYPLAN_PRIMARY || "gpt-5" },
      fallback: { provider: "claude", model: process.env.MODEL_STUDYPLAN_FALLBACK || "claude-sonnet-5" },
    },
  };
}
