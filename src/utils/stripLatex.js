// Removes LaTeX math regions and stray LaTeX commands before text is sent
// for keyword extraction — belt-and-braces on top of the prompt
// instruction, not a replacement for it. Without this, a raw \dfrac{...}
// fragment could get handed straight to the model, which sometimes latched
// onto the command name itself ("dfrac") as if it were a vocabulary word.
const stripLatex = (text) => {
  if (!text) return "";

  return text
    .replace(/\$\$[\s\S]*?\$\$/g, " ") // $$...$$
    .replace(/\$[^$]*\$/g, " ") // $...$
    .replace(/\\\([\s\S]*?\\\)/g, " ") // \(...\)
    .replace(/\\\[[\s\S]*?\\\]/g, " ") // \[...\]
    .replace(/\\[a-zA-Z]+/g, " ") // stray LaTeX commands outside delimiters (\dfrac, \Omega, ...)
    .replace(/\s+/g, " ")
    .trim();
};

module.exports = { stripLatex };
