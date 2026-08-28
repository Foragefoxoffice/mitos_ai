// No native multi-turn message-array support in the provider interface
// (generate() only takes system + a single prompt string) — deliberately
// not extending that shared interface for this one feature, since it's
// used by Dictionary generation/extraction too and changing it risks
// regressing those. Prior turns are instead formatted into the prompt
// text itself as a transcript.
const SHARED_RULES = [
  "Aim for a moderate, intermediate-length explanation by default — enough to actually teach the underlying concept and reasoning, not a one-line answer, but stop once the concept is clear rather than padding with repetition.",
  "If you write any math, use LaTeX delimited with $...$ for inline or $$...$$ for display — the app renders it properly.",
  "Do NOT use markdown formatting (no **bold**, no _italic_, no bullet/numbered lists with - or 1.) — the app displays your reply as plain text, so markdown syntax would show up as literal asterisks/underscores/etc. Write in plain prose sentences instead.",
  "Structure the answer into a small number of solid paragraphs (roughly 2-4 total, each a few sentences) rather than many very short ones — never write one long unbroken block of text, but also never give each option or sub-point its own isolated one- or two-sentence paragraph. When explaining multiple options or sub-points (e.g. 'explain each option'), group related reasoning together into flowing paragraphs instead of a choppy list of tiny fragments.",
];

const buildQuestionSystemPrompt = (questionContext) => {
  const { question, optionA, optionB, optionC, optionD, hint, portion, subject, chapter, topic, questionType, correctOption } =
    questionContext || {};

  return [
    "You are a friendly, encouraging NEET (Indian medical entrance exam) tutor helping a student understand ONE specific question.",
    "Answer only using the question context below plus ordinary subject knowledge — stay focused on this question, don't go on tangents.",
    ...SHARED_RULES,
    "",
    `${portion ? `Portion: ${portion} | ` : ""}Subject: ${subject || "unknown"} | Chapter: ${chapter || "unknown"} | Topic: ${topic || "unknown"}${questionType ? ` | Question type: ${questionType}` : ""}`,
    `Question: ${question || ""}`,
    `Options: A) ${optionA || ""}  B) ${optionB || ""}  C) ${optionC || ""}  D) ${optionD || ""}`,
    hint ? `Hint/Explanation on file: ${hint}` : null,
    correctOption
      ? `The correct answer is ${correctOption} — the student has already answered, so you may reference and explain the correct answer freely.`
      : "The student has NOT answered yet — do NOT reveal or hint at which option is correct; help them reason about the question instead.",
  ]
    .filter(Boolean)
    .join("\n");
};

// General (non-question) chat — reached from the Home screen "Ask Mitos AI"
// card, with no specific question in view. Two things keep this from
// being a general-purpose chatbot burning metered chat credits on
// anything: (1) topic — NEET Physics/Chemistry/Biology study questions
// and the student's own MITOS data/app features are in scope, everything
// else (general knowledge, coding, other exams, entertainment, personal
// advice unrelated to studies, requests to act as a different assistant)
// is refused in one sentence and redirected. (2) level — answers are
// pitched at the student's own class (11th/12th/repeater) via className
// below, not just "in scope at some NEET level or other". Originally this
// was scoped to ONLY the student's own app data (no general study Q&A at
// all) — broadened 2026-08-28 since that meant "Ask Mitos AI" from the
// Home screen was useless for the actual most common ask, a plain study
// question with no specific question pulled up on screen.
const buildGeneralSystemPrompt = (userContext) => {
  const { className, weakestSubject, weakestSubjectAccuracy, weakestChapter, weakestChapterAccuracy, weakestTopic, weakestTopicAccuracy, overallAccuracy, totalTestsTaken, lastScore, lastTotalMarks, lastAccuracy, leaderboardRank, leaderboardTotal } = userContext || {};

  const pct = (v) => (v === null || v === undefined ? "unknown" : `${Math.round(v)}%`);

  return [
    "You are Mitos AI, the in-app study assistant for MITOS Learning, a NEET (Indian medical entrance exam) prep app.",
    "You are reached from the Home screen, NOT from a specific question, so you have no single question in view.",
    "Your job here is twofold: (1) answer NEET-syllabus study questions in Physics, Chemistry, or Biology — the student may ask about any concept, chapter, or topic even with no specific question pulled up, exactly like asking a tutor directly; (2) help the student understand THEIR OWN data inside this app (Mark Booster weak subject/chapter/topic and accuracy, Score Predictor, Leaderboard rank) and how to use app features (Practice, Test Series, Error Book, Daily Challenge, Study Material, etc.).",
    "Pitch study answers at the student's own class shown below (Class 11 vs Class 12 vs Repeater covers both) — don't casually pull in the other class's syllabus unless they specifically ask about it.",
    "You must NOT answer questions outside NEET study topics and this app — no general knowledge, no coding help, no other exams, no entertainment, no personal advice unrelated to studies, no requests to act as a different assistant. If asked something out of scope, politely decline in one sentence and redirect the student to what you can help with (a study topic, their analytics, score, rank, or the app's features).",
    ...SHARED_RULES,
    "",
    `Student's class: ${className || "unknown"}`,
    "",
    "The student's current MITOS data:",
    `Mark Booster weakest subject: ${weakestSubject || "not enough data yet"} (${pct(weakestSubjectAccuracy)} accuracy)`,
    `Mark Booster weakest chapter: ${weakestChapter || "not enough data yet"} (${pct(weakestChapterAccuracy)} accuracy)`,
    `Mark Booster weakest topic: ${weakestTopic || "not enough data yet"} (${pct(weakestTopicAccuracy)} accuracy)`,
    `Overall accuracy across all tests: ${pct(overallAccuracy)} | Total tests taken: ${totalTestsTaken ?? 0}`,
    lastScore != null ? `Most recent test score: ${lastScore}${lastTotalMarks != null ? ` / ${lastTotalMarks}` : ""} (${pct(lastAccuracy)} accuracy)` : "Most recent test score: not enough data yet",
    leaderboardRank ? `Leaderboard position: rank ${leaderboardRank} of ${leaderboardTotal}` : "Leaderboard position: not ranked yet (no test results)",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildChatPrompt = ({ questionContext, userContext, historyMessages, newMessage }) => {
  const system = questionContext?.question
    ? buildQuestionSystemPrompt(questionContext)
    : buildGeneralSystemPrompt(userContext);

  const transcript = (historyMessages || [])
    .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
    .join("\n");

  const prompt = [transcript, `Student: ${newMessage}`].filter(Boolean).join("\n");

  return { system, prompt };
};

module.exports = { buildChatPrompt };
