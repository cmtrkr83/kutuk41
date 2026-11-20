import assert from "node:assert/strict";

import {
  flattenSubjectAnswers,
  isCompleteBookletAnswers,
  normalizeBookletAnswers,
  normalizeAnswerLetters,
  pickBookletAnswers,
  subjectRanges,
  subjectsFromAnswers,
  type SubjectSpec,
} from "../client/src/lib/optic-evaluation";

const subjects: SubjectSpec[] = [
  { subject: "Türkçe", questionCount: 2, optionCount: 4 },
  { subject: "Matematik", questionCount: 1, optionCount: 4 },
];

assert.deepEqual(normalizeBookletAnswers({ Türkçe: ["A", "B"], Matematik: ["C"] }), {
  A: { Türkçe: ["A", "B"], Matematik: ["C"] },
});

const multi = { A: { Türkçe: ["A", "B"], Matematik: ["C"] }, B: { Türkçe: ["D", "C"], Matematik: ["B"] } };
assert.deepEqual(normalizeBookletAnswers(multi), multi);
assert.deepEqual(pickBookletAnswers(multi, "B"), multi.B);
assert.deepEqual(pickBookletAnswers(multi, ""), null);
assert.deepEqual(pickBookletAnswers({ A: multi.A }, "B"), multi.A);

assert.deepEqual(flattenSubjectAnswers(subjects, multi.B), ["D", "C", "B"]);
assert.deepEqual(subjectRanges(subjects), [
  { subject: "Türkçe", start: 0, end: 2 },
  { subject: "Matematik", start: 2, end: 3 },
]);

assert.equal(isCompleteBookletAnswers(subjects, multi.A), true);
assert.equal(isCompleteBookletAnswers(subjects, { Türkçe: ["A"] }), false);
assert.equal(isCompleteBookletAnswers(subjects, undefined), false);

assert.deepEqual(subjectsFromAnswers({ Türkçe: ["A", "B"], Matematik: ["C"] }, 4), subjects);

assert.equal(normalizeAnswerLetters("abxcd", 3, 4), "ABC");
assert.equal(normalizeAnswerLetters("abcde", 2, 4), "AB");

console.log("optic-evaluation helpers: OK");
