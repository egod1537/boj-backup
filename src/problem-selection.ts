import type { BojUserSnapshot } from "./boj/session.js";
import { ConfigurationError } from "./errors.js";

export interface ProfileProblemSelection {
  problemIds: number[];
  availableProblems: number;
  totalProblems: number;
  selectionSummary: string;
}

export function selectProblemsFromProfile(
  snapshot: BojUserSnapshot,
  options: {
    problemFilter?: string;
    problemLimit?: number;
  } = {},
): ProfileProblemSelection {
  const orderedProblemIds = collectOrderedProblemIds(snapshot);
  const availableProblems = orderedProblemIds.length;
  const allowedProblemIds = parseProblemFilter(options.problemFilter);
  let problemIds = allowedProblemIds
    ? orderedProblemIds.filter((problemId) => allowedProblemIds.has(problemId))
    : [...orderedProblemIds];
  problemIds.sort((left, right) => left - right);

  if (options.problemLimit !== undefined && options.problemLimit !== null) {
    problemIds = problemIds.slice(0, options.problemLimit);
  }

  const summaryParts: string[] = [];
  if (options.problemFilter && options.problemFilter.trim()) {
    summaryParts.push(`문제 번호 ${options.problemFilter.trim()}`);
  }
  if (options.problemLimit !== undefined && options.problemLimit !== null) {
    summaryParts.push(`문제 번호 오름차순 ${options.problemLimit}문제`);
  }

  return {
    problemIds,
    availableProblems,
    totalProblems: problemIds.length,
    selectionSummary: summaryParts.length > 0 ? summaryParts.join(" · ") : "문제 번호 오름차순 전체",
  };
}

function collectOrderedProblemIds(snapshot: BojUserSnapshot): number[] {
  const ordered: number[] = [];
  const seen = new Set<number>();
  const problemLists = [
    snapshot.profile.problemLists.solved.problemIds,
    snapshot.profile.problemLists.partialSolved.problemIds,
    snapshot.profile.problemLists.failed.problemIds,
    snapshot.profile.problemLists.extraSolved.problemIds,
  ];

  for (const problemIds of problemLists) {
    for (const problemId of problemIds) {
      if (seen.has(problemId)) {
        continue;
      }

      seen.add(problemId);
      ordered.push(problemId);
    }
  }

  return ordered;
}

function parseProblemFilter(problemFilter: string | undefined): Set<number> | null {
  const source = problemFilter?.trim();
  if (!source) {
    return null;
  }

  const values = new Set<number>();
  const tokens = source
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number.parseInt(rangeMatch[1], 10);
      const end = Number.parseInt(rangeMatch[2], 10);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
        throw new ConfigurationError(`Invalid problem range: ${token}`);
      }
      if (end - start > 100_000) {
        throw new ConfigurationError(`Problem range is too large: ${token}`);
      }
      for (let problemId = start; problemId <= end; problemId += 1) {
        values.add(problemId);
      }
      continue;
    }

    if (!/^\d+$/.test(token)) {
      throw new ConfigurationError(
        `Invalid problem filter: ${token}. Use 1000,1001-1010 style ranges.`,
      );
    }

    values.add(Number.parseInt(token, 10));
  }

  return values;
}
