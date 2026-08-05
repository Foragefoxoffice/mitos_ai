const providers = require("../providers");
const modelConfig = require("./modelConfig");
const logger = require("../utils/logger");

// Runs a task through its primary model, falling back to a secondary model
// if the primary provider errors (rate limit, outage, bad response). Task
// names match the AI Router section of
// docs/MITOS_AI_Platform_Implementation_Plan_REVISED.md.
const runTask = async (taskName, { system, prompt, maxTokens, temperature, jsonMode } = {}) => {
  const route = modelConfig[taskName];
  if (!route) {
    throw new Error(`Unknown AI task: ${taskName}`);
  }

  const attempts = [route.primary, route.fallback];
  let lastError;

  for (const attempt of attempts) {
    const provider = providers[attempt.provider];
    if (!provider) {
      throw new Error(`Unknown provider: ${attempt.provider}`);
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
