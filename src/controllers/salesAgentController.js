const { generateSalesReply } = require("../services/salesAgentService");

const postReply = async (req, res) => {
  const {
    historyMessages,
    newMessage,
    userContext,
    salesContext,
  } = req.body || {};

  if (!newMessage) {
    return res.status(400).json({ message: "newMessage is required" });
  }

  try {
    const result = await generateSalesReply({
      historyMessages: Array.isArray(historyMessages) ? historyMessages : [],
      newMessage,
      userContext: userContext || null,
      salesContext: salesContext || null,
    });
    res.json(result);
  } catch (error) {
    console.error("[salesAgentController] postReply failed:", error);
    res.status(500).json({ message: "Sales agent is temporarily unavailable. Please try again shortly." });
  }
};

module.exports = { postReply };
