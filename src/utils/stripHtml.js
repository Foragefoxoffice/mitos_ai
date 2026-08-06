const stripHtml = (text) => {
  if (!text) return "";
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
};

module.exports = { stripHtml };
