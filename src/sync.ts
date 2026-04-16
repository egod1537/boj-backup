import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  BOJ_USER_SUBMISSION_COLUMNS,
  BojSessionClient,
  type BojUserSnapshot,
  type BojUserSubmissionFetchProgress,
  type BojUserSubmissionsCheckpoint,
  type BojUserSubmissionsSnapshot,
} from "./boj/session.js";
import { ConfigurationError, StopRequestedError } from "./errors.js";
import {
  backupProblemsFromSubmissions,
  backupProblemFromRows,
  isProblemBackupComplete,
  readProblemSubmissionHistory,
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
  problemIds?: number[] | null;
  availableProblemCount?: number | null;
  selectionSummary?: string | null;
  problemIndex?: number | null;
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

  const problemSelection = selectProblemsFromProfile(profileSnapshot, {
    problemFilter: args.problemFilter,
    problemLimit: args.problemLimit,
  });
  if (problemSelection.problemIds.length === 0) {
    throw new ConfigurationError("No problems selected from profile snapshot.");
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
  const selectedProblemIds = resolveResumeProblemIds(
    syncCheckpoint?.problemIds,
    problemSelection.problemIds,
  );
  const availableProblemCount =
    syncCheckpoint?.availableProblemCount ?? problemSelection.availableProblems;
  const selectionSummary =
    syncCheckpoint?.selectionSummary ?? problemSelection.selectionSummary;
  let problemIndex = syncCheckpoint?.problemIndex ?? 0;
  if (problemIndex < 0 || problemIndex > selectedProblemIds.length) {
    problemIndex = 0;
  }

  const existingSubmissionsSnapshot = resume
    ? await readOptionalSubmissionsSnapshot(submissionsPath)
    : null;
  const reconstructed = await rebuildArchiveRowsFromCompletedProblems(
    username,
    selectedProblemIds,
    problemIndex,
    problemsDir,
    existingSubmissionsSnapshot,
  );
  if (reconstructed.problemIndex !== problemIndex) {
    args.onLog?.(
      `resume 재검증: ${problemIndex}번째 문제까지 복원하지 못해 ${reconstructed.problemIndex}번째 문제부터 다시 진행`,
    );
    problemIndex = reconstructed.problemIndex;
  }

  let aggregateRows = reconstructed.rows;
  let pagesFetched =
    existingSubmissionsSnapshot?.pagesFetched ?? 0;
  let completedProblems = problemIndex;
  let savedProblems = problemIndex;
  let skippedProblems = 0;
  let totalSourceFiles = aggregateRows.length;
  let savedSourceFiles = aggregateRows.length;
  let skippedSourceFiles = 0;
  let knownExistingProblems = 0;

  for (const problemId of selectedProblemIds) {
    if (await isProblemBackupComplete(problemsDir, problemId)) {
      knownExistingProblems += 1;
    }
  }

  const saveSyncCheckpoint = async () => {
    await writeJsonFile(checkpointPath, {
      kind: "boj-sync-checkpoint",
      version: 1,
      mode: "archive",
      username,
      requestedHandle: args.handle ?? null,
      startedAt,
      updatedAt: new Date().toISOString(),
      phase: "problems",
      profilePath,
      submissionsPath,
      problemsDir,
      submissionsCheckpointPath,
      problemFilter: problemFilter ?? null,
      problemLimit: problemLimit ?? null,
      problemIds: selectedProblemIds,
      availableProblemCount,
      selectionSummary,
      problemIndex,
    } satisfies BackupSyncCheckpoint);
  };

  throwIfStopRequested(args.shouldStop);
  await saveSyncCheckpoint();
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

  while (problemIndex < selectedProblemIds.length) {
    throwIfStopRequested(args.shouldStop);
    const problemId = selectedProblemIds[problemIndex];
    const problemDir = path.join(problemsDir, String(problemId));

    if (!args.overwriteProblems && (await isProblemBackupComplete(problemsDir, problemId))) {
      const localHistory = await readProblemSubmissionHistory(problemDir);
      if (localHistory) {
        aggregateRows.push(...localHistory.rows);
        totalSourceFiles += localHistory.rows.length;
        skippedProblems += 1;
        completedProblems += 1;
        skippedSourceFiles += localHistory.rows.length;

        const rateLimit = args.client.getRateLimitSnapshot();
        args.onProblemProgress?.({
          username,
          outputDir: problemsDir,
          availableProblems: availableProblemCount,
          totalProblems: selectedProblemIds.length,
          selectionSummary,
          knownExistingProblems,
          completedProblems,
          savedProblems,
          skippedProblems,
          phase: "skip-existing",
          currentProblemId: problemId,
          currentProblemTitle: localHistory.title,
          currentProblemDir: problemDir,
          currentSubmissionCount: localHistory.rows.length,
          currentSubmissionId: null,
          currentSourceIndex: null,
          totalSourceFiles: localHistory.rows.length,
          savedSourceFiles,
          skippedSourceFiles,
          nextDelayMs: rateLimit.nextDelayMs,
          delayReason: rateLimit.delayReason,
          backoffAttempt: rateLimit.backoffAttempt,
        });

        await writeArchiveSubmissionsSnapshot(
          submissionsPath,
          username,
          selectedProblemIds,
          availableProblemCount,
          selectionSummary,
          aggregateRows,
          pagesFetched,
        );
        problemIndex += 1;
        await saveSyncCheckpoint();
        continue;
      }
    }

    const submissionsCheckpoint =
      resume && (await fileExists(submissionsCheckpointPath))
        ? await readSubmissionsCheckpoint(submissionsCheckpointPath, username)
        : null;
    const activeSubmissionsCheckpoint =
      submissionsCheckpoint?.currentProblemId === problemId &&
      Array.isArray(submissionsCheckpoint.problemIds) &&
      submissionsCheckpoint.problemIds.length === 1 &&
      submissionsCheckpoint.problemIds[0] === problemId
        ? submissionsCheckpoint
        : null;

    if (submissionsCheckpoint && !activeSubmissionsCheckpoint) {
      args.onLog?.(
        `기존 제출 체크포인트 형식이 현재 문제 단위 resume과 맞지 않아 문제 #${problemId}부터 새로 수집`,
      );
      await removeFileIfExists(submissionsCheckpointPath);
    } else if (activeSubmissionsCheckpoint) {
      args.onLog?.(
        `문제 #${problemId} 제출 기록 resume: ${activeSubmissionsCheckpoint.totalCount} rows / ${activeSubmissionsCheckpoint.pagesFetched} pages (${submissionsCheckpointPath})`,
      );
    }

    const problemSubmissions = await args.client.fetchUserSubmissionsForProblem(username, problemId, {
      availableProblemCount,
      selectionSummary,
      selectedProblemCount: selectedProblemIds.length,
      completedProblemCount: completedProblems,
      resumeFrom: activeSubmissionsCheckpoint,
      onProgress: args.onSubmissionsProgress,
      shouldStop: args.shouldStop,
      onCheckpoint: async (nextCheckpoint) => {
        await writeJsonFile(submissionsCheckpointPath, nextCheckpoint);
        await saveSyncCheckpoint();
      },
    });

    const backupResult = await backupProblemFromRows({
      client: args.client,
      username,
      outputDir: problemsDir,
      problemId,
      title: problemSubmissions.rows[0]?.[2] ?? null,
      rows: problemSubmissions.rows,
      availableProblems: availableProblemCount,
      totalProblems: selectedProblemIds.length,
      selectionSummary,
      knownExistingProblems,
      completedProblems,
      savedProblems,
      skippedProblems,
      savedSourceFiles,
      skippedSourceFiles,
      onProgress: args.onProblemProgress,
      shouldStop: args.shouldStop,
    });

    aggregateRows.push(...problemSubmissions.rows);
    aggregateRows.sort((left, right) => right[0] - left[0]);
    pagesFetched += problemSubmissions.pagesFetched;
    totalSourceFiles += backupResult.totalSourceFiles;
    savedSourceFiles += backupResult.savedSourceFiles;
    skippedSourceFiles += backupResult.skippedSourceFiles;
    savedProblems += 1;
    completedProblems += 1;

    await writeArchiveSubmissionsSnapshot(
      submissionsPath,
      username,
      selectedProblemIds,
      availableProblemCount,
      selectionSummary,
      aggregateRows,
      pagesFetched,
    );
    await removeFileIfExists(submissionsCheckpointPath);
    problemIndex += 1;
    await saveSyncCheckpoint();
  }

  const problemResult: ProblemBackupResult = {
    username,
    outputDir: problemsDir,
    availableProblems: availableProblemCount,
    totalProblems: selectedProblemIds.length,
    selectionSummary,
    savedProblems,
    skippedProblems,
    totalSourceFiles,
    savedSourceFiles,
    skippedSourceFiles,
  };

  await removeFileIfExists(checkpointPath);
  await removeFileIfExists(submissionsCheckpointPath);
  args.onLog?.(
    `문제 백업 완료: saved ${problemResult.savedProblems}, existing ${problemResult.skippedProblems}`,
  );

  const submissionsSnapshot = await readOptionalSubmissionsSnapshot(submissionsPath);
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
      return "문제 아카이브";
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

function resolveResumeProblemIds(
  checkpointProblemIds: number[] | null | undefined,
  selectedProblemIds: number[],
): number[] {
  if (!checkpointProblemIds) {
    return selectedProblemIds;
  }

  const sameSelection =
    checkpointProblemIds.length === selectedProblemIds.length &&
    checkpointProblemIds.every((problemId, index) => problemId === selectedProblemIds[index]);

  if (!sameSelection) {
    throw new ConfigurationError(
      "Checkpoint problem selection does not match the current profile selection. Use --no-resume to start over.",
    );
  }

  return checkpointProblemIds;
}

async function rebuildArchiveRowsFromCompletedProblems(
  username: string,
  selectedProblemIds: number[],
  requestedProblemIndex: number,
  problemsDir: string,
  existingSubmissionsSnapshot: BojUserSubmissionsSnapshot | null,
): Promise<{ rows: BojUserSubmissionsSnapshot["rows"]; problemIndex: number }> {
  const rows: BojUserSubmissionsSnapshot["rows"] = [];
  let problemIndex = requestedProblemIndex;

  for (let index = 0; index < requestedProblemIndex; index += 1) {
    const problemId = selectedProblemIds[index];
    if (problemId === undefined) {
      problemIndex = index;
      break;
    }

    const problemDir = path.join(problemsDir, String(problemId));
    const history = await readProblemSubmissionHistory(problemDir);
    if (history && history.username === username) {
      rows.push(...history.rows);
      continue;
    }

    const fallbackRows =
      existingSubmissionsSnapshot?.rows.filter((row) => row[1] === problemId) ?? [];
    if (fallbackRows.length > 0) {
      rows.push(...fallbackRows);
      continue;
    }

    problemIndex = index;
    break;
  }

  rows.sort((left, right) => right[0] - left[0]);
  return {
    rows,
    problemIndex,
  };
}

async function writeArchiveSubmissionsSnapshot(
  submissionsPath: string,
  username: string,
  problemIds: number[],
  availableProblemCount: number,
  selectionSummary: string,
  rows: BojUserSubmissionsSnapshot["rows"],
  pagesFetched: number,
): Promise<void> {
  const sortedRows = [...rows].sort((left, right) => right[0] - left[0]);
  await writeJsonFile(submissionsPath, {
    username,
    fetchedAt: new Date().toISOString(),
    sourceUrl: new URL(`status?user_id=${encodeURIComponent(username)}`, "https://www.acmicpc.net").toString(),
    mode: "problem-status",
    limitCount: null,
    estimatedTotalCount: null,
    problemIds,
    availableProblemCount,
    selectionSummary,
    totalCount: sortedRows.length,
    pagesFetched,
    columns: BOJ_USER_SUBMISSION_COLUMNS,
    rows: sortedRows,
  } satisfies BojUserSubmissionsSnapshot);
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
