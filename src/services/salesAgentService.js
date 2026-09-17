const { runTask } = require("../router/aiRouter");
const { buildSalesAgentPrompt } = require("../prompts/salesAgentPrompt");

const generateSalesReply = async ({
  historyMessages,
  newMessage,
  userContext,
  salesContext,
}) => {
  const { system, prompt } = await buildSalesAgentPrompt({
    historyMessages,
    newMessage,
    userContext,
    salesContext,
  });

  const result = await runTask("salesConversation", {
    system,
    prompt,
    maxTokens: 700,
  });

  return {
    reply: result.text,
    provider: result.provider,
    model: result.model,
    inputTokens: result.inputTokens ?? 0,
    outputTokens: result.outputTokens ?? 0,
    system,
    prompt,
  };
};

module.exports = { generateSalesReply };
