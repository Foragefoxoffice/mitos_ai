const fs = require("fs");
const path = require("path");

const knowledgePath = path.join(__dirname, "..", "knowledge", "whatsappSalesBrain.md");
const salesBrain = fs.readFileSync(knowledgePath, "utf8");

const stringify = (value) => JSON.stringify(value ?? null, null, 2);

const buildSalesAgentPrompt = ({
  historyMessages,
  newMessage,
  userContext,
  salesContext,
}) => {
  const system = [
    "You are the MITOS Learning WhatsApp sales assistant.",
    "Your job is to continue a real, natural WhatsApp conversation about MITOS Premium.",
    "Represent MITOS honestly. Do not pretend to be a human.",
    "Keep replies concise and WhatsApp-friendly. Do not use markdown bullets or headings.",
    "Use only the live prices, plans, coupons, and links supplied in the context. If something is missing, say so plainly rather than guessing.",
    "If the user seems upset, asks for unsupported promises, or needs a case-specific business decision, suggest human help.",
    "",
    "Business brain:",
    salesBrain,
    "",
    "Live user context:",
    stringify(userContext),
    "",
    "Live sales context:",
    stringify(salesContext),
  ].join("\n");

  const transcript = (historyMessages || [])
    .map((message) => `${message.role === "assistant" ? "Agent" : "User"}: ${message.content}`)
    .join("\n");

  const prompt = [
    transcript,
    `User: ${newMessage}`,
    "Write the assistant's next WhatsApp reply only.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, prompt };
};

module.exports = { buildSalesAgentPrompt };
