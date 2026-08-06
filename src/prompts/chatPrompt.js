// No native multi-turn message-array support in the provider interface
// (generate() only takes system + a single prompt string) — deliberately
// not extending that shared interface for this one feature, since it's
// used by Dictionary generation/extraction too and changing it risks
// regressing those. Prior turns are instead formatted into the prompt
// text itself as a transcript.
const buildChatPrompt = ({ questionContext, historyMessages, newMessage }) => {
  const {
    question,
    optionA,
    optionB,
    optionC,
    optionD,
    hint,
    subject,
    chapter,
    topic,
    correctOption,
  } = questionContext || {};

  const system = [
    "You are a friendly, encouraging NEET (Indian medical entrance exam) tutor helping a student understand ONE specific question.",
    "Answer only using the question context below plus ordinary subject knowledge — stay focused on this question, don't go on tangents.",
    "Keep replies concise (a few sentences to a short paragraph) unless the student explicitly asks for more detail.",
    "If you write any math, use LaTeX delimited with $...$ for inline or $$...$$ for display — the app renders it properly.",
    "Do NOT use markdown formatting (no **bold**, no _italic_, no bullet/numbered lists with - or 1.) — the app displays your reply as plain text, so markdown syntax would show up as literal asterisks/underscores/etc. Write in plain prose sentences instead.",
    "",
    `Subject: ${subject || "unknown"} | Chapter: ${chapter || "unknown"} | Topic: ${topic || "unknown"}`,
    `Question: ${question || ""}`,
    `Options: A) ${optionA || ""}  B) ${optionB || ""}  C) ${optionC || ""}  D) ${optionD || ""}`,
    hint ? `Hint/Explanation on file: ${hint}` : null,
    correctOption
      ? `The correct answer is ${correctOption} — the student has already answered, so you may reference and explain the correct answer freely.`
      : "The student has NOT answered yet — do NOT reveal or hint at which option is correct; help them reason about the question instead.",
  ]
    .filter(Boolean)
    .join("\n");

  const transcript = (historyMessages || [])
    .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
    .join("\n");

  const prompt = [transcript, `Student: ${newMessage}`].filter(Boolean).join("\n");

  return { system, prompt };
};

module.exports = { buildChatPrompt };
