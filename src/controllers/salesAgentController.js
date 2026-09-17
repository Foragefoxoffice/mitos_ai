const { generateSalesReply } = require("../services/salesAgentService");
const { getSalesKnowledge, updateSalesKnowledge } = require("../services/salesKnowledgeService");
const { listRules, addRule, deleteRule } = require("../services/salesRulesService");

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

const getKnowledge = async (req, res) => {
  try {
    const content = await getSalesKnowledge();
    res.json({ content });
  } catch (error) {
    console.error("[salesAgentController] getKnowledge failed:", error);
    res.status(500).json({ message: "Failed to load sales knowledge" });
  }
};

const updateKnowledge = async (req, res) => {
  const { content } = req.body || {};
  if (typeof content !== "string" || !content.trim()) {
    return res.status(400).json({ message: "content is required" });
  }
  try {
    const updated = await updateSalesKnowledge(content);
    res.json({ content: updated });
  } catch (error) {
    console.error("[salesAgentController] updateKnowledge failed:", error);
    res.status(500).json({ message: "Failed to update sales knowledge" });
  }
};

const getRules = async (req, res) => {
  try {
    const rules = await listRules();
    res.json({ rules });
  } catch (error) {
    console.error("[salesAgentController] getRules failed:", error);
    res.status(500).json({ message: "Failed to load rules" });
  }
};

const createRule = async (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ message: "text is required" });
  }
  try {
    const rule = await addRule(text.trim());
    res.json({ rule });
  } catch (error) {
    console.error("[salesAgentController] createRule failed:", error);
    res.status(500).json({ message: "Failed to create rule" });
  }
};

const removeRule = async (req, res) => {
  try {
    await deleteRule(req.params.id);
    res.json({ deleted: true });
  } catch (error) {
    console.error("[salesAgentController] removeRule failed:", error);
    res.status(500).json({ message: "Failed to delete rule" });
  }
};

module.exports = { postReply, getKnowledge, updateKnowledge, getRules, createRule, removeRule };
