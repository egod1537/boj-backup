import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  BojSessionClient,
  BOJ_USER_SUBMISSION_COLUMNS,
  type BojProblemMetadataSnapshot,
  type BojProblemMetadataTag,
  type BojRateLimitDelayReason,
  type BojProblemPageSnapshot,
  type BojSubmissionSourceSnapshot,
  type BojUserSubmissionRow,
  type BojUserSubmissionsSnapshot,
} from "./boj/session.js";
import { ConfigurationError, StopRequestedError } from "./errors.js";

const SUBMISSION_ROW_INDEX = {
  submissionId: 0,
  problemId: 1,
  problemTitle: 2,
  language: 7,
  submittedAt: 9,
} as const;

export type ProblemBackupPhase =
  | "init"
  | "skip-existing"
  | "fetch-problem-page"
  | "fetch-problem-metadata"
  | "fetch-submission-sources"
  | "write-problem-files"
  | "problem-complete";

export interface ProblemBackupProgress {
  username: string;
  outputDir: string;
  availableProblems: number;
  totalProblems: number;
  selectionSummary: string;
  knownExistingProblems: number;
  completedProblems: number;
  savedProblems: number;
  skippedProblems: number;
  phase: ProblemBackupPhase;
  currentProblemId: number | null;
  currentProblemTitle: string | null;
  currentProblemDir: string | null;
  currentSubmissionCount: number | null;
  currentSubmissionId: number | null;
  currentSourceIndex: number | null;
  totalSourceFiles: number | null;
  savedSourceFiles: number;
  skippedSourceFiles: number;
  nextDelayMs: number;
  delayReason: BojRateLimitDelayReason;
  backoffAttempt: number;
}

export interface ProblemBackupResult {
  username: string;
  outputDir: string;
  availableProblems: number;
  totalProblems: number;
  selectionSummary: string;
  savedProblems: number;
  skippedProblems: number;
  totalSourceFiles: number;
  savedSourceFiles: number;
  skippedSourceFiles: number;
}

export interface ProblemSourceFileEntry {
  submissionId: number;
  fileName: string;
  language: string;
}

export interface ProblemBackupMeta {
  kind: "boj-problem-backup";
  version: 4;
  username: string;
  problemId: number;
  title: string | null;
  sourceUrl: string;
  fetchedAt: string;
  htmlFile: string;
  submissionsFile: string;
  sourcesDir: string;
  sourceFiles: ProblemSourceFileEntry[];
  submissionCount: number;
  submissionIds: number[];
  latestSubmissionId: number | null;
  latestSubmittedAt: string | null;
  tierLevel: number | null;
  tierLabel: string | null;
  tags: BojProblemMetadataTag[];
  solvedAc: BojProblemMetadataSnapshot | null;
}

export interface ProblemSubmissionHistorySnapshot {
  kind: "boj-problem-submissions";
  version: 1;
  username: string;
  problemId: number;
  title: string | null;
  fetchedAt: string;
  sourceUrl: string;
  totalCount: number;
  columns: typeof BOJ_USER_SUBMISSION_COLUMNS;
  rows: BojUserSubmissionRow[];
}

interface ProblemWorkItem {
  problemId: number;
  title: string | null;
  submissionIds: number[];
  rows: BojUserSubmissionRow[];
}

export interface ProblemSelectionPreview {
  selectedProblemIds: number[];
  availableProblems: number;
  totalProblems: number;
  selectionSummary: string;
}

export async function backupProblemsFromSubmissions(args: {
  client: BojSessionClient;
  inputPath: string;
  outputDir: string;
  overwrite?: boolean;
  problemFilter?: string;
  problemLimit?: number;
  onProgress?: (progress: ProblemBackupProgress) => void;
  shouldStop?: () => boolean;
}): Promise<ProblemBackupResult> {
  const snapshot = await readSubmissionsSnapshot(args.inputPath);
  const authenticatedUsername = await args.client.ensureAuthenticated();
  if (authenticatedUsername !== snapshot.username) {
    throw new ConfigurationError(
      `Submission source backup requires a logged-in BOJ session for ${snapshot.username}, but the current session is ${authenticatedUsername}.`,
    );
  }

  const outputDir = path.resolve(args.outputDir);
  const allWorkItems = buildProblemWorkItems(snapshot);
  const selectedProblems = selectProblemWorkItems(allWorkItems, {
    problemFilter: args.problemFilter,
    problemLimit: args.problemLimit,
  });
  const workItems = selectedProblems.items;
  const availableProblems =
    !args.problemFilter &&
    (args.problemLimit === undefined || args.problemLimit === null) &&
    snapshot.mode === "problem-status" &&
    snapshot.availableProblemCount !== undefined &&
    snapshot.availableProblemCount !== null
      ? snapshot.availableProblemCount
      : selectedProblems.availableProblems;
  const selectionSummary =
    !args.problemFilter &&
    (args.problemLimit === undefined || args.problemLimit === null) &&
    snapshot.mode === "problem-status" &&
    snapshot.selectionSummary
      ? snapshot.selectionSummary
      : selectedProblems.selectionSummary;
  const overwrite = args.overwrite ?? false;
  const existingProblemIds = new Set<number>();

  if (!overwrite) {
    for (const item of workItems) {
      if (await isProblemBackupComplete(outputDir, item.problemId)) {
        existingProblemIds.add(item.problemId);
      }
    }
  }

  let completedProblems = 0;
  let savedProblems = 0;
  let skippedProblems = 0;
  let totalSourceFiles = 0;
  let savedSourceFiles = 0;
  let skippedSourceFiles = 0;
  args.onProgress?.({
    username: snapshot.username,
    outputDir,
    availableProblems,
    totalProblems: workItems.length,
    selectionSummary,
    knownExistingProblems: existingProblemIds.size,
    completedProblems,
    savedProblems,
    skippedProblems,
    phase: "init",
    currentProblemId: null,
    currentProblemTitle: null,
    currentProblemDir: null,
    currentSubmissionCount: null,
    currentSubmissionId: null,
    currentSourceIndex: null,
    totalSourceFiles: null,
    savedSourceFiles,
    skippedSourceFiles,
    nextDelayMs: args.client.getRateLimitSnapshot().nextDelayMs,
    delayReason: args.client.getRateLimitSnapshot().delayReason,
    backoffAttempt: args.client.getRateLimitSnapshot().backoffAttempt,
  });

  for (const item of workItems) {
    throwIfStopRequested(args.shouldStop);
    const problemDir = path.join(outputDir, String(item.problemId));

    if (!overwrite && existingProblemIds.has(item.problemId)) {
      skippedProblems += 1;
      completedProblems += 1;
      const rateLimit = args.client.getRateLimitSnapshot();
      args.onProgress?.({
        username: snapshot.username,
        outputDir,
        availableProblems,
        totalProblems: workItems.length,
        selectionSummary,
        knownExistingProblems: existingProblemIds.size,
        completedProblems,
        savedProblems,
        skippedProblems,
        phase: "skip-existing",
        currentProblemId: item.problemId,
        currentProblemTitle: item.title,
        currentProblemDir: problemDir,
        currentSubmissionCount: item.rows.length,
        currentSubmissionId: null,
        currentSourceIndex: null,
        totalSourceFiles: item.rows.length,
        savedSourceFiles,
        skippedSourceFiles,
        nextDelayMs: rateLimit.nextDelayMs,
        delayReason: rateLimit.delayReason,
        backoffAttempt: rateLimit.backoffAttempt,
      });
      continue;
    }

    const beforePageRateLimit = args.client.getRateLimitSnapshot();
    args.onProgress?.({
      username: snapshot.username,
      outputDir,
      availableProblems,
      totalProblems: workItems.length,
      selectionSummary,
      knownExistingProblems: existingProblemIds.size,
      completedProblems,
      savedProblems,
      skippedProblems,
      phase: "fetch-problem-page",
      currentProblemId: item.problemId,
      currentProblemTitle: item.title,
      currentProblemDir: problemDir,
      currentSubmissionCount: item.rows.length,
      currentSubmissionId: null,
      currentSourceIndex: null,
      totalSourceFiles: item.rows.length,
      savedSourceFiles,
      skippedSourceFiles,
      nextDelayMs: beforePageRateLimit.nextDelayMs,
      delayReason: beforePageRateLimit.delayReason,
      backoffAttempt: beforePageRateLimit.backoffAttempt,
    });
    const page = await args.client.fetchProblemPage(item.problemId);
    throwIfStopRequested(args.shouldStop);

    const beforeMetadataRateLimit = args.client.getRateLimitSnapshot();
    args.onProgress?.({
      username: snapshot.username,
      outputDir,
      availableProblems,
      totalProblems: workItems.length,
      selectionSummary,
      knownExistingProblems: existingProblemIds.size,
      completedProblems,
      savedProblems,
      skippedProblems,
      phase: "fetch-problem-metadata",
      currentProblemId: item.problemId,
      currentProblemTitle: page.title ?? item.title,
      currentProblemDir: problemDir,
      currentSubmissionCount: item.rows.length,
      currentSubmissionId: null,
      currentSourceIndex: null,
      totalSourceFiles: item.rows.length,
      savedSourceFiles,
      skippedSourceFiles,
      nextDelayMs: beforeMetadataRateLimit.nextDelayMs,
      delayReason: beforeMetadataRateLimit.delayReason,
      backoffAttempt: beforeMetadataRateLimit.backoffAttempt,
    });
    const metadata = await args.client.fetchProblemMetadata(item.problemId);
    throwIfStopRequested(args.shouldStop);

    const sourceEntries: ProblemSourceFileEntry[] = [];
    const sourcesDir = path.join(problemDir, "sources");
    await mkdir(sourcesDir, { recursive: true });
    totalSourceFiles += item.rows.length;

    for (let index = 0; index < item.rows.length; index += 1) {
      throwIfStopRequested(args.shouldStop);
      const row = item.rows[index];
      const submissionId = row[SUBMISSION_ROW_INDEX.submissionId];
      const language = row[SUBMISSION_ROW_INDEX.language] ?? "";
      const fileName = buildSubmissionSourceFileName(submissionId, language);
      const sourcePath = path.join(sourcesDir, fileName);
      sourceEntries.push({
        submissionId,
        fileName,
        language,
      });

      const beforeSourceRateLimit = args.client.getRateLimitSnapshot();
      args.onProgress?.({
        username: snapshot.username,
        outputDir,
        availableProblems,
        totalProblems: workItems.length,
        selectionSummary,
        knownExistingProblems: existingProblemIds.size,
        completedProblems,
        savedProblems,
        skippedProblems,
        phase: "fetch-submission-sources",
        currentProblemId: item.problemId,
        currentProblemTitle: page.title ?? item.title,
        currentProblemDir: problemDir,
        currentSubmissionCount: item.rows.length,
        currentSubmissionId: submissionId,
        currentSourceIndex: index + 1,
        totalSourceFiles: item.rows.length,
        savedSourceFiles,
        skippedSourceFiles,
        nextDelayMs: beforeSourceRateLimit.nextDelayMs,
        delayReason: beforeSourceRateLimit.delayReason,
        backoffAttempt: beforeSourceRateLimit.backoffAttempt,
      });

      if (await fileExists(sourcePath)) {
        skippedSourceFiles += 1;
        continue;
      }

      const source = await args.client.fetchSubmissionSource(submissionId);
      await writeTextFile(sourcePath, buildSourceCodeFileContent(source));
      sourceEntries[sourceEntries.length - 1] = {
        submissionId,
        fileName,
        language: source.language || language,
      };
      savedSourceFiles += 1;
      throwIfStopRequested(args.shouldStop);
    }

    const beforeWriteRateLimit = args.client.getRateLimitSnapshot();
    args.onProgress?.({
      username: snapshot.username,
      outputDir,
      availableProblems,
      totalProblems: workItems.length,
      selectionSummary,
      knownExistingProblems: existingProblemIds.size,
      completedProblems,
      savedProblems,
      skippedProblems,
      phase: "write-problem-files",
      currentProblemId: item.problemId,
      currentProblemTitle: page.title ?? item.title,
      currentProblemDir: problemDir,
      currentSubmissionCount: item.rows.length,
      currentSubmissionId: null,
      currentSourceIndex: null,
      totalSourceFiles: item.rows.length,
      savedSourceFiles,
      skippedSourceFiles,
      nextDelayMs: beforeWriteRateLimit.nextDelayMs,
      delayReason: beforeWriteRateLimit.delayReason,
      backoffAttempt: beforeWriteRateLimit.backoffAttempt,
    });
    await writeProblemBackup(
      outputDir,
      snapshot.username,
      item,
      page,
      metadata,
      sourceEntries,
    );

    savedProblems += 1;
    completedProblems += 1;
    const rateLimit = args.client.getRateLimitSnapshot();
    args.onProgress?.({
      username: snapshot.username,
      outputDir,
      availableProblems,
      totalProblems: workItems.length,
      selectionSummary,
      knownExistingProblems: existingProblemIds.size,
      completedProblems,
      savedProblems,
      skippedProblems,
      phase: "problem-complete",
      currentProblemId: item.problemId,
      currentProblemTitle: page.title ?? item.title,
      currentProblemDir: problemDir,
      currentSubmissionCount: item.rows.length,
      currentSubmissionId: null,
      currentSourceIndex: item.rows.length,
      totalSourceFiles: item.rows.length,
      savedSourceFiles,
      skippedSourceFiles,
      nextDelayMs: rateLimit.nextDelayMs,
      delayReason: rateLimit.delayReason,
      backoffAttempt: rateLimit.backoffAttempt,
    });
  }

  return {
    username: snapshot.username,
    outputDir,
    availableProblems,
    totalProblems: workItems.length,
    selectionSummary,
    savedProblems,
    skippedProblems,
    totalSourceFiles,
    savedSourceFiles,
    skippedSourceFiles,
  };
}

async function readSubmissionsSnapshot(inputPath: string): Promise<BojUserSubmissionsSnapshot> {
  const absolutePath = path.resolve(inputPath);
  let raw: string;

  try {
    raw = await readFile(absolutePath, "utf8");
  } catch {
    throw new ConfigurationError(`Could not read submissions JSON: ${absolutePath}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError(`Submissions JSON is not valid JSON: ${absolutePath}`);
  }

  if (!isSubmissionsSnapshot(parsed)) {
    throw new ConfigurationError(
      `Submissions JSON must contain username, columns, and rows: ${absolutePath}`,
    );
  }

  return parsed;
}

function isSubmissionsSnapshot(value: unknown): value is BojUserSubmissionsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const snapshot = value as Partial<BojUserSubmissionsSnapshot>;
  return (
    typeof snapshot.username === "string" &&
    Array.isArray(snapshot.columns) &&
    Array.isArray(snapshot.rows)
  );
}

function buildProblemWorkItems(snapshot: BojUserSubmissionsSnapshot): ProblemWorkItem[] {
  const items = new Map<number, ProblemWorkItem>();

  for (const row of snapshot.rows) {
    appendSubmissionRow(items, row);
  }

  return [...items.values()].sort((left, right) => {
    const leftLatest = getLatestSubmissionId(left);
    const rightLatest = getLatestSubmissionId(right);
    return rightLatest - leftLatest || left.problemId - right.problemId;
  });
}

function appendSubmissionRow(
  items: Map<number, ProblemWorkItem>,
  row: BojUserSubmissionRow,
): void {
  const problemId = row[SUBMISSION_ROW_INDEX.problemId];
  const submissionId = row[SUBMISSION_ROW_INDEX.submissionId];

  if (problemId === null) {
    return;
  }

  const existing = items.get(problemId);
  if (existing) {
    existing.submissionIds.push(submissionId);
    existing.rows.push(row);
    if (!existing.title && row[SUBMISSION_ROW_INDEX.problemTitle]) {
      existing.title = row[SUBMISSION_ROW_INDEX.problemTitle];
    }
    return;
  }

  items.set(problemId, {
    problemId,
    title: row[SUBMISSION_ROW_INDEX.problemTitle],
    submissionIds: [submissionId],
    rows: [row],
  });
}

function selectProblemWorkItems(
  items: ProblemWorkItem[],
  options: {
    problemFilter?: string;
    problemLimit?: number;
  },
): {
  items: ProblemWorkItem[];
  availableProblems: number;
  selectionSummary: string;
} {
  const availableProblems = items.length;
  const allowedProblemIds = parseProblemFilter(options.problemFilter);
  let selected = allowedProblemIds
    ? items.filter((item) => allowedProblemIds.has(item.problemId))
    : [...items];

  if (options.problemLimit !== undefined && options.problemLimit !== null) {
    selected = selected.slice(0, options.problemLimit);
  }

  const summaryParts: string[] = [];
  if (options.problemFilter && options.problemFilter.trim()) {
    summaryParts.push(`문제 번호 ${options.problemFilter.trim()}`);
  }
  if (options.problemLimit !== undefined && options.problemLimit !== null) {
    summaryParts.push(`최근 ${options.problemLimit}문제`);
  }

  return {
    items: selected,
    availableProblems,
    selectionSummary: summaryParts.length > 0 ? summaryParts.join(" · ") : "전체 문제",
  };
}

export function previewProblemSelection(
  snapshot: BojUserSubmissionsSnapshot,
  options: {
    problemFilter?: string;
    problemLimit?: number;
  },
): ProblemSelectionPreview {
  const items = buildProblemWorkItems(snapshot);
  const selected = selectProblemWorkItems(items, options);

  return {
    selectedProblemIds: selected.items.map((item) => item.problemId),
    availableProblems: selected.availableProblems,
    totalProblems: selected.items.length,
    selectionSummary: selected.selectionSummary,
  };
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

async function isProblemBackupComplete(outputDir: string, problemId: number): Promise<boolean> {
  const problemDir = path.join(outputDir, String(problemId));
  const htmlPath = path.join(problemDir, "index.html");
  const metaPath = path.join(problemDir, "meta.json");
  const submissionsPath = path.join(problemDir, "submissions.json");

  if (
    !(await fileExists(htmlPath)) ||
    !(await fileExists(metaPath)) ||
    !(await fileExists(submissionsPath))
  ) {
    return false;
  }

  const meta = await readProblemBackupMeta(metaPath);
  const sourceFiles =
    meta && Array.isArray(meta.sourceFiles)
      ? meta.sourceFiles.filter(
          (value): value is Record<string, unknown> =>
            !!value && typeof value === "object" && typeof value.fileName === "string",
        )
      : [];

  if (
    !meta ||
    meta.kind !== "boj-problem-backup" ||
    meta.version !== 4 ||
    !Array.isArray(meta.tags) ||
    meta.submissionsFile !== "submissions.json" ||
    meta.sourcesDir !== "sources" ||
    !("latestSubmissionId" in meta) ||
    !("latestSubmittedAt" in meta) ||
    !("tierLabel" in meta) ||
    !("solvedAc" in meta) ||
    sourceFiles.length === 0 && Array.isArray(meta.submissionIds) && meta.submissionIds.length > 0
  ) {
    return false;
  }

  for (const sourceFile of sourceFiles) {
    const sourcePath = path.join(problemDir, "sources", String(sourceFile.fileName));
    if (!(await fileExists(sourcePath))) {
      return false;
    }
  }

  return (
    Array.isArray(meta.submissionIds) &&
    sourceFiles.length === meta.submissionIds.length
  );
}

async function writeProblemBackup(
  outputDir: string,
  username: string,
  item: ProblemWorkItem,
  page: BojProblemPageSnapshot,
  metadata: BojProblemMetadataSnapshot | null,
  sourceEntries: ProblemSourceFileEntry[],
): Promise<void> {
  const problemDir = path.join(outputDir, String(item.problemId));
  const htmlPath = path.join(problemDir, "index.html");
  const metaPath = path.join(problemDir, "meta.json");
  const submissionsPath = path.join(problemDir, "submissions.json");
  const sourcesDir = path.join(problemDir, "sources");
  const title = page.title ?? item.title;
  const latestRow = getLatestSubmissionRow(item.rows);
  const submissions: ProblemSubmissionHistorySnapshot = {
    kind: "boj-problem-submissions",
    version: 1,
    username,
    problemId: item.problemId,
    title,
    fetchedAt: page.fetchedAt,
    sourceUrl: buildProblemStatusSourceUrl(page.sourceUrl, username, item.problemId),
    totalCount: item.rows.length,
    columns: BOJ_USER_SUBMISSION_COLUMNS,
    rows: item.rows,
  };

  const meta: ProblemBackupMeta = {
    kind: "boj-problem-backup",
    version: 4,
    username,
    problemId: item.problemId,
    title,
    sourceUrl: page.sourceUrl,
    fetchedAt: page.fetchedAt,
    htmlFile: "index.html",
    submissionsFile: "submissions.json",
    sourcesDir: "sources",
    sourceFiles: sourceEntries,
    submissionCount: item.submissionIds.length,
    submissionIds: item.submissionIds,
    latestSubmissionId: latestRow?.[SUBMISSION_ROW_INDEX.submissionId] ?? null,
    latestSubmittedAt: latestRow?.[SUBMISSION_ROW_INDEX.submittedAt] ?? null,
    tierLevel: metadata?.level ?? null,
    tierLabel: metadata?.tierLabel ?? null,
    tags: metadata?.tags ?? [],
    solvedAc: metadata,
  };

  await mkdir(problemDir, { recursive: true });
  await mkdir(sourcesDir, { recursive: true });
  await writeTextFile(htmlPath, page.html);
  await writeTextFile(submissionsPath, `${JSON.stringify(submissions, null, 2)}\n`);
  await writeTextFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
}

function getLatestSubmissionRow(rows: BojUserSubmissionRow[]): BojUserSubmissionRow | null {
  let latest: BojUserSubmissionRow | null = null;

  for (const row of rows) {
    if (!latest || row[SUBMISSION_ROW_INDEX.submissionId] > latest[SUBMISSION_ROW_INDEX.submissionId]) {
      latest = row;
    }
  }

  return latest;
}

function getLatestSubmissionId(item: ProblemWorkItem): number {
  let latest = 0;

  for (const submissionId of item.submissionIds) {
    if (submissionId > latest) {
      latest = submissionId;
    }
  }

  return latest;
}

function buildProblemStatusSourceUrl(
  problemSourceUrl: string,
  username: string,
  problemId: number,
): string {
  const url = new URL(problemSourceUrl);
  url.pathname = "/status";
  url.searchParams.set("problem_id", String(problemId));
  url.searchParams.set("user_id", username);
  return url.toString();
}

function buildSubmissionSourceFileName(submissionId: number, language: string): string {
  const extension = inferLanguageExtension(language);
  return `${submissionId}.${extension}`;
}

function inferLanguageExtension(language: string): string {
  const normalized = language.toLowerCase();

  if (normalized.includes("c++") || normalized.includes("clang++")) {
    return "cpp";
  }

  if (/^c([11]|\s|$)/.test(normalized) || normalized === "c") {
    return "c";
  }

  if (normalized.includes("pypy") || normalized.includes("python")) {
    return "py";
  }

  if (normalized.includes("java")) {
    return "java";
  }

  if (normalized.includes("kotlin")) {
    return "kt";
  }

  if (normalized.includes("rust")) {
    return "rs";
  }

  if (normalized.includes("go")) {
    return "go";
  }

  if (normalized.includes("c#")) {
    return "cs";
  }

  if (normalized.includes("swift")) {
    return "swift";
  }

  if (normalized.includes("javascript") || normalized.includes("node.js")) {
    return "js";
  }

  if (normalized.includes("typescript")) {
    return "ts";
  }

  if (normalized.includes("php")) {
    return "php";
  }

  if (normalized.includes("ruby")) {
    return "rb";
  }

  if (normalized.includes("scala")) {
    return "scala";
  }

  if (normalized.includes("haskell")) {
    return "hs";
  }

  if (normalized.includes("ocaml")) {
    return "ml";
  }

  if (normalized.includes("f#")) {
    return "fs";
  }

  if (normalized.includes("lua")) {
    return "lua";
  }

  if (normalized.includes("pascal")) {
    return "pas";
  }

  if (normalized.includes("fortran")) {
    return "f90";
  }

  if (normalized.includes("perl")) {
    return "pl";
  }

  if (normalized.includes("bash") || normalized.includes("shell")) {
    return "sh";
  }

  if (normalized === "r" || normalized.startsWith("r ")) {
    return "r";
  }

  return "txt";
}

function buildSourceCodeFileContent(source: BojSubmissionSourceSnapshot): string {
  return source.code;
}

function throwIfStopRequested(shouldStop?: (() => boolean) | undefined): void {
  if (shouldStop?.()) {
    throw new StopRequestedError();
  }
}

async function writeTextFile(filePath: string, value: string): Promise<void> {
  const absolutePath = path.resolve(filePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp-${process.pid}`;
  await writeFile(tempPath, value, "utf8");
  await rm(absolutePath, { force: true });
  await rename(tempPath, absolutePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readProblemBackupMeta(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
