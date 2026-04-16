import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  BojSessionClient,
  type BojUserSnapshot,
  type BojUserSubmissionFetchProgress,
  type BojUserSubmissionsCheckpoint,
  type BojUserSubmissionsSnapshot,
} from "./boj/session.js";
import { ConfigurationError, StopRequestedError } from "./errors.js";
import {
  backupProblemsFromSubmissions,
  type ProblemBackupProgress,
  type ProblemBackupResult,
} from "./problem-backup.js";
import { selectProblemsFromProfile } from "./problem-selection.js";

export type BackupSyncPhase = "profile" | "submissions" | "problems";

export interface BackupSyncCheckpoint {
  kind: "boj-sync-checkpoint";
  version: 1;
  mode?: "sync" | "archive";
  username: string;
  requestedHandle: string | null;
  startedAt: string;
  updatedAt: string;
  phase: BackupSyncPhase;
  profilePath: string;
  submissionsPath: string;
  problemsDir: string;
  submissionsCheckpointPath: string;
  submissionLimit?: number | null;
  problemFilter?: string | null;
  problemLimit?: number | null;
}

export interface BackupSyncStageProgress {
  phase: BackupSyncPhase;
  phaseIndex: number;
  totalPhases: number;
  username: string;
  profilePath: string;
  submissionsPath: string;
  problemsDir: string;
  checkpointPath: string;
  submissionsCheckpointPath: string;
}

export interface BackupSyncResult {
  username: string;
  resumed: boolean;
  profilePath: string;
  submissionsPath: string;
  problemsDir: string;
  checkpointPath: string;
  submissionsCheckpointPath: string;
  profile: BojUserSnapshot;
  submissions: BojUserSubmissionsSnapshot;
  problems: ProblemBackupResult;
}

export interface RunBackupSyncArgs {
  client: BojSessionClient;
  handle?: string;
  resolveUsername: () => Promise<string>;
  profilePath: string;
  submissionsPath: string;
  problemsDir: string;
  problemFilter?: string;
  problemLimit?: number;
  checkpointPath?: string;
  submissionsCheckpointPath?: string;
  resume?: boolean;
  overwriteProblems?: boolean;
  shouldStop?: () => boolean;
  onStage?: (progress: BackupSyncStageProgress) => void;
  onLog?: (message: string) => void;
  onSubmissionsProgress?: (progress: BojUserSubmissionFetchProgress) => void;
  onProblemProgress?: (progress: ProblemBackupProgress) => void;
}

export interface RunArchiveSyncArgs {
  client: BojSessionClient;
  handle?: string;
  profilePath: string;
  submissionsPath: string;
  problemsDir: string;
  problemFilter?: string;
  problemLimit?: number;
  checkpointPath?: string;
  submissionsCheckpointPath?: string;
  resume?: boolean;
  overwriteProblems?: boolean;
  shouldStop?: () => boolean;
  onStage?: (progress: BackupSyncStageProgress) => void;
  onLog?: (message: string) => void;
  onSubmissionsProgress?: (progress: BojUserSubmissionFetchProgress) => void;
  onProblemProgress?: (progress: ProblemBackupProgress) => void;
}

export async function runBackupSync(args: RunBackupSyncArgs): Promise<BackupSyncResult> {
  const resume = args.resume !== false;
  const profilePath = path.resolve(args.profilePath);
  const submissionsPath = path.resolve(args.submissionsPath);
  const problemsDir = path.resolve(args.problemsDir);
  const checkpointPath = resolveSyncCheckpointPath(submissionsPath, args.checkpointPath);

  const syncCheckpoint = resume ? await readSyncCheckpoint(checkpointPath) : null;
  const username = args.handle ?? syncCheckpoint?.username ?? (await args.resolveUsername());
  const submissionsCheckpointPath = resolveSubmissionsCheckpointPath(
    username,
    submissionsPath,
    args.submissionsCheckpointPath,
  );

  if (syncCheckpoint) {
    validateSyncCheckpoint(syncCheckpoint, {
      mode: "sync",
      username,
      profilePath,
      submissionsPath,
      problemsDir,
      submissionsCheckpointPath,
    });
    args.onLog?.(
      `전체 동기화 resume: ${formatSyncPhase(syncCheckpoint.phase)} 단계부터 이어서 진행 (${checkpointPath})`,
    );
  }

  throwIfStopRequested(args.shouldStop);

  if (!resume) {
    await removeFileIfExists(checkpointPath);
    await removeFileIfExists(submissionsCheckpointPath);
    args.onLog?.("resume 비활성화: 전체 동기화를 처음부터 다시 시작");
  }

  const startedAt = syncCheckpoint?.startedAt ?? new Date().toISOString();
  const problemFilter = resolveResumeStringOption(
    syncCheckpoint?.problemFilter,
    args.problemFilter,
    "problemFilter",
  );
  const problemLimit = resolveResumeNumberOption(
    syncCheckpoint?.problemLimit,
    args.problemLimit,
    "problemLimit",
  );
  let startPhase = syncCheckpoint?.phase ?? "profile";

  if (startPhase !== "profile" && !(await fileExists(profilePath))) {
    startPhase = "profile";
    args.onLog?.("profile.json 이 없어 프로필 단계부터 다시 진행");
  }

  if (startPhase === "problems" && !(await fileExists(submissionsPath))) {
    startPhase = "submissions";
    args.onLog?.("submissions.json 이 없어 제출 기록 단계부터 다시 진행");
  }

  let profileSnapshot =
    startPhase === "profile" ? null : await readOptionalProfileSnapshot(profilePath);
  if (startPhase !== "profile" && !profileSnapshot) {
    startPhase = "profile";
    args.onLog?.("기존 profile.json 을 읽을 수 없어 프로필 단계부터 다시 진행");
  }

  let submissionsSnapshot =
    startPhase === "problems" ? await readOptionalSubmissionsSnapshot(submissionsPath) : null;
  if (startPhase === "problems" && !submissionsSnapshot) {
    startPhase = "submissions";
    args.onLog?.("기존 submissions.json 을 읽을 수 없어 제출 기록 단계부터 다시 진행");
  }

  const saveSyncCheckpoint = async (phase: BackupSyncPhase) => {
    await writeJsonFile(checkpointPath, {
      kind: "boj-sync-checkpoint",
      version: 1,
      mode: "sync",
      username,
      requestedHandle: args.handle ?? null,
      startedAt,
      updatedAt: new Date().toISOString(),
      phase,
      profilePath,
      submissionsPath,
      problemsDir,
      submissionsCheckpointPath,
      problemFilter: problemFilter ?? null,
      problemLimit: problemLimit ?? null,
    } satisfies BackupSyncCheckpoint);
  };

  if (startPhase === "profile") {
    throwIfStopRequested(args.shouldStop);
    await saveSyncCheckpoint("profile");
    args.onStage?.({
      phase: "profile",
      phaseIndex: 1,
      totalPhases: 3,
      username,
      profilePath,
      submissionsPath,
      problemsDir,
      checkpointPath,
      submissionsCheckpointPath,
    });
    args.onLog?.(`프로필 수집 시작: ${username}`);
    profileSnapshot = await args.client.fetchUserSnapshot(username);
    await writeJsonFile(profilePath, profileSnapshot);
    args.onLog?.(`프로필 JSON 저장 완료: ${profilePath}`);
    startPhase = "submissions";
    throwIfStopRequested(args.shouldStop);
  }

  if (startPhase === "submissions") {
    throwIfStopRequested(args.shouldStop);
    await saveSyncCheckpoint("submissions");
    args.onStage?.({
      phase: "submissions",
      phaseIndex: 2,
      totalPhases: 3,
      username,
      profilePath,
      submissionsPath,
      problemsDir,
      checkpointPath,
      submissionsCheckpointPath,
    });

    const submissionsCheckpoint = resume
      ? await readSubmissionsCheckpoint(submissionsCheckpointPath, username)
      : null;
    if (submissionsCheckpoint) {
      args.onLog?.(
        `제출 기록 resume: ${submissionsCheckpoint.totalCount} rows / ${submissionsCheckpoint.pagesFetched} pages (${submissionsCheckpointPath})`,
      );
    }

    const problemSelection = profileSnapshot
      ? selectProblemsFromProfile(profileSnapshot, {
          problemFilter,
          problemLimit,
        })
      : null;

    if (!problemSelection || problemSelection.problemIds.length === 0) {
      throw new ConfigurationError("No problems selected from profile snapshot.");
    }

    submissionsSnapshot = await args.client.fetchUserSubmissionsForProblems(username, problemSelection.problemIds, {
      availableProblemCount: problemSelection.availableProblems,
      selectionSummary: problemSelection.selectionSummary,
      resumeFrom: submissionsCheckpoint,
      onProgress: args.onSubmissionsProgress,
      shouldStop: args.shouldStop,
      onCheckpoint: async (nextCheckpoint) => {
        await writeJsonFile(submissionsCheckpointPath, nextCheckpoint);
        await saveSyncCheckpoint("submissions");
      },
    });

    await writeJsonFile(submissionsPath, submissionsSnapshot);
    await removeFileIfExists(submissionsCheckpointPath);
    args.onLog?.(`제출 기록 JSON 저장 완료: ${submissionsPath}`);
    startPhase = "problems";
    throwIfStopRequested(args.shouldStop);
  }

  await args.resolveUsername();
  throwIfStopRequested(args.shouldStop);
  await saveSyncCheckpoint("problems");
  args.onStage?.({
    phase: "problems",
    phaseIndex: 3,
    totalPhases: 3,
    username,
    profilePath,
    submissionsPath,
    problemsDir,
    checkpointPath,
    submissionsCheckpointPath,
  });

  const problemResult = await backupProblemsFromSubmissions({
    client: args.client,
    inputPath: submissionsPath,
    outputDir: problemsDir,
    overwrite: args.overwriteProblems,
    onProgress: args.onProblemProgress,
    shouldStop: args.shouldStop,
  });

  await removeFileIfExists(checkpointPath);
  args.onLog?.(
    `문제 백업 완료: saved ${problemResult.savedProblems}, existing ${problemResult.skippedProblems}`,
  );

  if (!profileSnapshot) {
    throw new ConfigurationError("Profile snapshot is missing after sync completed.");
  }

  if (!submissionsSnapshot) {
    throw new ConfigurationError("Submissions snapshot is missing after sync completed.");
  }

  return {
    username,
    resumed: syncCheckpoint !== null,
    profilePath,
    submissionsPath,
    problemsDir,
    checkpointPath,
    submissionsCheckpointPath,
    profile: profileSnapshot,
    submissions: submissionsSnapshot,
    problems: problemResult,
  };
}

export async function runArchiveSync(args: RunArchiveSyncArgs): Promise<BackupSyncResult> {
  const resume = args.resume !== false;
  const profilePath = path.resolve(args.profilePath);
  const submissionsPath = path.resolve(args.submissionsPath);
  const problemsDir = path.resolve(args.problemsDir);
  const checkpointPath = resolveSyncCheckpointPath(submissionsPath, args.checkpointPath);

  const profileSnapshot = await readOptionalProfileSnapshot(profilePath);
  if (!profileSnapshot) {
    throw new ConfigurationError(
      `Profile snapshot is required before archive backup: ${profilePath}. Run profile crawl first.`,
    );
  }

  const profileUsername = profileSnapshot.profile.username || profileSnapshot.username;
  if (!profileUsername) {
    throw new ConfigurationError(`Profile snapshot does not contain a username: ${profilePath}`);
  }

  const username = args.handle ?? profileUsername;
  if (args.handle && args.handle !== profileUsername) {
    throw new ConfigurationError(
      `Profile snapshot belongs to ${profileUsername}, not ${args.handle}: ${profilePath}`,
    );
  }

  const submissionsCheckpointPath = resolveSubmissionsCheckpointPath(
    username,
    submissionsPath,
    args.submissionsCheckpointPath,
  );
  const syncCheckpoint = resume ? await readSyncCheckpoint(checkpointPath) : null;

  if (syncCheckpoint) {
    validateSyncCheckpoint(syncCheckpoint, {
      mode: "archive",
      username,
      profilePath,
      submissionsPath,
      problemsDir,
      submissionsCheckpointPath,
    });
    args.onLog?.(
      `문제+제출코드 resume: ${formatSyncPhase(syncCheckpoint.phase)} 단계부터 이어서 진행 (${checkpointPath})`,
    );
  }

  throwIfStopRequested(args.shouldStop);

  if (!resume) {
    await removeFileIfExists(checkpointPath);
    await removeFileIfExists(submissionsCheckpointPath);
    args.onLog?.("resume 비활성화: 문제+제출코드 백업을 처음부터 다시 시작");
  }

  const startedAt = syncCheckpoint?.startedAt ?? new Date().toISOString();
  const problemFilter = resolveResumeStringOption(
    syncCheckpoint?.problemFilter,
    args.problemFilter,
    "problemFilter",
  );
  const problemLimit = resolveResumeNumberOption(
    syncCheckpoint?.problemLimit,
    args.problemLimit,
    "problemLimit",
  );
  let startPhase: BackupSyncPhase = syncCheckpoint?.phase ?? "submissions";
  if (startPhase === "profile") {
    startPhase = "submissions";
    args.onLog?.("profile 단계는 이미 선행 작업이므로 제출 기록 단계부터 진행");
  }

  if (startPhase === "problems" && !(await fileExists(submissionsPath))) {
    startPhase = "submissions";
    args.onLog?.("submissions.json 이 없어 제출 기록 단계부터 다시 진행");
  }

  let submissionsSnapshot =
    startPhase === "problems" ? await readOptionalSubmissionsSnapshot(submissionsPath) : null;
  if (startPhase === "problems" && !submissionsSnapshot) {
    startPhase = "submissions";
    args.onLog?.("기존 submissions.json 을 읽을 수 없어 제출 기록 단계부터 다시 진행");
  }

  const saveSyncCheckpoint = async (phase: BackupSyncPhase) => {
    await writeJsonFile(checkpointPath, {
      kind: "boj-sync-checkpoint",
      version: 1,
      mode: "archive",
      username,
      requestedHandle: args.handle ?? null,
      startedAt,
      updatedAt: new Date().toISOString(),
      phase,
      profilePath,
      submissionsPath,
      problemsDir,
      submissionsCheckpointPath,
      problemFilter: problemFilter ?? null,
      problemLimit: problemLimit ?? null,
    } satisfies BackupSyncCheckpoint);
  };

  if (startPhase === "submissions") {
    throwIfStopRequested(args.shouldStop);
    await saveSyncCheckpoint("submissions");
    args.onStage?.({
      phase: "submissions",
      phaseIndex: 1,
      totalPhases: 2,
      username,
      profilePath,
      submissionsPath,
      problemsDir,
      checkpointPath,
      submissionsCheckpointPath,
    });

    const submissionsCheckpoint = resume
      ? await readSubmissionsCheckpoint(submissionsCheckpointPath, username)
      : null;
    if (submissionsCheckpoint) {
      args.onLog?.(
        `제출 기록 resume: ${submissionsCheckpoint.totalCount} rows / ${submissionsCheckpoint.pagesFetched} pages (${submissionsCheckpointPath})`,
      );
    }

    const problemSelection = selectProblemsFromProfile(profileSnapshot, {
      problemFilter,
      problemLimit,
    });

    if (problemSelection.problemIds.length === 0) {
      throw new ConfigurationError("No problems selected from profile snapshot.");
    }

    submissionsSnapshot = await args.client.fetchUserSubmissionsForProblems(username, problemSelection.problemIds, {
      availableProblemCount: problemSelection.availableProblems,
      selectionSummary: problemSelection.selectionSummary,
      resumeFrom: submissionsCheckpoint,
      onProgress: args.onSubmissionsProgress,
      shouldStop: args.shouldStop,
      onCheckpoint: async (nextCheckpoint) => {
        await writeJsonFile(submissionsCheckpointPath, nextCheckpoint);
        await saveSyncCheckpoint("submissions");
      },
    });

    await writeJsonFile(submissionsPath, submissionsSnapshot);
    await removeFileIfExists(submissionsCheckpointPath);
    args.onLog?.(`제출 기록 JSON 저장 완료: ${submissionsPath}`);
    startPhase = "problems";
    throwIfStopRequested(args.shouldStop);
  }

  throwIfStopRequested(args.shouldStop);
  await saveSyncCheckpoint("problems");
  args.onStage?.({
    phase: "problems",
    phaseIndex: 2,
    totalPhases: 2,
    username,
    profilePath,
    submissionsPath,
    problemsDir,
    checkpointPath,
    submissionsCheckpointPath,
  });

  const problemResult = await backupProblemsFromSubmissions({
    client: args.client,
    inputPath: submissionsPath,
    outputDir: problemsDir,
    overwrite: args.overwriteProblems,
    onProgress: args.onProblemProgress,
    shouldStop: args.shouldStop,
  });

  await removeFileIfExists(checkpointPath);
  args.onLog?.(
    `문제 백업 완료: saved ${problemResult.savedProblems}, existing ${problemResult.skippedProblems}`,
  );

  if (!submissionsSnapshot) {
    throw new ConfigurationError("Submissions snapshot is missing after archive completed.");
  }

  return {
    username,
    resumed: syncCheckpoint !== null,
    profilePath,
    submissionsPath,
    problemsDir,
    checkpointPath,
    submissionsCheckpointPath,
    profile: profileSnapshot,
    submissions: submissionsSnapshot,
    problems: problemResult,
  };
}

function throwIfStopRequested(shouldStop?: (() => boolean) | undefined): void {
  if (shouldStop?.()) {
    throw new StopRequestedError();
  }
}

export function resolveSyncCheckpointPath(
  submissionsPath: string,
  checkpointPath?: string,
): string {
  if (checkpointPath) {
    return path.resolve(checkpointPath);
  }

  return addPathSuffix(path.resolve(submissionsPath), ".sync-checkpoint");
}

export function resolveSubmissionsCheckpointPath(
  username: string,
  outputPath: string | undefined,
  checkpointPath: string | undefined,
): string {
  if (checkpointPath) {
    return path.resolve(checkpointPath);
  }

  if (outputPath) {
    return addPathSuffix(path.resolve(outputPath), ".checkpoint");
  }

  const safeUsername = username.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  return path.resolve(`.boj-submissions.${safeUsername}.checkpoint.json`);
}

export async function readSyncCheckpoint(checkpointPath: string): Promise<BackupSyncCheckpoint | null> {
  let raw: string;

  try {
    raw = await readFile(checkpointPath, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }

    throw new ConfigurationError(`Could not read sync checkpoint: ${checkpointPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError(`Sync checkpoint is not valid JSON: ${checkpointPath}`);
  }

  if (!isSyncCheckpoint(parsed)) {
    throw new ConfigurationError(`Sync checkpoint has an unexpected format: ${checkpointPath}`);
  }

  return parsed;
}

export async function readSubmissionsCheckpoint(
  checkpointPath: string,
  username: string,
): Promise<BojUserSubmissionsCheckpoint | null> {
  let raw: string;

  try {
    raw = await readFile(checkpointPath, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }

    throw new ConfigurationError(`Could not read submissions checkpoint: ${checkpointPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError(`Submissions checkpoint is not valid JSON: ${checkpointPath}`);
  }

  if (!isSubmissionsCheckpoint(parsed)) {
    throw new ConfigurationError(
      `Submissions checkpoint has an unexpected format: ${checkpointPath}`,
    );
  }

  if (parsed.username !== username) {
    throw new ConfigurationError(
      `Submissions checkpoint belongs to ${parsed.username}, not ${username}: ${checkpointPath}`,
    );
  }

  return parsed;
}

export function formatSyncPhase(phase: BackupSyncPhase): string {
  switch (phase) {
    case "profile":
      return "프로필 수집";
    case "submissions":
      return "제출 기록 수집";
    case "problems":
      return "문제 백업";
  }
}

function validateSyncCheckpoint(
  checkpoint: BackupSyncCheckpoint,
  current: {
    mode: "sync" | "archive";
    username: string;
    profilePath: string;
    submissionsPath: string;
    problemsDir: string;
    submissionsCheckpointPath: string;
  },
): void {
  if (checkpoint.mode && checkpoint.mode !== current.mode) {
    throw new ConfigurationError(
      `Sync checkpoint was created for ${checkpoint.mode}, not ${current.mode}. Use --no-resume to start a new run.`,
    );
  }

  if (checkpoint.username !== current.username) {
    throw new ConfigurationError(
      `Sync checkpoint belongs to ${checkpoint.username}, not ${current.username}.`,
    );
  }

  if (
    checkpoint.profilePath !== current.profilePath ||
    checkpoint.submissionsPath !== current.submissionsPath ||
    checkpoint.problemsDir !== current.problemsDir ||
    checkpoint.submissionsCheckpointPath !== current.submissionsCheckpointPath
  ) {
    throw new ConfigurationError(
      "Sync checkpoint paths do not match the current sync targets. Use --no-resume or remove the old checkpoint.",
    );
  }
}

function resolveResumeNumberOption(
  checkpointValue: number | null | undefined,
  currentValue: number | undefined,
  label: string,
): number | undefined {
  if (checkpointValue === undefined) {
    return currentValue;
  }

  if (currentValue !== undefined && currentValue !== checkpointValue) {
    throw new ConfigurationError(
      `Checkpoint ${label}=${checkpointValue ?? "none"} does not match requested ${label}=${currentValue}. Use --no-resume to start over.`,
    );
  }

  return checkpointValue ?? undefined;
}

function resolveResumeStringOption(
  checkpointValue: string | null | undefined,
  currentValue: string | undefined,
  label: string,
): string | undefined {
  if (checkpointValue === undefined) {
    return currentValue;
  }

  if (currentValue !== undefined && currentValue !== checkpointValue) {
    throw new ConfigurationError(
      `Checkpoint ${label}=${checkpointValue || "none"} does not match requested ${label}=${currentValue}. Use --no-resume to start over.`,
    );
  }

  return checkpointValue ?? undefined;
}

function isSyncCheckpoint(value: unknown): value is BackupSyncCheckpoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const checkpoint = value as Partial<BackupSyncCheckpoint>;
  return (
    checkpoint.kind === "boj-sync-checkpoint" &&
    checkpoint.version === 1 &&
    typeof checkpoint.username === "string" &&
    typeof checkpoint.startedAt === "string" &&
    typeof checkpoint.updatedAt === "string" &&
    typeof checkpoint.profilePath === "string" &&
    typeof checkpoint.submissionsPath === "string" &&
    typeof checkpoint.problemsDir === "string" &&
    typeof checkpoint.submissionsCheckpointPath === "string" &&
    (checkpoint.phase === "profile" ||
      checkpoint.phase === "submissions" ||
      checkpoint.phase === "problems")
  );
}

function isSubmissionsCheckpoint(value: unknown): value is BojUserSubmissionsCheckpoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const checkpoint = value as Partial<BojUserSubmissionsCheckpoint>;
  return (
    checkpoint.kind === "boj-user-submissions-checkpoint" &&
    checkpoint.version === 1 &&
    typeof checkpoint.username === "string" &&
    typeof checkpoint.startedAt === "string" &&
    typeof checkpoint.updatedAt === "string" &&
    typeof checkpoint.sourceUrl === "string" &&
    Array.isArray(checkpoint.rows) &&
    Array.isArray(checkpoint.seenPaths)
  );
}

async function readOptionalProfileSnapshot(inputPath: string): Promise<BojUserSnapshot | null> {
  try {
    const raw = await readFile(inputPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isProfileSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function readOptionalSubmissionsSnapshot(
  inputPath: string,
): Promise<BojUserSubmissionsSnapshot | null> {
  try {
    const raw = await readFile(inputPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isSubmissionsSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isProfileSnapshot(value: unknown): value is BojUserSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const snapshot = value as Partial<BojUserSnapshot>;
  return (
    !!snapshot.profile &&
    typeof snapshot.profile === "object" &&
    !!snapshot.languageStats &&
    typeof snapshot.languageStats === "object"
  );
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

function addPathSuffix(filePath: string, suffix: string): string {
  const parsed = path.parse(filePath);
  const extension = parsed.ext || ".json";
  const basename = parsed.ext ? parsed.name : parsed.base;
  return path.join(parsed.dir, `${basename}${suffix}${extension}`);
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function removeFileIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

async function writeJsonFile(outputPath: string, value: unknown): Promise<void> {
  const absolutePath = path.resolve(outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp-${process.pid}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(absolutePath, { force: true });
  await rename(tempPath, absolutePath);
}
