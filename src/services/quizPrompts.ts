/**
 * Quiz generation prompts for Boom-Match (Mnemonic).
 *
 * All prompts are designed to be general, conceptual, and technical.
 * They strictly prohibit any meta-activity questions (e.g. counting files, timing windows)
 * and enforce self-contained questions referencing industry standards/concepts.
 */

const SHARED_PROHIBITION_RULES = [
  "STRICT PROHIBITION: You must NEVER generate questions about the user's activity logs, click streams, window counts, or telemetry.",
  "Never ask questions like: 'How many files did you edit?', 'Which app did you open first?', 'How many minutes did you spend on X?', or 'Which website did you visit?'.",
  "Never use indexical or self-referential terms referring to the current session or window. Banned terms include: 'this session', 'the session', 'this window', 'the window', 'this segment', 'the segment', 'active window', 'current window', 'provided window', 'observed session', 'what you did', 'you edited', 'you reviewed', 'you viewed'.",
  "The player will play this quiz in the future and has no memory of the specific capture window. Therefore, all questions must be 100% self-contained and read like standard general technical interview or textbook questions.",
].join(" ");

const CONCEPTUAL_TOPIC_RULES = [
  "TOPICAL GROUNDING: Use the provided activity segments ONLY as clues to discover the technical topics, programming languages, libraries, APIs, or system architectures the user is working on.",
  "Once you identify the topic (e.g. SQL, React, Node.js, speech recognition, OAuth), generate standard conceptual questions about that topic (e.g., standard definitions, framework behaviors, API designs, default settings, security rules).",
  "If the user is working on database integration, ask about ACID properties, transaction isolation levels, indexing, or connection pooling.",
  "If the user is working on UI rendering, ask about virtual DOM, rendering performance, layout models, or state synchronization.",
].join(" ");

/**
 * System prompt for basic MCQ quizzes.
 */
export function buildSystemPrompt(): string {
  return [
    "You generate short multiple-choice memory-recall quizzes (MCQs) from grouped desktop activity segments.",
    "Read the activity segments and produce a quiz_ready result in JSON. Be cooperative and avoid blocking.",
    "Even if the activity is brief or general, you should still generate questions based on the available information.",
    SHARED_PROHIBITION_RULES,
    CONCEPTUAL_TOPIC_RULES,
    "Each question must include: question, a list of 4 distinct multiple-choice 'options', the correct 'answer' (which must be exactly equal to one of the options), and an array of 'sourceSegmentIds' (segment IDs from the input) it depends on.",
    "Do NOT return any event IDs or 'sourceEventIds' in the output. Keep the output extremely compact.",
    "Only return blocked status if there is absolutely no activity context (i.e. input segments list is empty).",
    "Return only valid JSON.",
  ].join(" ");
}

/**
 * User prompt for basic MCQ quizzes.
 */
export function buildUserPrompt(segmentsJson: string): string {
  return [
    "Return a JSON object with keys: status, reason, questions.",
    'status must be "quiz_ready" as long as there is at least one segment present.',
    "Even if user activity is brief or general, do not block. Try your best to generate 3 multiple-choice questions.",
    "Favor questions that are meaningful, conceptual, and easy to answer using technical knowledge of the observed topics.",
    SHARED_PROHIBITION_RULES,
    "Ensure questions do not mention specific files, apps, window names, or activity counts.",
    "Segments:",
    segmentsJson,
  ].join("\n");
}

/**
 * System prompt for competition rounds with multiple question formats.
 */
export function buildCompetitionRoundSystemPrompt(
  questionCount: number,
): string {
  return [
    "You generate personalized competition rounds from grouped desktop activity segments.",
    `Return exactly ${questionCount} questions whenever there is at least one usable segment.`,
    "Use only these question types: multiple_choice, true_false, odd_one_out, estimate_slider, order_sequence, type_answer, match_pairs.",
    "Choose the question type that best fits the available evidence for each question. Never place the same question type back-to-back.",
    SHARED_PROHIBITION_RULES,
    CONCEPTUAL_TOPIC_RULES,
    "STRICT RULE for estimate_slider: All estimate_slider questions MUST ask about standard industry technical constants, specifications, defaults, or values related to the observed topics (e.g. standard PostgreSQL port, standard HTTP secure port, standard CD audio sample rate in Hz, standard TTL, common network timeouts). Never ask about user-specific activity metrics (e.g., minutes spent, file counts).",
    "STRICT RULE for estimate_slider fallback: If the observed topics lack logical numeric constants or standard technical specifications to ask about, do NOT generate an 'estimate_slider' question. Fall back to multiple_choice, true_false, or other conceptual question types instead. Never force a slider question by asking about log telemetry.",
    "Each question must include questionType, prompt, sourceSegmentIds, and the fields required by that question type.",
    "For multiple_choice and odd_one_out: include options and answer. The correct answer must be one of the options.",
    'For true_false: include answer as exactly "True" or "False", and options may be omitted.',
    "For type_answer: include answer and acceptableAnswers (short strings that should count as correct).",
    "For estimate_slider: include minValue, maxValue, correctValue, tolerance, and optionally unitLabel or step.",
    "For order_sequence: include items and correctOrder, both with the same entries in different order.",
    "For match_pairs: include leftItems, rightItems, and correctPairs. Use 3 or 4 clear pairs grounded in the evidence.",
    "Keep questions grounded in the observed activities, topics, entities, tools, files, or summaries from the provided segments.",
    "Return only valid compact JSON with keys: title, intro, estimatedMinutes, questions.",
  ].join(" ");
}

/**
 * User prompt for competition rounds with multiple question formats.
 */
export function buildCompetitionRoundUserPrompt(payload: {
  competitionMode: string;
  competitionName: string;
  questionCount: number;
  questionWindowStartAt: string;
  questionWindowEndAt: string;
  segmentsJson: string;
}): string {
  return [
    `Competition mode: ${payload.competitionMode}`,
    `Competition name: ${payload.competitionName}`,
    `Target question count: ${payload.questionCount}`,
    `Source window start: ${payload.questionWindowStartAt}`,
    `Source window end: ${payload.questionWindowEndAt}`,
    "Generate a compact round intro and exactly the requested number of varied questions.",
    "Questions should feel like a fair recall round based on the supplied segment window.",
    "Let the evidence drive which question type fits best for each question.",
    "Prioritize quality and conceptual answerability over literal detail extraction.",
    SHARED_PROHIBITION_RULES,
    "Ensure questions do not mention specific files, apps, window names, or activity counts.",
    "For estimate_slider, only ask about standard specifications or technical constants. If no constants fit, use multiple_choice or true_false instead.",
    "Strict rule: do not place the same question type back-to-back.",
    "Segments:",
    payload.segmentsJson,
  ].join("\n");
}
