// Models sometimes wrap JSON in a markdown code fence despite being told
// not to — strip it before parsing rather than failing the whole entry.
const parseJsonResponse = (text) => {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  return JSON.parse(cleaned);
};

module.exports = { parseJsonResponse };
