const providers = require("../providers");
const modelConfig = require("./modelConfig");
const logger = require("../utils/logger");

// Runs a task through an ordered list of model attempts, falling through to
// the next one on any error (rate limit, outage, bad response, wrong/dead
// key) — a task only fails once every attempt in its chain has failed. Task
// names match the AI Router section of
// docs/MITOS_AI_Platform_Implementation_Plan_REVISED.md.
//
// A task's config in modelConfig.js is either a flat array of attempts, or
// (for tasks that support complexity-based routing, e.g. explainAndChat) an
// object keyed by complexity tier, each holding its own array — `complexity`
// picks the tier, defaulting to "simple" if the task doesn't recognize it.
const runTask = async (taskName, { system, prompt, maxTokens, temperature, jsonMode, complexity } = {}) => {
  const config = modelConfig[taskName];
  if (!config) {
    throw new Error(`Unknown AI task: ${taskName}`);
  }

  const attempts = Array.isArray(config) ? config : config[complexity] || config.simple || Object.values(config)[0];
  let lastError;

  for (const attempt of attempts) {
    const provider = providers[attempt.provider];
    if (!provider) {
      lastError = new Error(`Unknown provider: ${attempt.provider}`);
      logger.warn(`[aiRouter] ${taskName} skipping unconfigured provider: ${attempt.provider}`);
      continue;
    }

    try {
      const result = await provider.generate({
        model: attempt.model,
        system,
        prompt,
        maxTokens,
        temperature,
        jsonMode,
      });

      return { ...result, provider: attempt.provider, model: attempt.model };
    } catch (error) {
      lastError = error;
      logger.warn(
        `[aiRouter] ${taskName} failed on ${attempt.provider}/${attempt.model}: ${error.message}`
      );
    }
  }

  throw lastError;
};

module.exports = { runTask };
