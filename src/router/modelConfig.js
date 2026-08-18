// Model IDs are read from env so they can be updated without a code change.
// "gemini-flash-latest" is verified working (2026-08-05, live call against
// gemini-2.5-flash directly 404'd for new API keys — the "-latest" alias
// avoids hardcoding a version Google can deprecate under us). GPT-5/GPT-5-mini
// and Claude Sonnet entries are unverified — no OpenAI/Anthropic key added
// yet — confirm against provider docs once those keys are in .env.
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
      primary: { provider: "gemini", model: process.env.MODEL_KEYWORDS_PRIMARY || "gemini-flash-latest" },
      fallback: { provider: "openai", model: process.env.MODEL_KEYWORDS_FALLBACK || "gpt-5-mini" },
    },
    wordExplain: {
      primary: { provider: "gemini", model: process.env.MODEL_WORD_PRIMARY || "gemini-flash-latest" },
      fallback: { provider: "openai", model: process.env.MODEL_WORD_FALLBACK || "gpt-5-mini" },
    },
    explainAndChat: {
      primary: { provider: "gemini", model: process.env.MODEL_CHAT_PRIMARY || "gemini-flash-latest" },
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
