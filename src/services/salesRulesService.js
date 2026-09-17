const prisma = require("../utils/prismaClient");

const listRules = async () => {
  return prisma.salesrule.findMany({ orderBy: { createdAt: "asc" } });
};

const getActiveRuleTexts = async () => {
  const rules = await prisma.salesrule.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { text: true },
  });
  return rules.map((r) => r.text);
};

const addRule = async (text) => {
  return prisma.salesrule.create({ data: { text } });
};

const deleteRule = async (id) => {
  await prisma.salesrule.delete({ where: { id: Number(id) } });
};

module.exports = { listRules, getActiveRuleTexts, addRule, deleteRule };
