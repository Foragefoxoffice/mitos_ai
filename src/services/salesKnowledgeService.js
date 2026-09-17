const fs = require("fs");
const path = require("path");
const prisma = require("../utils/prismaClient");

const DEFAULT_CONTENT_PATH = path.join(__dirname, "..", "knowledge", "whatsappSalesBrain.md");
const KNOWLEDGE_ROW_ID = 1;

const getSalesKnowledge = async () => {
  const row = await prisma.saleknowledge.findUnique({ where: { id: KNOWLEDGE_ROW_ID } });
  if (row) return row.content;
  return fs.readFileSync(DEFAULT_CONTENT_PATH, "utf8");
};

const updateSalesKnowledge = async (content) => {
  const row = await prisma.saleknowledge.upsert({
    where: { id: KNOWLEDGE_ROW_ID },
    update: { content },
    create: { id: KNOWLEDGE_ROW_ID, content },
  });
  return row.content;
};

module.exports = { getSalesKnowledge, updateSalesKnowledge };
