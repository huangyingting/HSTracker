export const MARKET_ANALYSIS_QUESTION_RUNTIME_PATTERNS = [
  /\bAnalystQuestionId\b/u,
  /\bquestionAnswers\b/u,
  /analyst-question-catalog/u,
  /\b(?:QuestionCatalog|QuestionDispatcher|QuestionRegistry)\b/u,
  /\b(?:answer|dispatch|render)Question\b/u,
  /\banswer\s*\(\s*questionId/u,
  /\bAnswerCard\b/u,
  /\bAQ-\d{2}\b/u,
  /AQ-\$\{/u,
  /\baqId\s*:/u,
  /\bdata-aq(?:-id)?\b/u,
] as const;
