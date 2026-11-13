// Finding questions by what people remember about them: the variable name (Question ID), the wording,
// or the question type ("multiple select"). Best matches first.
import { isBlock, isEndBlock, itemLabel, stripHtml, type Question, type StudySpec } from '../core';

export interface QuestionHit {
  surveyName: string;
  surveyLabel: string;
  itemId: string;
  questionId: string;
  text: string;
  type: string;
  block: boolean;
}

/** Every question and block in the study, in survey order. */
export function allQuestions(spec: StudySpec): QuestionHit[] {
  return spec.surveys.flatMap((s) =>
    (s.questions ?? [])
      .filter((q) => !isEndBlock(q))
      .map((q: Question) => ({
        surveyName: s['Survey.Name'],
        surveyLabel: s['Survey.LongName'] || s['Survey.Name'],
        itemId: q['Item.ID'],
        questionId: q['Question.ID'],
        text: isBlock(q) ? itemLabel(q) : stripHtml(q['Question.Text'] ?? ''),
        type: isBlock(q) ? 'Block' : (q['Question.Type.Display.Name'] ?? ''),
        block: isBlock(q),
      })),
  );
}

/**
 * Score a hit for a query: ID matches beat wording, which beats type; earlier and whole-word matches
 * beat later ones. 0 means no match. Every word of the query must match somewhere.
 */
export function scoreHit(h: QuestionHit, query: string): number {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const id = h.questionId.toLowerCase();
  const text = h.text.toLowerCase();
  const type = h.type.toLowerCase();
  const whole = query.toLowerCase().trim();
  let score = 0;
  if (id === whole) score += 1000;
  else if (id.startsWith(whole)) score += 600;
  else if (type === whole) score += 300;
  for (const w of words) {
    let best = 0;
    if (id.startsWith(w)) best = Math.max(best, 200);
    else if (id.includes(w)) best = Math.max(best, 120);
    const ti = text.indexOf(w);
    if (ti >= 0) best = Math.max(best, (/\b/.test(text[ti - 1] ?? ' ') && !/\w/.test(text[ti - 1] ?? ' ') ? 90 : 60) - Math.min(30, ti / 10));
    if (type.includes(w)) best = Math.max(best, 70);
    if (h.surveyLabel.toLowerCase().includes(w) || h.surveyName.toLowerCase().includes(w)) best = Math.max(best, 20);
    if (!best) return 0;
    score += best;
  }
  return score;
}

export function searchQuestions(hits: QuestionHit[], query: string, limit = 12): QuestionHit[] {
  if (!query.trim()) return hits.slice(0, limit);
  return hits
    .map((h, i) => ({ h, i, s: scoreHit(h, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.h);
}
