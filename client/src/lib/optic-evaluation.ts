export interface SubjectSpec {
  subject: string;
  questionCount: number;
  optionCount: number;
}

export type BookletAnswers = Record<string, Record<string, string[]>>;

export const BOOKLET_OPTIONS = ["A", "B", "C", "D"];
export const DEFAULT_BOOKLET = "A";
export const FLAT_SUBJECT = "Tüm Sorular";

export function isMultiBookletAnswers(value: unknown): value is BookletAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const values = Object.values(value as Record<string, unknown>);
  return (
    values.length > 0 &&
    values.every((entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
  );
}

export function normalizeBookletAnswers(value: unknown): BookletAnswers {
  if (isMultiBookletAnswers(value)) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { [DEFAULT_BOOKLET]: value as Record<string, string[]> };
  }
  return {};
}

export function emptyBookletDraft(
  booklets: string[],
  subjects: SubjectSpec[],
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    booklets.map((booklet) => [booklet, Object.fromEntries(subjects.map((spec) => [spec.subject, ""]))]),
  );
}

export function flattenSubjectAnswers(
  subjects: SubjectSpec[],
  answers: Record<string, string[]> | undefined,
): string[] {
  return subjects.flatMap((spec) =>
    Array.from({ length: spec.questionCount }, (_, index) => answers?.[spec.subject]?.[index] ?? ""),
  );
}

export function subjectRanges(
  subjects: SubjectSpec[],
): Array<{ subject: string; start: number; end: number }> {
  let offset = 0;
  return subjects.map((spec) => {
    const start = offset;
    offset += spec.questionCount;
    return { subject: spec.subject, start, end: offset };
  });
}

export function isCompleteBookletAnswers(
  subjects: SubjectSpec[],
  answers: Record<string, string[]> | undefined,
): boolean {
  if (!answers || subjects.length === 0) return false;
  return subjects.every((spec) => (answers[spec.subject] ?? []).length === spec.questionCount);
}

export function pickBookletAnswers(
  answers: BookletAnswers,
  booklet: string,
): Record<string, string[]> | null {
  const normalized = booklet.trim().toUpperCase();
  const direct = answers[normalized];
  if (direct) return direct;
  const keys = Object.keys(answers);
  return keys.length === 1 ? answers[keys[0]] : null;
}

export function subjectsFromAnswers(
  answers: Record<string, string[]> | undefined,
  optionCount = 5,
): SubjectSpec[] {
  if (!answers) return [];
  return Object.entries(answers)
    .filter(([, values]) => Array.isArray(values))
    .map(([subject, values]) => ({ subject, questionCount: values.length, optionCount }));
}

export function mergeSubjectSpecs(base: SubjectSpec[], extra: SubjectSpec[]): SubjectSpec[] {
  const merged = new Map(base.map((spec) => [spec.subject, spec]));
  for (const spec of extra) {
    const current = merged.get(spec.subject);
    merged.set(
      spec.subject,
      current
        ? {
            ...current,
            questionCount: Math.max(current.questionCount, spec.questionCount),
            optionCount: Math.max(current.optionCount, spec.optionCount),
          }
        : spec,
    );
  }
  return Array.from(merged.values());
}

export function normalizeAnswerLetters(
  value: string,
  questionCount: number,
  optionCount: number,
): string {
  const allowed = new Set(Array.from({ length: optionCount }, (_, index) => String.fromCharCode(65 + index)));
  return Array.from(value.toUpperCase())
    .filter((letter) => allowed.has(letter))
    .slice(0, questionCount)
    .join("");
}

export function optionLetters(count: number): string[] {
  return Array.from({ length: count }, (_, index) => String.fromCharCode(65 + index));
}
