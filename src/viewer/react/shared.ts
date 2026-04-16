import type { BojUserSubmissionRow } from "../../boj/session.js";

export const RESULT_LABEL_CLASS: Record<string, string> = {
  "맞았습니다": "result-ac",
  "출력 형식": "result-pe",
  "틀렸습니다": "result-wa",
  "시간 초과": "result-tle",
  "메모리 초과": "result-mle",
  "출력 초과": "result-ole",
  "런타임 에러": "result-rte",
  "컴파일 에러": "result-ce",
  "채점 불가": "result-del",
};

export const PROFILE_STATS_ORDER = [
  "등수",
  "맞은 문제",
  "맞았지만 만점을 받지 못한 문제",
  "시도했지만 맞지 못한 문제",
  "제출",
  "만든 문제",
  "문제를 검수",
  "맞았습니다",
  "출력 형식",
  "틀렸습니다",
  "시간 초과",
  "메모리 초과",
  "출력 초과",
  "런타임 에러",
  "컴파일 에러",
  "학교/회사",
  "Codeforces",
  "Atcoder",
] as const;

export const SUBMISSION_ROW_INDEX = {
  submissionId: 0,
  problemId: 1,
  problemTitle: 2,
  result: 3,
  resultClass: 4,
  memoryKb: 5,
  timeMs: 6,
  language: 7,
  codeLength: 8,
  submittedAt: 9,
  submittedAtTimestamp: 10,
} as const;

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

export function formatNullableNumber(value: number | null): string {
  return value === null ? "-" : formatNumber(value);
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatValueWithUnit(value: number | null, unit: string): string {
  if (value === null) {
    return "-";
  }

  return `${formatNumber(value)}${unit}`;
}

export function isExternalLink(link: string): boolean {
  return /^https?:\/\//.test(link);
}

export function getSubmissionRowValue<T>(row: BojUserSubmissionRow, index: number): T {
  return row[index] as T;
}
