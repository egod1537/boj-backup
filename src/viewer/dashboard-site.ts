import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readdir, readFile, rm, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { load } from "cheerio";

import {
  BojSessionClient,
  type BojUserSnapshot,
  type BojUserSubmissionsCheckpoint,
  type BojUserSubmissionFetchProgress,
  type BojUserSubmissionsSnapshot,
} from "../boj/session.js";
import { authenticateBojClient } from "../boj/auth.js";
import { loadConfig, type AppConfig } from "../config.js";
import { AuthenticationError, ConfigurationError, StopRequestedError } from "../errors.js";
import {
  backupProblemsFromSubmissions,
  type ProblemBackupMeta,
  type ProblemBackupProgress,
  type ProblemSubmissionHistorySnapshot,
} from "../problem-backup.js";
import { selectProblemsFromProfile } from "../problem-selection.js";
import {
  type BackupSyncCheckpoint,
  formatSyncPhase,
  readSyncCheckpoint,
  resolveSyncCheckpointPath,
  runArchiveSync,
  runBackupSync,
  type BackupSyncStageProgress,
} from "../sync.js";
import {
  renderProfileInfoPage,
  renderProfileLanguagePage,
} from "./profile-site.js";
import { renderProblemSubmissionReactPage } from "./react/problem-submission-page.js";
import { renderDashboardReactPage } from "./react/dashboard-app.js";
import { BOJ_FAVICON_32_URL } from "./react/render.js";
import type {
  DashboardArtifactPaths,
  DashboardArtifactsState,
  DashboardResumeState,
  DashboardStateResponse,
  DashboardTaskKind,
  DashboardTaskSnapshot,
  DashboardTaskStatus,
  ProblemListEntry,
} from "./dashboard-types.js";
import { renderSubmissionsStatusPage } from "./submission-site.js";

interface DashboardLastUserState {
  username: string;
  updatedAt: string;
}

export interface StartDashboardViewerOptions {
  host: string;
  port: number;
  profilePath?: string;
  submissionsPath?: string;
  problemsDir?: string;
}

export interface StartedDashboardViewer {
  server: Server;
  dashboardUrl: string;
}

const DEFAULT_DASHBOARD_ROOT_DIR = path.resolve("data");
const DEFAULT_DASHBOARD_LAST_USER_FILE = ".dashboard-last-user.json";
const DASHBOARD_CLIENT_ENTRY = path.resolve("src", "viewer", "dashboard-client.tsx");
const DASHBOARD_CLIENT_ASSET_PATH = path.resolve("dist", "viewer", "assets", "dashboard-client.js");

export async function startDashboardViewerServer(
  options: StartDashboardViewerOptions,
): Promise<StartedDashboardViewer> {
  const artifactPaths = await resolveInitialDashboardArtifactPaths(options);
  const dashboardClientAssetPath = await ensureDashboardClientAsset();
  const taskController = new DashboardTaskController();

  const server = createServer((request, response) => {
    void handleRequest(request, response, taskController, artifactPaths, dashboardClientAssetPath).catch((error) => {
      respondJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: unknown) => {
      reject(normalizeServerStartError(error, options.host, options.port));
    };

    server.once("error", onError);
    server.listen(options.port, options.host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine dashboard server address.");
  }

  const displayHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
  const dashboardUrl = `http://${displayHost}:${address.port}/`;

  return {
    server,
    dashboardUrl,
  };
}

async function resolveInitialDashboardArtifactPaths(
  options: StartDashboardViewerOptions,
): Promise<DashboardArtifactPaths> {
  const hasExplicitPaths =
    !!options.profilePath?.trim() ||
    !!options.submissionsPath?.trim() ||
    !!options.problemsDir?.trim();

  if (hasExplicitPaths) {
    const rootDir = path.resolve(
      path.dirname(options.profilePath ?? options.submissionsPath ?? options.problemsDir ?? DEFAULT_DASHBOARD_ROOT_DIR),
    );
    return {
      rootDir,
      profilePath: path.resolve(options.profilePath ?? path.join(rootDir, "profile.json")),
      submissionsPath: path.resolve(options.submissionsPath ?? path.join(rootDir, "submissions.json")),
      problemsDir: path.resolve(options.problemsDir ?? path.join(rootDir, "problems")),
    };
  }

  const rootDir = DEFAULT_DASHBOARD_ROOT_DIR;
  const lastUser = await readDashboardLastUserState(rootDir);
  const username = lastUser?.username ?? (await findDashboardExistingUsername(rootDir));

  if (username) {
    return {
      rootDir,
      ...resolveDashboardUserArtifactPaths(rootDir, username),
    };
  }

  return {
    rootDir,
    profilePath: path.join(rootDir, "profile.json"),
    submissionsPath: path.join(rootDir, "submissions.json"),
    problemsDir: path.join(rootDir, "problems"),
  };
}

function resolveDashboardUserArtifactPaths(
  rootDir: string,
  username: string,
): Pick<DashboardArtifactPaths, "profilePath" | "submissionsPath" | "problemsDir"> {
  const safeUsername = sanitizeDashboardUsername(username);
  const userDir = path.join(path.resolve(rootDir), safeUsername);
  return {
    profilePath: path.join(userDir, "profile.json"),
    submissionsPath: path.join(userDir, "submissions.json"),
    problemsDir: path.join(userDir, "problems"),
  };
}

function applyDashboardUserArtifactPaths(
  artifactPaths: DashboardArtifactPaths,
  username: string,
): void {
  const resolved = resolveDashboardUserArtifactPaths(artifactPaths.rootDir, username);
  artifactPaths.profilePath = resolved.profilePath;
  artifactPaths.submissionsPath = resolved.submissionsPath;
  artifactPaths.problemsDir = resolved.problemsDir;
}

function sanitizeDashboardUsername(username: string): string {
  return username.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

function resolveDashboardLastUserStatePath(rootDir: string): string {
  return path.join(path.resolve(rootDir), DEFAULT_DASHBOARD_LAST_USER_FILE);
}

async function readDashboardLastUserState(rootDir: string): Promise<DashboardLastUserState | null> {
  try {
    const raw = await readFile(resolveDashboardLastUserStatePath(rootDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<DashboardLastUserState>;
    if (typeof parsed.username !== "string" || typeof parsed.updatedAt !== "string") {
      return null;
    }

    return {
      username: parsed.username,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

async function writeDashboardLastUserState(rootDir: string, username: string): Promise<void> {
  await writeJsonFile(resolveDashboardLastUserStatePath(rootDir), {
    username,
    updatedAt: new Date().toISOString(),
  });
}

async function findDashboardExistingUsername(rootDir: string): Promise<string | null> {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();

  for (const candidate of candidates) {
    if (
      await fileExists(path.join(rootDir, candidate, "profile.json")) ||
      await fileExists(path.join(rootDir, candidate, "submissions.json"))
    ) {
      return candidate;
    }
  }

  return null;
}

async function ensureDashboardClientAsset(): Promise<string> {
  await mkdir(path.dirname(DASHBOARD_CLIENT_ASSET_PATH), { recursive: true });
  const { build } = await import("esbuild");

  await build({
    entryPoints: [DASHBOARD_CLIENT_ENTRY],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile: DASHBOARD_CLIENT_ASSET_PATH,
    jsx: "automatic",
    sourcemap: false,
    logLevel: "silent",
  });

  return DASHBOARD_CLIENT_ASSET_PATH;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  taskController: DashboardTaskController,
  artifactPaths: DashboardArtifactPaths,
  dashboardClientAssetPath: string,
): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(requestUrl.pathname);
  const noStoreHeaders = {
    "cache-control": "no-store, max-age=0, must-revalidate",
    pragma: "no-cache",
  };

  if (pathname === "/favicon.ico") {
    response.writeHead(302, { Location: BOJ_FAVICON_32_URL });
    response.end();
    return;
  }

  if (request.method === "GET" && pathname === "/assets/dashboard-client.js") {
    const asset = await readFile(dashboardClientAssetPath, "utf8");
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store, max-age=0, must-revalidate",
      pragma: "no-cache",
    });
    response.end(asset);
    return;
  }

  if (request.method === "GET" && pathname === "/") {
    const state = await buildDashboardState(requestUrl.origin, artifactPaths, taskController);
    respondHtml(response, renderDashboardReactPage(state), 200, noStoreHeaders);
    return;
  }

  if (request.method === "GET" && pathname === "/api/state") {
    const state = await buildDashboardState(requestUrl.origin, artifactPaths, taskController);
    respondJson(response, 200, state, noStoreHeaders);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tasks/stop") {
    const stopped = taskController.requestStop();
    if (!stopped) {
      respondJson(response, 409, { error: "현재 중지할 실행 중 작업이 없습니다." });
      return;
    }

    respondJson(response, 202, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/open-location") {
    const form = await readFormBody(request);
    const key = form.get("key")?.trim() || "";
    const targetPath = resolveOpenLocationPath(key, artifactPaths);

    if (!targetPath) {
      respondJson(response, 400, { error: "지원하지 않는 위치입니다." });
      return;
    }

    await ensureOpenLocationExists(targetPath);
    await openPathInFileManager(targetPath);
    respondJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && pathname === "/api/tasks/sync") {
    const form = await readFormBody(request);
    const profilePath = path.resolve(form.get("profilePath")?.trim() || artifactPaths.profilePath);
    const submissionsPath = path.resolve(
      form.get("submissionsPath")?.trim() || artifactPaths.submissionsPath,
    );
    const problemsDir = path.resolve(form.get("problemsDir")?.trim() || artifactPaths.problemsDir);
    const handle = form.get("handle")?.trim() || undefined;
    const delaySeconds = parseDelayParam(form.get("delaySeconds"));
    const resume = (form.get("resume") ?? "on") !== "off";
    const overwriteProblems = form.get("overwriteProblems") === "on";
    const problemFilter = form.get("problemFilter")?.trim() || undefined;
    const problemLimit = parseOptionalPositiveInteger(form.get("problemLimit"));

    artifactPaths.profilePath = profilePath;
    artifactPaths.submissionsPath = submissionsPath;
    artifactPaths.problemsDir = problemsDir;

    const task = startDashboardTask(request, response, taskController, "sync", "전체 동기화", async (context) => {
      const config = loadConfig();
      const client = createClient(config, delaySeconds);

      context.setStatus([
        "단계: 1/3 대기",
        `프로필 JSON: 준비`,
        `제출 JSON: 준비`,
        `문제 디렉터리: 준비`,
        `문제 필터: ${problemFilter || "전체"}`,
        `문제 수 제한: ${problemLimit === null ? "없음" : formatNumber(problemLimit)}`,
        `딜레이: ${delaySeconds.toFixed(1)}s`,
        `이어받기: ${resume ? "on" : "off"}`,
      ]);

      const result = await runBackupSync({
        client,
        handle,
        resolveUsername: () => authenticateClient(client, config),
        profilePath,
        submissionsPath,
        problemsDir,
        problemFilter,
        problemLimit: problemLimit ?? undefined,
        resume,
        overwriteProblems,
        shouldStop: context.shouldStop,
        onStage: (progress) => {
          context.setStatus(formatSyncStageStatusLines(progress, problemFilter, problemLimit));
          context.log(`단계 ${progress.phaseIndex}/3: ${formatSyncPhase(progress.phase)}`);
        },
        onLog: (message) => {
          context.log(message);
        },
        onSubmissionsProgress: (progress) => {
          context.setStatus(
            formatSyncSubmissionsStatusLines(
              progress,
              submissionsPath,
              resolveSyncCheckpointPath(submissionsPath),
              problemFilter,
              problemLimit,
            ),
          );
          context.log(formatSubmissionsLogLine(progress));
        },
        onProblemProgress: (progress) => {
          context.setStatus(
            formatSyncProblemStatusLines(
              progress,
              problemsDir,
              resolveSyncCheckpointPath(submissionsPath),
            ),
          );
          context.log(formatProblemLogLine(progress));
        },
      });

      context.setSummary(`전체 동기화 완료: ${result.username}`);
      context.setStatus([
        "단계: 3/3 완료",
        `사용자: ${result.username}`,
        `프로필 JSON: 저장 완료`,
        `제출 JSON: 저장 완료`,
        `문제 디렉터리: 저장 완료`,
        `문제 선택: ${result.problems.selectionSummary}`,
        `문제 수: ${formatNumber(result.problems.totalProblems)}/${formatNumber(result.problems.availableProblems)}`,
        `코드 파일 수: ${formatNumber(result.problems.totalSourceFiles)}`,
      ]);
    });
    if (!task) {
      return;
    }

    respondTaskAccepted(request, response, task.id);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tasks/profile") {
    const form = await readFormBody(request);
    const delaySeconds = parseDelayParam(form.get("delaySeconds"));
    const task = startDashboardTask(request, response, taskController, "profile", "프로필 수집", async (context) => {
      const config = loadConfig();
      const client = createClient(config, delaySeconds);
      const targetHandle = await authenticateClient(client, config);
      applyDashboardUserArtifactPaths(artifactPaths, targetHandle);
      const outputPath = artifactPaths.profilePath;
      context.throwIfStopRequested();

      context.setStatus([
        `사용자: ${targetHandle}`,
        `저장 폴더: ${path.dirname(outputPath)}`,
        `딜레이: ${delaySeconds.toFixed(1)}s`,
        "프로필 페이지 수집 중",
      ]);
      context.log(`프로필 수집 시작: ${targetHandle}`);

      const profile = await client.fetchUserProfile(targetHandle);
      context.throwIfStopRequested();
      context.setStatus([
        `사용자: ${targetHandle}`,
        `출력: ${outputPath}`,
        `딜레이: ${delaySeconds.toFixed(1)}s`,
        "언어 통계 수집 중",
      ]);
      const languageStats = await client.fetchUserLanguageStats(targetHandle);
      context.throwIfStopRequested();
      const snapshot: BojUserSnapshot = {
        username: profile.username,
        fetchedAt: new Date().toISOString(),
        profile,
        languageStats,
      };

      await writeJsonFile(outputPath, snapshot);
      await writeDashboardLastUserState(artifactPaths.rootDir, snapshot.username);
      context.setSummary(`프로필 JSON 저장 완료: ${outputPath}`);
      context.setStatus([
        `사용자: ${snapshot.username}`,
        `등수: ${formatNullableNumber(profile.rank)}`,
        `제출: ${formatNullableNumber(profile.submissionCount)}`,
        `저장 폴더: ${path.dirname(outputPath)}`,
      ]);
      context.log(`프로필 JSON 저장 완료: ${outputPath}`);
    });
    if (!task) {
      return;
    }

    respondTaskAccepted(request, response, task.id);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tasks/archive") {
    const form = await readFormBody(request);
    const delaySeconds = parseDelayParam(form.get("delaySeconds"));
    const resume = (form.get("resume") ?? "on") !== "off";
    const overwriteProblems = form.get("overwriteProblems") === "on";
    const problemFilter = form.get("problemFilter")?.trim() || undefined;
    const problemLimit = parseOptionalPositiveInteger(form.get("problemLimit"));

    const task = startDashboardTask(
      request,
      response,
      taskController,
      "archive",
      "문제 + 제출코드 크롤링",
      async (context) => {
        const config = loadConfig();
        const client = createClient(config, delaySeconds);
        const targetHandle = await authenticateClient(client, config);
        applyDashboardUserArtifactPaths(artifactPaths, targetHandle);
        const profilePath = artifactPaths.profilePath;
        const submissionsPath = artifactPaths.submissionsPath;
        const problemsDir = artifactPaths.problemsDir;

        context.setStatus([
          "단계: 1/2 대기",
          `사용자: ${targetHandle}`,
          `저장 폴더: ${path.join(artifactPaths.rootDir, sanitizeDashboardUsername(targetHandle))}`,
          `프로필 JSON: ${profilePath}`,
          `제출 JSON: 준비`,
          `문제 디렉터리: 준비`,
          `문제 필터: ${problemFilter || "전체"}`,
          `문제 수 제한: ${problemLimit === null ? "없음" : formatNumber(problemLimit)}`,
          `딜레이: ${delaySeconds.toFixed(1)}s`,
          `이어받기: ${resume ? "on" : "off"}`,
        ]);

        const result = await runArchiveSync({
          client,
          handle: targetHandle,
          profilePath,
          submissionsPath,
          problemsDir,
          problemFilter,
          problemLimit: problemLimit ?? undefined,
          resume,
          overwriteProblems,
          shouldStop: context.shouldStop,
          onStage: (progress) => {
            context.setStatus(formatArchiveStageStatusLines(progress, problemFilter, problemLimit));
            context.log(`단계 ${progress.phaseIndex}/${progress.totalPhases}: ${formatSyncPhase(progress.phase)}`);
          },
          onLog: (message) => {
            context.log(message);
          },
          onSubmissionsProgress: (progress) => {
            context.setStatus(
              formatArchiveSubmissionsStatusLines(
              progress,
              submissionsPath,
              problemFilter,
              problemLimit,
              ),
            );
            context.log(formatSubmissionsLogLine(progress));
          },
          onProblemProgress: (progress) => {
            context.setStatus(formatArchiveProblemStatusLines(progress, problemsDir));
            context.log(formatProblemLogLine(progress));
          },
        });

        await writeDashboardLastUserState(artifactPaths.rootDir, result.username);
        context.setSummary(`문제 + 제출코드 크롤링 완료: ${result.username}`);
        context.setStatus([
          "단계: 2/2 완료",
          `사용자: ${result.username}`,
          `프로필 JSON: 사용`,
          `제출 JSON: 저장 완료`,
          `문제 디렉터리: 저장 완료`,
          `문제 선택: ${result.problems.selectionSummary}`,
          `문제 수: ${formatNumber(result.problems.totalProblems)}/${formatNumber(result.problems.availableProblems)}`,
          `코드 파일 수: ${formatNumber(result.problems.totalSourceFiles)}`,
        ]);
      },
    );
    if (!task) {
      return;
    }

    respondTaskAccepted(request, response, task.id);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tasks/submissions") {
    const form = await readFormBody(request);
    const outputPath = path.resolve(form.get("outputPath")?.trim() || artifactPaths.submissionsPath);
    const handle = form.get("handle")?.trim() || undefined;
    const delaySeconds = parseDelayParam(form.get("delaySeconds"));
    const resume = (form.get("resume") ?? "on") !== "off";
    const submissionLimit = parseOptionalPositiveInteger(form.get("submissionLimit"));

    artifactPaths.submissionsPath = outputPath;
    const task = startDashboardTask(request, response, taskController, "submissions", "제출 기록 수집", async (context) => {
      const config = loadConfig();
      const client = createClient(config, delaySeconds);
      const targetHandle = handle || (await authenticateClient(client, config));
      context.throwIfStopRequested();
      const checkpointPath = resolveSubmissionsCheckpointPath(targetHandle, outputPath, undefined);
      const checkpoint = resume
        ? await readSubmissionsCheckpoint(checkpointPath, targetHandle)
        : null;
      const estimatedTotalCount =
        checkpoint?.estimatedTotalCount ?? (await client.fetchUserProfile(targetHandle)).submissionCount;

      context.setStatus([
        `사용자: ${targetHandle}`,
        `출력: ${outputPath}`,
        `체크포인트: ${checkpointPath}`,
        `제출 수 제한: ${submissionLimit === null ? "없음" : formatNumber(submissionLimit)}`,
        `딜레이: ${delaySeconds.toFixed(1)}s`,
      ]);
      if (checkpoint) {
        context.log(
          `resume: ${checkpoint.totalCount} rows / ${checkpoint.pagesFetched} pages (${checkpointPath})`,
        );
      } else if (!resume) {
        context.log("resume 비활성화: 첫 페이지부터 새로 수집");
      }

      const submissions = await client.fetchUserSubmissions(targetHandle, {
        limitCount: submissionLimit ?? null,
        estimatedTotalCount,
        resumeFrom: checkpoint,
        shouldStop: context.shouldStop,
        onCheckpoint: (nextCheckpoint) => writeJsonFile(checkpointPath, nextCheckpoint),
        onProgress: (progress) => {
          context.setStatus(formatSubmissionsStatusLines(progress, estimatedTotalCount, outputPath));
          context.log(formatSubmissionsLogLine(progress));
        },
      });

      await removeFileIfExists(checkpointPath);
      await writeJsonFile(outputPath, submissions);
      context.setSummary(`제출 JSON 저장 완료: ${outputPath}`);
      context.setStatus([
        `사용자: ${submissions.username}`,
        `제출 수: ${formatNumber(submissions.totalCount)}`,
        `수집 페이지: ${formatNumber(submissions.pagesFetched)}`,
        `제출 수 제한: ${submissions.limitCount === null ? "없음" : formatNumber(submissions.limitCount)}`,
        `저장: ${outputPath}`,
      ]);
      context.log(`submissions JSON 저장 완료: ${outputPath}`);
    });
    if (!task) {
      return;
    }

    respondTaskAccepted(request, response, task.id);
    return;
  }

  if (request.method === "POST" && pathname === "/api/tasks/problems") {
    const form = await readFormBody(request);
    const inputPath = path.resolve(form.get("inputPath")?.trim() || artifactPaths.submissionsPath);
    const outputDir = path.resolve(form.get("outputDir")?.trim() || artifactPaths.problemsDir);
    const delaySeconds = parseDelayParam(form.get("delaySeconds"));
    const overwrite = form.get("overwrite") === "on";
    const problemFilter = form.get("problemFilter")?.trim() || undefined;
    const problemLimit = parseOptionalPositiveInteger(form.get("problemLimit"));

    artifactPaths.problemsDir = outputDir;
    const task = startDashboardTask(request, response, taskController, "problems", "문제 백업", async (context) => {
      const config = loadConfig();
      const client = createClient(config, delaySeconds);
      await authenticateClient(client, config);
      context.throwIfStopRequested();

      context.setStatus([
        `입력: ${inputPath}`,
        `출력: ${outputDir}`,
        `딜레이: ${delaySeconds.toFixed(1)}s`,
        `overwrite: ${overwrite ? "on" : "off"}`,
        `문제 필터: ${problemFilter || "전체"}`,
        `문제 수 제한: ${problemLimit === null ? "없음" : formatNumber(problemLimit)}`,
      ]);

      const result = await backupProblemsFromSubmissions({
        client,
        inputPath,
        outputDir,
        overwrite,
        problemFilter,
        problemLimit: problemLimit ?? undefined,
        onProgress: (progress) => {
          context.setStatus(formatProblemStatusLines(progress, outputDir));
          context.log(formatProblemLogLine(progress));
        },
        shouldStop: context.shouldStop,
      });

      context.setSummary(`문제 백업 완료: ${result.outputDir}`);
      context.setStatus([
        `출력: ${result.outputDir}`,
        `선택: ${result.selectionSummary}`,
        `저장: ${formatNumber(result.savedProblems)}개`,
        `기존: ${formatNumber(result.skippedProblems)}개`,
        `대상: ${formatNumber(result.totalProblems)}/${formatNumber(result.availableProblems)}개`,
      ]);
      context.log(`문제 백업 완료: saved ${result.savedProblems}, existing ${result.skippedProblems}`);
    });
    if (!task) {
      return;
    }

    respondTaskAccepted(request, response, task.id);
    return;
  }

  if (request.method === "GET" && pathname === "/problems") {
    const entries = await readProblemListEntries(artifactPaths.problemsDir);
    const query = requestUrl.searchParams.get("q")?.trim() ?? "";
    const filteredEntries = filterProblemListEntries(entries, query);
    respondHtml(
      response,
      renderProblemsIndexPage(filteredEntries, artifactPaths.problemsDir, {
        query,
        totalCount: entries.length,
      }),
    );
    return;
  }

  if (request.method === "GET" && pathname.startsWith("/problems/")) {
    const problemPath = pathname.slice("/problems/".length);
    const [id, subPath, childId] = problemPath.split("/");
    const problemId = Number.parseInt(id, 10);
    if (!Number.isInteger(problemId)) {
      respondHtml(response, renderDashboardErrorPage("잘못된 문제 번호입니다."));
      return;
    }

    const problemDir = path.join(artifactPaths.problemsDir, String(problemId));
    const submissionsSnapshot = await readOptionalProblemSubmissionHistory(problemDir);
    const localProblemUrl = `/problems/${problemId}`;
    const localProblemSubmissionsUrl = `/problems/${problemId}/submissions`;

    if (subPath === "submissions" && childId) {
      const submissionId = Number.parseInt(childId, 10);
      if (!Number.isInteger(submissionId)) {
        respondHtml(response, renderDashboardErrorPage("잘못된 제출 번호입니다."), 404);
        return;
      }

      const submissionView = await readProblemSubmissionView(problemDir, problemId, submissionId);
      if (!submissionView) {
        respondHtml(
          response,
          renderDashboardErrorPage(`제출 코드 또는 메타데이터를 찾을 수 없습니다: #${submissionId}`),
          404,
        );
        return;
      }

      respondHtml(
        response,
        renderProblemSubmissionReactPage(submissionView, requestUrl.origin, {
          localProfileOrigin: requestUrl.origin,
        }),
      );
      return;
    }

    if (subPath === "submissions") {
      if (!submissionsSnapshot) {
        respondHtml(
          response,
          renderDashboardErrorPage(`문제별 submissions.json 을 찾을 수 없습니다: ${path.join(problemDir, "submissions.json")}`),
          404,
        );
        return;
      }

      respondHtml(
        response,
        renderSubmissionsStatusPage(
          convertProblemSubmissionHistoryToSnapshot(submissionsSnapshot),
          requestUrl.origin,
          {
            localProfileOrigin: requestUrl.origin,
            problemNav: {
              problemId,
              problemTitle: submissionsSnapshot.title,
              problemUrl: localProblemUrl,
              submissionsUrl: localProblemSubmissionsUrl,
              activeTab: "submissions",
            },
          },
        ),
      );
      return;
    }

    const htmlPath = path.join(problemDir, "index.html");
    try {
      const html = await readFile(htmlPath, "utf8");
      respondHtml(
        response,
        rewriteProblemDetailHtml(html, {
          problemId,
          problemUrl: localProblemUrl,
          submissionsUrl: localProblemSubmissionsUrl,
        }),
      );
    } catch {
      respondHtml(response, renderDashboardErrorPage(`문제 HTML을 찾을 수 없습니다: ${htmlPath}`), 404);
    }
    return;
  }

  if (request.method === "GET" && (pathname === "/user" || pathname.startsWith("/user/"))) {
    const profileSnapshot = await readOptionalProfileSnapshot(artifactPaths.profilePath);
    if (!profileSnapshot) {
      respondHtml(response, renderDashboardErrorPage("profile.json 이 없어 프로필을 표시할 수 없습니다."), 404);
      return;
    }

    const username = profileSnapshot.profile.username || profileSnapshot.username;
    const submissionsSnapshot = await readOptionalSubmissionsSnapshot(artifactPaths.submissionsPath);
    const matchedSubmissions =
      submissionsSnapshot && submissionsSnapshot.username === username ? submissionsSnapshot : null;

    const infoPath = `/user/${username}`;
    const languagePath = `/user/language/${username}`;
    if (pathname === "/user" || pathname === infoPath) {
      respondHtml(response, renderProfileInfoPage(profileSnapshot, requestUrl.origin, matchedSubmissions));
      return;
    }

    if (pathname === "/user/language" || pathname === languagePath) {
      respondHtml(
        response,
        renderProfileLanguagePage(profileSnapshot, requestUrl.origin, matchedSubmissions),
      );
      return;
    }
  }

  if (request.method === "GET" && pathname === "/status") {
    const submissionsSnapshot = await readOptionalSubmissionsSnapshot(artifactPaths.submissionsPath);
    if (!submissionsSnapshot) {
      respondHtml(response, renderDashboardErrorPage("submissions.json 이 없어 제출 현황을 표시할 수 없습니다."), 404);
      return;
    }

    const profileSnapshot = await readOptionalProfileSnapshot(artifactPaths.profilePath);
    const profileUsername = profileSnapshot?.profile.username || profileSnapshot?.username || null;
    const options =
      profileUsername && profileUsername === submissionsSnapshot.username
        ? { localProfileOrigin: requestUrl.origin }
        : {};
    respondHtml(response, renderSubmissionsStatusPage(submissionsSnapshot, requestUrl.origin, options));
    return;
  }

  respondHtml(response, renderDashboardErrorPage("지원하지 않는 경로입니다."), 404);
}

class DashboardTaskController {
  private nextTaskId = 1;
  private currentTask: DashboardTaskSnapshot | null = null;

  start(
    kind: DashboardTaskKind,
    title: string,
    runner: (context: DashboardTaskContext) => Promise<void>,
  ): DashboardTaskSnapshot {
    if (
      this.currentTask &&
      (this.currentTask.status === "running" || this.currentTask.status === "stopping")
    ) {
      throw new ConfigurationError("이미 실행 중인 작업이 있습니다.");
    }

    const task: DashboardTaskSnapshot = {
      id: this.nextTaskId,
      kind,
      title,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      summary: null,
      statusLines: [],
      logs: [],
      stopRequested: false,
    };
    this.nextTaskId += 1;
    this.currentTask = task;

    const context: DashboardTaskContext = {
      setStatus: (lines) => {
        task.statusLines = [...lines];
      },
      setSummary: (summary) => {
        task.summary = summary;
      },
      log: (message) => {
        const timestamp = new Intl.DateTimeFormat("ko-KR", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date());
        const line = `[${timestamp}] ${message}`;
        if (task.logs[task.logs.length - 1] === line) {
          return;
        }

        task.logs.push(line);
        while (task.logs.length > 80) {
          task.logs.shift();
        }
      },
      shouldStop: () => task.stopRequested,
      throwIfStopRequested: () => {
        if (task.stopRequested) {
          throw new StopRequestedError();
        }
      },
    };

    void (async () => {
      try {
        await runner(context);
        task.status = task.stopRequested ? "stopped" : "completed";
        if (task.stopRequested) {
          task.summary = "작업이 중지되었습니다. 현재 체크포인트로 이어받을 수 있습니다.";
          context.log(task.summary);
        }
      } catch (error) {
        if (error instanceof StopRequestedError) {
          task.status = "stopped";
          context.log(error.message);
          task.summary = "작업이 중지되었습니다. 현재 체크포인트로 이어받을 수 있습니다.";
        } else {
          task.status = "failed";
          context.log(error instanceof Error ? error.message : String(error));
          if (!task.summary) {
            task.summary = "작업이 실패했습니다.";
          }
        }
      } finally {
        task.finishedAt = new Date().toISOString();
      }
    })();

    return snapshotTask(task);
  }

  getCurrentTask(): DashboardTaskSnapshot | null {
    return this.currentTask ? snapshotTask(this.currentTask) : null;
  }

  requestStop(): boolean {
    if (!this.currentTask || this.currentTask.status !== "running") {
      return false;
    }

    this.currentTask.stopRequested = true;
    this.currentTask.status = "stopping";
    this.currentTask.summary = "중지 요청을 받았습니다. 현재 요청이 끝나면 안전하게 정지합니다.";
    this.appendTaskLog(this.currentTask, "중지 요청을 받았습니다. 현재 요청이 끝나면 안전하게 정지합니다.");
    return true;
  }

  private appendTaskLog(task: DashboardTaskSnapshot, message: string): void {
    const timestamp = new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date());
    const line = `[${timestamp}] ${message}`;
    if (task.logs[task.logs.length - 1] === line) {
      return;
    }

    task.logs.push(line);
    while (task.logs.length > 80) {
      task.logs.shift();
    }
  }
}

interface DashboardTaskContext {
  setStatus: (lines: string[]) => void;
  setSummary: (summary: string) => void;
  log: (message: string) => void;
  shouldStop: () => boolean;
  throwIfStopRequested: () => void;
}

function startDashboardTask(
  request: IncomingMessage,
  response: ServerResponse,
  taskController: DashboardTaskController,
  kind: DashboardTaskKind,
  title: string,
  runner: (context: DashboardTaskContext) => Promise<void>,
): DashboardTaskSnapshot | null {
  try {
    return taskController.start(kind, title, runner);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      if (wantsJsonResponse(request)) {
        respondJson(response, 409, { error: error.message });
      } else {
        respondHtml(response, renderDashboardErrorPage(error.message), 409);
      }
      return null;
    }

    throw error;
  }
}

function wantsJsonResponse(request: IncomingMessage): boolean {
  const accept = request.headers.accept ?? "";
  const requestedWith = request.headers["x-requested-with"] ?? "";
  return accept.includes("application/json") || requestedWith === "fetch";
}

function respondTaskAccepted(
  request: IncomingMessage,
  response: ServerResponse,
  taskId: number,
): void {
  if (wantsJsonResponse(request)) {
    respondJson(response, 202, { ok: true, taskId });
    return;
  }

  response.writeHead(303, {
    location: "/",
    "cache-control": "no-store, max-age=0, must-revalidate",
    pragma: "no-cache",
  });
  response.end();
}

function snapshotTask(task: DashboardTaskSnapshot): DashboardTaskSnapshot {
  return {
    ...task,
    statusLines: [...task.statusLines],
    logs: [...task.logs],
  };
}

async function buildDashboardState(
  origin: string,
  artifactPaths: DashboardArtifactPaths,
  taskController: DashboardTaskController,
): Promise<DashboardStateResponse> {
  const syncCheckpointPath = resolveSyncCheckpointPath(artifactPaths.submissionsPath);
  const syncCheckpoint = await readSyncCheckpoint(syncCheckpointPath);
  const profile = await readOptionalProfileSnapshot(artifactPaths.profilePath);
  const submissions = await readOptionalSubmissionsSnapshot(artifactPaths.submissionsPath);
  const problems = await readProblemListEntries(artifactPaths.problemsDir);
  const submissionsCheckpointPath = resolveDashboardSubmissionsCheckpointPath(
    artifactPaths,
    syncCheckpoint,
    profile?.profile.username || profile?.username || submissions?.username || null,
  );
  const submissionsCheckpoint = submissionsCheckpointPath
    ? await readOptionalSubmissionsCheckpoint(submissionsCheckpointPath)
    : null;
  const resume = buildResumeStates(syncCheckpoint, submissionsCheckpoint, profile, submissions, problems);

  return {
    artifacts: {
      sync: {
        exists: syncCheckpoint !== null,
        path: syncCheckpointPath,
        username: syncCheckpoint?.username ?? null,
        phase: syncCheckpoint ? formatSyncPhase(syncCheckpoint.phase) : null,
        updatedAt: syncCheckpoint?.updatedAt ?? null,
      },
      profile: {
        exists: profile !== null,
        path: artifactPaths.profilePath,
        username: profile?.profile.username || profile?.username || null,
        fetchedAt: profile?.fetchedAt ?? null,
        infoUrl: profile ? `/user/${encodeURIComponent(profile.profile.username || profile.username)}` : null,
        languageUrl: profile
          ? `/user/language/${encodeURIComponent(profile.profile.username || profile.username)}`
          : null,
      },
      submissions: {
        exists: submissions !== null,
        path: artifactPaths.submissionsPath,
        username: submissions?.username ?? null,
        fetchedAt: submissions?.fetchedAt ?? null,
        totalCount: submissions?.totalCount ?? null,
        statusUrl: submissions ? `/status?user_id=${encodeURIComponent(submissions.username)}` : null,
      },
      problems: {
        exists: problems.length > 0,
        path: artifactPaths.problemsDir,
        totalCount: problems.length,
        listUrl: problems.length > 0 ? "/problems" : null,
      },
    },
    resume,
    task: taskController.getCurrentTask(),
  };
}

function buildResumeStates(
  syncCheckpoint: BackupSyncCheckpoint | null,
  submissionsCheckpoint: BojUserSubmissionsCheckpoint | null,
  profile: BojUserSnapshot | null,
  submissions: BojUserSubmissionsSnapshot | null,
  problems: ProblemListEntry[],
): DashboardResumeState[] {
  const results: DashboardResumeState[] = [];

  const syncResume = buildSyncResumeState(syncCheckpoint, submissionsCheckpoint, profile, submissions, problems);
  if (syncResume) {
    results.push(syncResume);
    return results;
  }

  const submissionsResume = buildStandaloneSubmissionsResumeState(submissionsCheckpoint);
  if (submissionsResume) {
    results.push(submissionsResume);
  }

  return results;
}

function buildSyncResumeState(
  syncCheckpoint: BackupSyncCheckpoint | null,
  submissionsCheckpoint: BojUserSubmissionsCheckpoint | null,
  profile: BojUserSnapshot | null,
  submissions: BojUserSubmissionsSnapshot | null,
  problems: ProblemListEntry[],
): DashboardResumeState | null {
  if (!syncCheckpoint) {
    return null;
  }

  const mode = resolveResumeMode(syncCheckpoint);
  const phaseIndex = resolveResumePhaseIndex(mode, syncCheckpoint.phase);
  const totalPhases = mode === "sync" ? 3 : 2;
  const progress = buildResumeProgress(syncCheckpoint, submissionsCheckpoint, profile, submissions, problems);

  return {
    key: "sync-checkpoint",
    kind: mode,
    title: mode === "sync" ? "전체 동기화 이어받기" : "문제 + 제출코드 이어받기",
    username: syncCheckpoint.username,
    updatedAt: syncCheckpoint.updatedAt,
    phase: formatSyncPhase(syncCheckpoint.phase),
    phaseIndex,
    totalPhases,
    progressPercent: progress.percent,
    progressLabel: progress.label,
    note: progress.note,
    submissionLimit: null,
    problemLimit: syncCheckpoint.problemLimit ?? null,
    problemFilter: syncCheckpoint.problemFilter ?? null,
    action: {
      endpoint: mode === "sync" ? "/api/tasks/sync" : "/api/tasks/archive",
      label: mode === "sync" ? "전체 동기화 이어받기" : "문제 + 제출코드 이어받기",
      body: buildResumeActionBody(syncCheckpoint),
    },
  };
}

function buildStandaloneSubmissionsResumeState(
  submissionsCheckpoint: BojUserSubmissionsCheckpoint | null,
): DashboardResumeState | null {
  if (!submissionsCheckpoint) {
    return null;
  }

  return {
    key: "submissions-checkpoint",
    kind: "submissions",
    title: "제출 기록 이어받기",
    username: submissionsCheckpoint.username,
    updatedAt: submissionsCheckpoint.updatedAt,
    phase: "제출 기록 수집",
    phaseIndex: 1,
    totalPhases: 1,
    progressPercent: computeSubmissionProgressPercent(
      submissionsCheckpoint.totalCount,
      submissionsCheckpoint.estimatedTotalCount,
      submissionsCheckpoint.limitCount ?? null,
    ),
    progressLabel: formatSubmissionProgressLabel(
      submissionsCheckpoint.totalCount,
      submissionsCheckpoint.estimatedTotalCount,
      submissionsCheckpoint.limitCount ?? null,
    ),
    note: `페이지 ${formatNumber(submissionsCheckpoint.pagesFetched)} · 마지막 제출 ${formatLastSubmissionLabel(submissionsCheckpoint.rows)}`,
    submissionLimit: submissionsCheckpoint.limitCount ?? null,
    problemLimit: null,
    problemFilter: null,
    action: {
      endpoint: "/api/tasks/submissions",
      label: "제출 기록 이어받기",
      body: buildStandaloneSubmissionsResumeBody(submissionsCheckpoint),
    },
  };
}

function buildResumeProgress(
  syncCheckpoint: BackupSyncCheckpoint,
  submissionsCheckpoint: BojUserSubmissionsCheckpoint | null,
  profile: BojUserSnapshot | null,
  submissions: BojUserSubmissionsSnapshot | null,
  problems: ProblemListEntry[],
): { percent: number; label: string; note: string } {
  if (syncCheckpoint.phase === "profile") {
    return {
      percent: 0,
      label: "프로필부터 재개",
      note: "프로필 JSON부터 다시 수집합니다.",
    };
  }

  if (syncCheckpoint.phase === "submissions") {
    const selection = profile
      ? selectProblemsFromProfile(profile, {
          problemFilter: syncCheckpoint.problemFilter ?? undefined,
          problemLimit: syncCheckpoint.problemLimit ?? undefined,
        })
      : null;
    const completedProblemCount = submissionsCheckpoint?.problemIndex ?? 0;
    const totalProblems =
      submissionsCheckpoint?.problemIds?.length ??
      selection?.totalProblems ??
      0;
    const currentProblemId =
      submissionsCheckpoint?.currentProblemId ??
      (selection && completedProblemCount < selection.problemIds.length
        ? selection.problemIds[completedProblemCount]
        : null);
    return {
      percent: totalProblems > 0 ? Math.max(0, Math.min(100, (completedProblemCount / totalProblems) * 100)) : 0,
      label: totalProblems > 0 ? `${completedProblemCount}/${totalProblems} 문제` : "제출 기록 재개",
      note:
        `${selection?.selectionSummary ?? "프로필 기준 문제 순회"}` +
        ` · 페이지 ${formatNumber(submissionsCheckpoint?.pagesFetched ?? 0)}` +
        ` · 현재 문제 ${currentProblemId === null ? "-" : `#${currentProblemId}`}`,
    };
  }

  if (profile) {
    const selection = selectProblemsFromProfile(profile, {
      problemFilter: syncCheckpoint.problemFilter ?? undefined,
      problemLimit: syncCheckpoint.problemLimit ?? undefined,
    });
    const backedUpProblemIds = new Set(problems.map((entry) => entry.problemId));
    const completedProblems = selection.problemIds.filter((problemId) => backedUpProblemIds.has(problemId)).length;
    const totalProblems = selection.totalProblems;

    return {
      percent: totalProblems > 0 ? Math.max(0, Math.min(100, (completedProblems / totalProblems) * 100)) : 0,
      label: `${completedProblems} / ${totalProblems} 문제`,
      note: selection.selectionSummary,
    };
  }

  return {
    percent: 0,
    label: "문제 단계 재개",
    note: "submissions.json 을 기준으로 문제 백업을 이어서 진행합니다.",
  };
}

function resolveResumeMode(syncCheckpoint: BackupSyncCheckpoint): "sync" | "archive" {
  if (syncCheckpoint.mode === "sync" || syncCheckpoint.mode === "archive") {
    return syncCheckpoint.mode;
  }

  return syncCheckpoint.phase === "profile" ? "sync" : "archive";
}

function resolveResumePhaseIndex(mode: "sync" | "archive", phase: BackupSyncCheckpoint["phase"]): number {
  if (mode === "sync") {
    switch (phase) {
      case "profile":
        return 1;
      case "submissions":
        return 2;
      case "problems":
        return 3;
    }
  }

  return phase === "problems" ? 2 : 1;
}

function buildResumeActionBody(syncCheckpoint: BackupSyncCheckpoint): Record<string, string> {
  const body: Record<string, string> = {
    resume: "on",
  };

  if (syncCheckpoint.problemLimit !== null && syncCheckpoint.problemLimit !== undefined) {
    body.problemLimit = String(syncCheckpoint.problemLimit);
  }
  if (syncCheckpoint.problemFilter) {
    body.problemFilter = syncCheckpoint.problemFilter;
  }

  return body;
}

function buildStandaloneSubmissionsResumeBody(
  submissionsCheckpoint: BojUserSubmissionsCheckpoint,
): Record<string, string> {
  const body: Record<string, string> = {
    resume: "on",
  };

  if (submissionsCheckpoint.limitCount !== null && submissionsCheckpoint.limitCount !== undefined) {
    body.submissionLimit = String(submissionsCheckpoint.limitCount);
  }

  return body;
}

function resolveDashboardSubmissionsCheckpointPath(
  artifactPaths: DashboardArtifactPaths,
  syncCheckpoint: BackupSyncCheckpoint | null,
  username: string | null,
): string | null {
  if (syncCheckpoint?.submissionsCheckpointPath) {
    return syncCheckpoint.submissionsCheckpointPath;
  }

  if (artifactPaths.submissionsPath) {
    return addPathSuffix(path.resolve(artifactPaths.submissionsPath), ".checkpoint");
  }

  if (username) {
    return resolveSubmissionsCheckpointPath(username, undefined, undefined);
  }

  return null;
}

async function readOptionalSubmissionsCheckpoint(
  checkpointPath: string,
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

  return parsed;
}

function computeSubmissionProgressPercent(
  rowsFetched: number,
  estimatedTotalCount: number | null,
  limitCount: number | null,
): number {
  if (limitCount && limitCount > 0) {
    return Math.max(0, Math.min(100, (rowsFetched / limitCount) * 100));
  }

  if (estimatedTotalCount && estimatedTotalCount > 0) {
    return Math.max(0, Math.min(100, (rowsFetched / estimatedTotalCount) * 100));
  }

  return 0;
}

function formatLastSubmissionLabel(rows: BojUserSubmissionsCheckpoint["rows"]): string {
  const lastSubmissionId = rows.length > 0 ? rows.at(-1)?.[0] ?? null : null;
  return lastSubmissionId === null ? "-" : `#${lastSubmissionId}`;
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

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await readFile(targetPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function readProblemListEntries(problemsDir: string): Promise<ProblemListEntry[]> {
  let entries;
  try {
    entries = await readdir(problemsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: ProblemListEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const problemId = Number.parseInt(entry.name, 10);
    if (!Number.isInteger(problemId)) {
      continue;
    }

    const metaPath = path.join(problemsDir, entry.name, "meta.json");
    let meta: ProblemBackupMeta | null = null;
    try {
      const raw = await readFile(metaPath, "utf8");
      meta = JSON.parse(raw) as ProblemBackupMeta;
    } catch {
      meta = null;
    }

    results.push({
      problemId,
      title: meta?.title ?? null,
      tierLevel: meta?.tierLevel ?? null,
      tierLabel: meta?.tierLabel ?? null,
      submissionCount: meta?.submissionCount ?? null,
      tagNames: buildProblemTagNames(meta),
      tagAliases: buildProblemTagAliases(meta),
      problemUrl: `/problems/${problemId}`,
    });
  }

  return results.sort((left, right) => right.problemId - left.problemId);
}

function buildProblemTagNames(meta: ProblemBackupMeta | null): string[] {
  if (!meta?.tags || !Array.isArray(meta.tags)) {
    return [];
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const tag of meta.tags) {
    const preferredDisplayName =
      tag.displayNames.find((displayName) => displayName.language === "ko")?.short ||
      tag.displayNames.find((displayName) => displayName.language === "ko")?.name ||
      tag.displayNames.find((displayName) => displayName.language === "en")?.short ||
      tag.displayNames.find((displayName) => displayName.language === "en")?.name ||
      tag.key;
    if (!preferredDisplayName) {
      continue;
    }

    const normalized = normalizeProblemSearchToken(preferredDisplayName);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    names.push(preferredDisplayName);
  }

  return names;
}

function buildProblemTagAliases(meta: ProblemBackupMeta | null): string[] {
  if (!meta?.tags || !Array.isArray(meta.tags)) {
    return [];
  }

  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const tag of meta.tags) {
    const candidates = [
      tag.key,
      ...(Array.isArray(tag.aliases) ? tag.aliases : []),
      ...tag.displayNames.flatMap((displayName) => [displayName.name, displayName.short ?? ""]),
    ];

    for (const candidate of candidates) {
      const normalized = normalizeProblemSearchToken(candidate);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      aliases.push(normalized);
    }
  }

  return aliases;
}

async function readOptionalProblemSubmissionHistory(
  problemDir: string,
): Promise<ProblemSubmissionHistorySnapshot | null> {
  const submissionsPath = path.join(problemDir, "submissions.json");

  try {
    const raw = await readFile(submissionsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isProblemSubmissionHistorySnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isProblemSubmissionHistorySnapshot(
  value: unknown,
): value is ProblemSubmissionHistorySnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const snapshot = value as Partial<ProblemSubmissionHistorySnapshot>;
  return (
    snapshot.kind === "boj-problem-submissions" &&
    snapshot.version === 1 &&
    typeof snapshot.username === "string" &&
    typeof snapshot.problemId === "number" &&
    typeof snapshot.sourceUrl === "string" &&
    Array.isArray(snapshot.columns) &&
    Array.isArray(snapshot.rows)
  );
}

function convertProblemSubmissionHistoryToSnapshot(
  snapshot: ProblemSubmissionHistorySnapshot,
): BojUserSubmissionsSnapshot {
  return {
    username: snapshot.username,
    fetchedAt: snapshot.fetchedAt,
    sourceUrl: snapshot.sourceUrl,
    mode: "problem-status",
    limitCount: null,
    estimatedTotalCount: null,
    problemIds: [snapshot.problemId],
    availableProblemCount: 1,
    selectionSummary: `문제 번호 ${snapshot.problemId}`,
    totalCount: snapshot.totalCount,
    pagesFetched: 1,
    columns: snapshot.columns,
    rows: snapshot.rows,
  };
}

const PROBLEM_SUBMISSION_ROW_INDEX = {
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
} as const;

async function readProblemSubmissionView(
  problemDir: string,
  problemId: number,
  submissionId: number,
): Promise<{
  username: string;
  problemId: number;
  problemTitle: string | null;
  submissionId: number;
  result: string;
  resultClass: string | null;
  memoryKb: number | null;
  timeMs: number | null;
  language: string;
  codeLength: number | null;
  submittedAt: string | null;
  code: string;
  problemUrl: string;
  submissionsUrl: string;
  previousSubmissionUrl: string | null;
  nextSubmissionUrl: string | null;
} | null> {
  const submissions = await readOptionalProblemSubmissionHistory(problemDir);
  if (!submissions) {
    return null;
  }

  const meta = await readOptionalProblemBackupMeta(problemDir);
  if (!meta) {
    return null;
  }

  const submissionIndex = submissions.rows.findIndex(
    (row) => row[PROBLEM_SUBMISSION_ROW_INDEX.submissionId] === submissionId,
  );
  if (submissionIndex === -1) {
    return null;
  }

  const row = submissions.rows[submissionIndex];
  const sourceEntry = meta.sourceFiles.find((entry) => entry.submissionId === submissionId);
  if (!sourceEntry) {
    return null;
  }

  const sourcePath = path.join(problemDir, meta.sourcesDir, sourceEntry.fileName);
  let code: string;
  try {
    code = await readFile(sourcePath, "utf8");
  } catch {
    return null;
  }

  const previousSubmissionId =
    submissionIndex > 0
      ? submissions.rows[submissionIndex - 1]?.[PROBLEM_SUBMISSION_ROW_INDEX.submissionId] ?? null
      : null;
  const nextSubmissionId =
    submissionIndex + 1 < submissions.rows.length
      ? submissions.rows[submissionIndex + 1]?.[PROBLEM_SUBMISSION_ROW_INDEX.submissionId] ?? null
      : null;
  const submissionsUrl = `/problems/${problemId}/submissions`;

  return {
    username: submissions.username,
    problemId,
    problemTitle: submissions.title,
    submissionId,
    result: row[PROBLEM_SUBMISSION_ROW_INDEX.result],
    resultClass: row[PROBLEM_SUBMISSION_ROW_INDEX.resultClass],
    memoryKb: row[PROBLEM_SUBMISSION_ROW_INDEX.memoryKb],
    timeMs: row[PROBLEM_SUBMISSION_ROW_INDEX.timeMs],
    language: sourceEntry.language || row[PROBLEM_SUBMISSION_ROW_INDEX.language] || "",
    codeLength: row[PROBLEM_SUBMISSION_ROW_INDEX.codeLength],
    submittedAt: row[PROBLEM_SUBMISSION_ROW_INDEX.submittedAt],
    code,
    problemUrl: `/problems/${problemId}`,
    submissionsUrl,
    previousSubmissionUrl: previousSubmissionId === null ? null : `${submissionsUrl}/${previousSubmissionId}`,
    nextSubmissionUrl: nextSubmissionId === null ? null : `${submissionsUrl}/${nextSubmissionId}`,
  };
}

async function readOptionalProblemBackupMeta(problemDir: string): Promise<ProblemBackupMeta | null> {
  const metaPath = path.join(problemDir, "meta.json");
  try {
    const raw = await readFile(metaPath, "utf8");
    return JSON.parse(raw) as ProblemBackupMeta;
  } catch {
    return null;
  }
}

function rewriteProblemDetailHtml(
  html: string,
  options: {
    problemId: number;
    problemUrl: string;
    submissionsUrl: string;
  },
): string {
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] ?? "";
  const $ = load(html);

  $("ul.problem-menu").each((_, element) => {
    const menu = $(element);
    const problemAnchor = menu.find("li").first().find("a").first();
    const problemLabelHtml = problemAnchor.html()?.trim() || `${options.problemId}번`;

    menu.empty();
    menu.append(
      $("<li>")
        .addClass("active")
        .append($("<a>").attr("href", options.problemUrl).html(problemLabelHtml)),
    );
    menu.append(
      $("<li>").append(
        $("<a>").attr("href", options.submissionsUrl).text("내 제출"),
      ),
    );
  });

  const rendered = $.html();
  return doctype ? `${doctype}\n${rendered}` : rendered;
}

interface ParsedProblemSearchQuery {
  raw: string;
  textTerms: string[];
  tagTerms: string[];
  tierTerms: string[];
}

function filterProblemListEntries(entries: ProblemListEntry[], query: string): ProblemListEntry[] {
  const parsed = parseProblemSearchQuery(query);
  if (!parsed.raw) {
    return entries;
  }

  return entries.filter((entry) => matchesProblemSearchQuery(entry, parsed));
}

function parseProblemSearchQuery(query: string): ParsedProblemSearchQuery {
  const raw = query.trim();
  if (!raw) {
    return {
      raw: "",
      textTerms: [],
      tagTerms: [],
      tierTerms: [],
    };
  }

  const textTerms: string[] = [];
  const tagTerms: string[] = [];
  const tierTerms: string[] = [];
  const tokens = raw.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const separatorIndex = token.indexOf(":");
    if (separatorIndex <= 0) {
      const normalized = normalizeProblemSearchToken(token);
      if (normalized) {
        textTerms.push(normalized);
      }
      continue;
    }

    const key = token.slice(0, separatorIndex).toLowerCase();
    const value = normalizeProblemSearchToken(token.slice(separatorIndex + 1));
    if (!value) {
      continue;
    }

    if (key === "tag") {
      tagTerms.push(value);
      continue;
    }

    if (key === "tier") {
      tierTerms.push(value);
      continue;
    }

    textTerms.push(normalizeProblemSearchToken(token));
  }

  return {
    raw,
    textTerms,
    tagTerms,
    tierTerms,
  };
}

function matchesProblemSearchQuery(
  entry: ProblemListEntry,
  query: ParsedProblemSearchQuery,
): boolean {
  const searchFields = [
    normalizeProblemSearchToken(String(entry.problemId)),
    normalizeProblemSearchToken(entry.title ?? ""),
    normalizeProblemSearchToken(entry.tierLabel ?? ""),
    ...entry.tagAliases,
    ...entry.tagNames.map((tagName) => normalizeProblemSearchToken(tagName)),
  ].filter(Boolean);

  for (const textTerm of query.textTerms) {
    if (!searchFields.some((field) => field.includes(textTerm))) {
      return false;
    }
  }

  if (query.tagTerms.length > 0) {
    for (const tagTerm of query.tagTerms) {
      if (!entry.tagAliases.some((alias) => alias.includes(tagTerm))) {
        return false;
      }
    }
  }

  if (query.tierTerms.length > 0) {
    const tierTokens = buildProblemTierSearchTokens(entry);
    for (const tierTerm of query.tierTerms) {
      if (!tierTokens.some((token) => token.includes(tierTerm))) {
        return false;
      }
    }
  }

  return true;
}

function buildProblemTierSearchTokens(entry: ProblemListEntry): string[] {
  const tokens = new Set<string>();

  if (entry.tierLabel) {
    const normalizedTierLabel = normalizeProblemSearchToken(entry.tierLabel);
    if (normalizedTierLabel) {
      tokens.add(normalizedTierLabel);
    }
  }

  if (entry.tierLevel !== null) {
    const code = convertTierLevelToCode(entry.tierLevel);
    if (code) {
      tokens.add(code);
    }
  }

  return [...tokens];
}

function convertTierLevelToCode(tierLevel: number): string | null {
  if (tierLevel >= 1 && tierLevel <= 5) {
    return `b${6 - tierLevel}`;
  }
  if (tierLevel >= 6 && tierLevel <= 10) {
    return `s${11 - tierLevel}`;
  }
  if (tierLevel >= 11 && tierLevel <= 15) {
    return `g${16 - tierLevel}`;
  }
  if (tierLevel >= 16 && tierLevel <= 20) {
    return `p${21 - tierLevel}`;
  }
  if (tierLevel >= 21 && tierLevel <= 25) {
    return `d${26 - tierLevel}`;
  }
  if (tierLevel >= 26 && tierLevel <= 30) {
    return `r${31 - tierLevel}`;
  }

  return null;
}

function normalizeProblemSearchToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[_-]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

async function readFormBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return new URLSearchParams(body);
}

function resolveOpenLocationPath(
  key: string,
  artifactPaths: DashboardArtifactPaths,
): string | null {
  switch (key) {
    case "sync":
      return path.dirname(resolveSyncCheckpointPath(artifactPaths.submissionsPath));
    case "profile":
      return path.dirname(artifactPaths.profilePath);
    case "submissions":
      return path.dirname(artifactPaths.submissionsPath);
    case "problems":
      return artifactPaths.problemsDir;
    default:
      return null;
  }
}

async function ensureOpenLocationExists(targetPath: string): Promise<void> {
  await mkdir(path.resolve(targetPath), { recursive: true });
}

async function openPathInFileManager(targetPath: string): Promise<void> {
  const command =
    process.platform === "win32"
      ? "explorer.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [targetPath], {
      detached: true,
      stdio: "ignore",
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function parseDelayParam(value: string | null): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed) || parsed < 2) {
    return 3;
  }

  return parsed;
}

function parseOptionalPositiveInteger(value: string | null): number | null {
  const source = value?.trim() || "";
  if (!source) {
    return null;
  }

  const parsed = Number.parseInt(source, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigurationError(`Invalid positive integer: ${source}`);
  }

  return parsed;
}

function createClient(config: AppConfig, delaySeconds?: number): BojSessionClient {
  return new BojSessionClient({
    baseUrl: config.baseUrl,
    credentials: {
      userId: config.bojId ?? "",
      password: config.bojPassword ?? "",
    },
    userAgent: config.userAgent,
    requestDelayMs: delaySeconds ? Math.round(delaySeconds * 1000) : config.requestDelayMs,
    requestJitterMs: config.requestJitterMs,
    backoffScheduleMs: config.backoffScheduleMs,
  });
}

async function authenticateClient(
  client: BojSessionClient,
  config: AppConfig,
): Promise<string> {
  const auth = await authenticateBojClient(client, config);
  return auth.username;
}

async function writeJsonFile(outputPath: string, value: unknown): Promise<void> {
  const absolutePath = path.resolve(outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp-${process.pid}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(absolutePath, { force: true });
  await rename(tempPath, absolutePath);
}

async function removeFileIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

async function readSubmissionsCheckpoint(
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

function resolveSubmissionsCheckpointPath(
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

function addPathSuffix(filePath: string, suffix: string): string {
  const parsed = path.parse(filePath);
  const extension = parsed.ext || ".json";
  const basename = parsed.ext ? parsed.name : parsed.base;
  return path.join(parsed.dir, `${basename}${suffix}${extension}`);
}

function isNodeError(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
}

function formatSubmissionsStatusLines(
  progress: BojUserSubmissionFetchProgress,
  estimatedTotalCount: number | null,
  _outputPath: string,
): string[] {
  const lines: string[] = [];

  if (
    progress.selectedProblemCount !== null &&
    progress.selectedProblemCount !== undefined &&
    progress.completedProblemCount !== null &&
    progress.completedProblemCount !== undefined
  ) {
    lines.push(`진행: ${progress.completedProblemCount}/${progress.selectedProblemCount}`);
    lines.push(`선택 문제: ${formatNumber(progress.selectedProblemCount)}`);
    lines.push(`문제 진행: ${progress.completedProblemCount}/${progress.selectedProblemCount}`);
    lines.push(`현재 문제: ${progress.currentProblemId === null || progress.currentProblemId === undefined ? "-" : `#${progress.currentProblemId}`}`);
  }

  return [
    ...lines,
    `페이지: ${progress.pagesFetched}`,
    `행 수: ${formatSubmissionProgressLabel(progress.rowsFetched, estimatedTotalCount, progress.limitCount)}`,
    `마지막 제출: ${progress.lastSubmissionId ? `#${progress.lastSubmissionId}` : "-"}`,
    `다음 딜레이: ${formatRateLimitLabel(
      progress.nextDelayMs,
      progress.delayReason,
      progress.backoffAttempt,
    )}`,
    "제출 JSON 저장 중",
  ];
}

function formatSyncStageStatusLines(
  progress: BackupSyncStageProgress,
  problemFilter?: string,
  problemLimit?: number | null,
): string[] {
  return [
    `단계: ${progress.phaseIndex}/${progress.totalPhases} ${formatSyncPhase(progress.phase)}`,
    `사용자: ${progress.username}`,
    "프로필 JSON: 준비",
    "제출 JSON: 준비",
    "문제 디렉터리: 준비",
    `문제 필터: ${problemFilter || "전체"}`,
    `문제 수 제한: ${problemLimit === null || problemLimit === undefined ? "없음" : formatNumber(problemLimit)}`,
    "sync 체크포인트: 사용 중",
  ];
}

function formatArchiveStageStatusLines(
  progress: BackupSyncStageProgress,
  problemFilter?: string,
  problemLimit?: number | null,
): string[] {
  return [
    `단계: ${progress.phaseIndex}/${progress.totalPhases} ${formatSyncPhase(progress.phase)}`,
    `사용자: ${progress.username}`,
    `프로필 JSON: 사용`,
    `제출 JSON: 준비`,
    `문제 디렉터리: 준비`,
    `문제 필터: ${problemFilter || "전체"}`,
    `문제 수 제한: ${problemLimit === null || problemLimit === undefined ? "없음" : formatNumber(problemLimit)}`,
    "archive 체크포인트: 사용 중",
  ];
}

function formatSyncSubmissionsStatusLines(
  progress: BojUserSubmissionFetchProgress,
  outputPath: string,
  _checkpointPath: string,
  problemFilter?: string,
  problemLimit?: number | null,
): string[] {
  return [
    "단계: 2/3 제출 기록 수집",
    `문제 필터: ${problemFilter || "전체"}`,
    `문제 수 제한: ${problemLimit === null || problemLimit === undefined ? "없음" : formatNumber(problemLimit)}`,
    ...formatSubmissionsStatusLines(progress, progress.estimatedTotalCount, outputPath),
    "sync 체크포인트: 사용 중",
  ];
}

function formatArchiveSubmissionsStatusLines(
  progress: BojUserSubmissionFetchProgress,
  outputPath: string,
  problemFilter?: string,
  problemLimit?: number | null,
): string[] {
  return [
    "단계: 1/2 제출 기록 수집",
    `문제 필터: ${problemFilter || "전체"}`,
    `문제 수 제한: ${problemLimit === null || problemLimit === undefined ? "없음" : formatNumber(problemLimit)}`,
    ...formatSubmissionsStatusLines(progress, progress.estimatedTotalCount, outputPath),
    "archive 체크포인트: 사용 중",
  ];
}

function formatSubmissionsLogLine(progress: BojUserSubmissionFetchProgress): string {
  if (
    progress.selectedProblemCount !== null &&
    progress.selectedProblemCount !== undefined &&
    progress.completedProblemCount !== null &&
    progress.completedProblemCount !== undefined
  ) {
    return (
      `문제 ${progress.completedProblemCount}/${progress.selectedProblemCount}` +
      (progress.currentProblemId === null || progress.currentProblemId === undefined
        ? ""
        : ` (#${progress.currentProblemId})`) +
      `, page ${progress.pagesFetched}, rows ${progress.rowsFetched}` +
      (progress.lastSubmissionId ? `, last #${progress.lastSubmissionId}` : "")
    );
  }

  return (
    `page ${progress.pagesFetched} 완료, rows ${progress.rowsFetched}` +
    (progress.limitCount !== null ? `/${progress.limitCount}` : "") +
    (progress.lastSubmissionId ? `, last #${progress.lastSubmissionId}` : "")
  );
}

function formatProblemStatusLines(
  progress: ProblemBackupProgress,
  _outputDir: string,
): string[] {
  const problemLabel =
    progress.currentProblemId === null
      ? "-"
      : `#${progress.currentProblemId}${progress.currentProblemTitle ? ` (${progress.currentProblemTitle})` : ""}`;

  return [
    `문제 선택: ${progress.selectionSummary}`,
    `대상 문제: ${progress.totalProblems}/${progress.availableProblems}`,
    `진행: ${progress.completedProblems}/${progress.totalProblems} (saved ${progress.savedProblems}, skipped ${progress.skippedProblems})`,
    `현재 문제: ${problemLabel}`,
    `현재 단계: ${formatProblemPhase(progress.phase)}`,
    `문제별 제출 수: ${progress.currentSubmissionCount === null ? "-" : formatNumber(progress.currentSubmissionCount)}`,
    `코드 다운로드: ${formatProblemSourceStatus(progress)}`,
    `다음 딜레이: ${formatRateLimitLabel(
      progress.nextDelayMs,
      progress.delayReason,
      progress.backoffAttempt,
    )}`,
    "문제 폴더 저장 중",
  ];
}

function formatSyncProblemStatusLines(
  progress: ProblemBackupProgress,
  outputDir: string,
  _checkpointPath: string,
): string[] {
  return [
    "단계: 3/3 문제 백업",
    ...formatProblemStatusLines(progress, outputDir),
    "sync 체크포인트: 사용 중",
  ];
}

function formatArchiveProblemStatusLines(
  progress: ProblemBackupProgress,
  outputDir: string,
): string[] {
  return [
    "단계: 2/2 문제 백업",
    ...formatProblemStatusLines(progress, outputDir),
    "archive 체크포인트: 사용 중",
  ];
}

function formatProblemLogLine(progress: ProblemBackupProgress): string {
  if (progress.currentProblemId === null) {
    return `초기화: selected ${progress.totalProblems}/${progress.availableProblems}, filter ${progress.selectionSummary}, existing ${progress.knownExistingProblems}`;
  }

  const label = `#${progress.currentProblemId}${progress.currentProblemTitle ? ` (${progress.currentProblemTitle})` : ""}`;
  switch (progress.phase) {
    case "init":
      return `초기화: selected ${progress.totalProblems}/${progress.availableProblems}, filter ${progress.selectionSummary}, existing ${progress.knownExistingProblems}`;
    case "skip-existing":
      return `${label} skip`;
    case "fetch-problem-page":
      return `${label} 문제 다운로드 시작`;
    case "fetch-problem-metadata":
      return `${label} solved.ac 메타 다운로드 시작`;
    case "fetch-submission-sources":
      return `${label} 제출 코드 다운로드 ${formatProblemSourceStatus(progress)}`;
    case "write-problem-files":
      return `${label} 파일 저장 중`;
    case "problem-complete":
      return `${label} 완료`;
  }
}

function formatProblemPhase(phase: ProblemBackupProgress["phase"]): string {
  switch (phase) {
    case "init":
      return "초기화";
    case "skip-existing":
      return "기존 문제 건너뜀";
    case "fetch-problem-page":
      return "문제 다운로드";
    case "fetch-problem-metadata":
      return "solved.ac 메타 다운로드";
    case "fetch-submission-sources":
      return "제출 코드 다운로드";
    case "write-problem-files":
      return "문제 폴더 저장";
    case "problem-complete":
      return "완료";
  }
}

function formatProblemSourceStatus(progress: ProblemBackupProgress): string {
  if (
    progress.currentSourceIndex === null ||
    progress.totalSourceFiles === null ||
    progress.currentSubmissionId === null
  ) {
    return "-";
  }

  return `${progress.currentSourceIndex}/${progress.totalSourceFiles} (#${progress.currentSubmissionId})`;
}

function renderDashboardPage(
  state: DashboardStateResponse,
  artifactPaths: DashboardArtifactPaths,
): string {
  const profileUrl = state.artifacts.profile.infoUrl ?? "https://www.acmicpc.net/user";
  const languageUrl = state.artifacts.profile.languageUrl ?? "https://www.acmicpc.net/user/language";
  const statusUrl = state.artifacts.submissions.statusUrl ?? "https://www.acmicpc.net/status";
  const problemsUrl = state.artifacts.problems.listUrl ?? "/problems";

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BOJ Backup Dashboard</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.2.0/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/unify/css/style.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/css/connect.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/css/result.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/css/label.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/unify/css/custom.css?version=20240112">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.6.3/css/font-awesome.css">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/unify/css/theme-colors/blue.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/css/fa-color.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/css/user_info.css?version=20240112">
  <link href="https://fonts.googleapis.com/css?family=Noto+Sans+KR:400,700|Open+Sans:400,400i,700,700i|Source+Code+Pro&amp;subset=korean" rel="stylesheet">
  <style>
    :root {
      --boj-text-main: #333;
      --boj-text-muted: #555;
      --boj-text-subtle: #777;
      --boj-link: #0076c0;
      --boj-border: #ddd;
      --boj-panel: #fff;
      --boj-soft-bg: #fafafa;
    }
    body {
      background: #fff;
      color: var(--boj-text-main);
    }
    a,
    a:hover,
    a:focus,
    a:active {
      color: var(--boj-link);
    }
    p, li, th, td, blockquote, .dashboard-subtitle, .dashboard-note, .dashboard-empty {
      color: var(--boj-text-muted);
    }
    .dashboard-nav .navbar-nav > li > a {
      padding-left: 14px;
      padding-right: 14px;
    }
    .dashboard-nav-note {
      margin-left: 10px;
      font-size: 12px;
      color: var(--boj-text-subtle);
    }
    .dashboard-page-header {
      margin-bottom: 20px;
    }
    .dashboard-page-header h1 {
      margin-bottom: 8px;
    }
    .dashboard-subtitle {
      display: block;
      margin-bottom: 12px;
    }
    .dashboard-section-gap {
      margin-bottom: 20px;
    }
    .dashboard-form .form-group {
      margin-bottom: 14px;
    }
    .dashboard-form label {
      display: block;
      margin-bottom: 4px;
      color: var(--boj-text-subtle);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .dashboard-form .checkbox {
      margin-top: 0;
      margin-bottom: 10px;
    }
    .dashboard-form .checkbox label {
      text-transform: none;
      letter-spacing: 0;
      font-size: 13px;
      color: var(--boj-text-muted);
    }
    .dashboard-note-box {
      border: 1px solid var(--boj-border);
      background: var(--boj-soft-bg);
      border-radius: 4px;
      padding: 12px 14px;
      margin-bottom: 14px;
    }
    .dashboard-note-box strong {
      display: block;
      color: var(--boj-text-main);
      margin-bottom: 4px;
    }
    .dashboard-flow {
      padding-left: 18px;
      margin-bottom: 0;
    }
    .dashboard-flow li {
      margin-bottom: 6px;
    }
    .dashboard-stat-card {
      border: 1px solid var(--boj-border);
      border-radius: 4px;
      padding: 14px 16px;
      background: var(--boj-panel);
      min-height: 104px;
    }
    .dashboard-stat-label {
      color: var(--boj-text-subtle);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .dashboard-stat-value {
      display: block;
      margin-top: 8px;
      color: var(--boj-text-main);
      font-size: 26px;
      font-weight: 700;
      line-height: 1.2;
    }
    .dashboard-stat-note {
      display: block;
      margin-top: 6px;
      font-size: 12px;
      color: var(--boj-text-muted);
      word-break: break-word;
    }
    .dashboard-summary-table th {
      width: 34%;
      white-space: nowrap;
    }
    .dashboard-artifact-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .dashboard-artifact-card {
      border: 1px solid var(--boj-border);
      border-top-width: 3px;
      border-radius: 4px;
      background: var(--boj-panel);
      padding: 14px 16px;
      min-height: 176px;
    }
    .dashboard-artifact-card.sync { border-top-color: #f0ad4e; }
    .dashboard-artifact-card.profile { border-top-color: #5bc0de; }
    .dashboard-artifact-card.submissions { border-top-color: #337ab7; }
    .dashboard-artifact-card.problems { border-top-color: #5cb85c; }
    .dashboard-artifact-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
    }
    .dashboard-artifact-head h4 {
      margin: 0;
      font-size: 16px;
      color: var(--boj-text-main);
    }
    .dashboard-artifact-flag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: 700;
    }
    .dashboard-artifact-flag.ready {
      background: #dff0d8;
      color: #3c763d;
    }
    .dashboard-artifact-flag.empty {
      background: #f5f5f5;
      color: #777;
    }
    .dashboard-artifact-value {
      display: block;
      margin: 14px 0 6px;
      font-size: 24px;
      font-weight: 700;
      color: var(--boj-text-main);
      line-height: 1.2;
    }
    .dashboard-artifact-meta {
      min-height: 38px;
      font-size: 12px;
      color: var(--boj-text-muted);
      word-break: break-word;
    }
    .dashboard-link-row {
      margin-top: 12px;
    }
    .dashboard-link-row .btn {
      margin-right: 8px;
      margin-bottom: 8px;
    }
    .dashboard-btn-primary {
      background: #3498db;
      border-color: #2980b9;
      color: #fff !important;
    }
    .dashboard-btn-primary:hover,
    .dashboard-btn-primary:focus {
      background: #2980b9;
      border-color: #2471a3;
      color: #fff !important;
    }
    .dashboard-status-badge {
      display: inline-block;
      padding: 4px 9px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 700;
      vertical-align: middle;
    }
    .dashboard-status-badge.idle {
      background: #f5f5f5;
      color: #777;
    }
    .dashboard-status-badge.running {
      background: #d9edf7;
      color: #31708f;
    }
    .dashboard-status-badge.stopping {
      background: #fcf8e3;
      color: #8a6d3b;
    }
    .dashboard-status-badge.stopped {
      background: #f5f5f5;
      color: #6d5d46;
    }
    .dashboard-status-badge.completed {
      background: #dff0d8;
      color: #3c763d;
    }
    .dashboard-status-badge.failed {
      background: #f2dede;
      color: #a94442;
    }
    .dashboard-task-title {
      margin: 12px 0 6px;
      font-size: 22px;
      color: var(--boj-text-main);
    }
    .dashboard-task-meta {
      margin-bottom: 12px;
      font-size: 12px;
      color: var(--boj-text-muted);
    }
    .dashboard-step-visual {
      margin-bottom: 16px;
    }
    .dashboard-stepper {
      display: flex;
      flex-wrap: wrap;
      align-items: stretch;
      gap: 0;
      margin: 0 0 12px;
    }
    .dashboard-step {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-width: 180px;
      flex: 1 1 180px;
      padding: 10px 12px;
      border: 1px solid var(--boj-border);
      background: #fff;
      border-radius: 4px;
    }
    .dashboard-step.pending {
      background: #fafafa;
      border-color: #e5e5e5;
    }
    .dashboard-step.active {
      border-color: #9ec5e5;
      background: #f3f8fc;
      box-shadow: inset 0 0 0 1px #d9edf7;
    }
    .dashboard-step.completed {
      border-color: #b2dba1;
      background: #f3faf1;
    }
    .dashboard-step.failed {
      border-color: #e4b9b9;
      background: #fcf4f4;
    }
    .dashboard-step.stopped {
      border-color: #e8d39c;
      background: #fffaf0;
    }
    .dashboard-step-connector {
      flex: 0 0 18px;
      align-self: center;
      height: 1px;
      background: #d9d9d9;
      margin: 0 4px;
    }
    .dashboard-step-icon {
      display: inline-flex;
      width: 24px;
      height: 24px;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      border: 1px solid #d5d5d5;
      color: #8d8d8d;
      background: #fff;
      font-size: 12px;
      flex: 0 0 24px;
      margin-top: 1px;
    }
    .dashboard-step.active .dashboard-step-icon {
      color: #31708f;
      border-color: #9ec5e5;
    }
    .dashboard-step.completed .dashboard-step-icon {
      color: #3c763d;
      border-color: #b2dba1;
    }
    .dashboard-step.failed .dashboard-step-icon {
      color: #a94442;
      border-color: #e4b9b9;
    }
    .dashboard-step.stopped .dashboard-step-icon {
      color: #8a6d3b;
      border-color: #e8d39c;
    }
    .dashboard-step-body {
      min-width: 0;
    }
    .dashboard-step-label {
      display: block;
      color: var(--boj-text-main);
      font-size: 13px;
      font-weight: 700;
      line-height: 1.3;
    }
    .dashboard-step-note {
      display: block;
      margin-top: 3px;
      color: var(--boj-text-muted);
      font-size: 12px;
      line-height: 1.4;
      word-break: break-word;
    }
    .dashboard-checklist {
      border: 1px solid var(--boj-border);
      border-radius: 4px;
      background: var(--boj-soft-bg);
      padding: 12px 14px;
    }
    .dashboard-checklist-title {
      margin: 0 0 10px;
      font-size: 13px;
      color: var(--boj-text-main);
    }
    .dashboard-checklist-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .dashboard-checklist-item {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }
    .dashboard-checklist-item + .dashboard-checklist-item {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #ececec;
    }
    .dashboard-check-icon {
      display: inline-flex;
      width: 20px;
      height: 20px;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      border: 1px solid #d5d5d5;
      color: #8d8d8d;
      background: #fff;
      font-size: 11px;
      flex: 0 0 20px;
      margin-top: 1px;
    }
    .dashboard-checklist-item.active .dashboard-check-icon {
      color: #31708f;
      border-color: #9ec5e5;
    }
    .dashboard-checklist-item.completed .dashboard-check-icon {
      color: #3c763d;
      border-color: #b2dba1;
    }
    .dashboard-checklist-item.failed .dashboard-check-icon {
      color: #a94442;
      border-color: #e4b9b9;
    }
    .dashboard-checklist-item.stopped .dashboard-check-icon {
      color: #8a6d3b;
      border-color: #e8d39c;
    }
    .dashboard-check-content {
      min-width: 0;
    }
    .dashboard-check-label {
      display: block;
      color: var(--boj-text-main);
      font-size: 13px;
      line-height: 1.3;
    }
    .dashboard-check-note {
      display: block;
      margin-top: 2px;
      color: var(--boj-text-muted);
      font-size: 12px;
      line-height: 1.4;
      word-break: break-word;
    }
    .dashboard-progress-meta {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
      font-size: 12px;
      color: var(--boj-text-muted);
    }
    .dashboard-progress .progress {
      height: 10px;
      margin-bottom: 14px;
    }
    .dashboard-status-table th {
      width: 28%;
      color: var(--boj-text-subtle);
    }
    .dashboard-log-panel {
      max-height: 420px;
      overflow: auto;
    }
    .dashboard-log-list {
      margin-bottom: 0;
    }
    .dashboard-log-list .list-group-item {
      font-family: "Source Code Pro", monospace;
      font-size: 12px;
      white-space: pre-wrap;
      color: var(--boj-text-main);
    }
    .dashboard-empty {
      color: var(--boj-text-subtle);
      font-style: italic;
    }
    @media (max-width: 767px) {
      .dashboard-artifact-grid {
        grid-template-columns: 1fr;
      }
      .dashboard-nav-note {
        display: none;
      }
      .dashboard-task-controls {
        margin-top: 10px;
      }
      .dashboard-step {
        min-width: 100%;
      }
      .dashboard-step-connector {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header no-print">
      <div class="topbar">
        <div class="container">
          <ul class="loginbar pull-right">
            <li><a href="https://www.acmicpc.net/register" target="_blank" rel="noreferrer">회원가입</a></li>
            <li class="topbar-devider"></li>
            <li><a href="https://www.acmicpc.net/login" target="_blank" rel="noreferrer">로그인</a></li>
          </ul>
        </div>
      </div>
      <div class="navbar navbar-default mega-menu dashboard-nav" role="navigation">
        <div class="container">
          <div class="navbar-header">
            <a class="navbar-brand" href="/">
              <img id="logo-header" src="https://d2gd6pc034wcta.cloudfront.net/images/logo@2x.png" alt="Logo" data-retina>
            </a>
          </div>
          <div class="collapse navbar-collapse navbar-responsive-collapse">
            <ul class="nav navbar-nav">
              <li><a href="https://www.acmicpc.net/problemset" target="_blank" rel="noreferrer">문제</a></li>
              <li><a href="https://www.acmicpc.net/workbook/top" target="_blank" rel="noreferrer">문제집</a></li>
              <li><a href="${escapeHtml(statusUrl)}"${state.artifacts.submissions.exists ? "" : ' target="_blank" rel="noreferrer"'}>채점 현황</a></li>
              <li><a href="${escapeHtml(profileUrl)}"${state.artifacts.profile.exists ? "" : ' target="_blank" rel="noreferrer"'}>프로필</a></li>
              <li><a href="${escapeHtml(languageUrl)}"${state.artifacts.profile.exists ? "" : ' target="_blank" rel="noreferrer"'}>언어</a></li>
              <li><a href="${escapeHtml(problemsUrl)}">문제 백업</a></li>
              <li class="active"><a href="/">대시보드</a></li>
            </ul>
            <span class="navbar-text dashboard-nav-note">local backup dashboard</span>
          </div>
        </div>
      </div>
    </div>
    <div class="container content">
      <div class="row dashboard-section-gap">
        <div class="col-md-12">
          <div class="page-header dashboard-page-header">
            <h1>BOJ Backup Dashboard</h1>
            <blockquote class="no-mathjax">
              <span class="dashboard-subtitle">프로필 크롤링과 문제 + 제출코드 크롤링을 분리해서 실행하고, 각 단계는 이어받을 수 있습니다.</span>
              <div class="tab-v2">
                <ul class="nav nav-tabs">
                  <li class="active"><a href="/">대시보드</a></li>
                  <li><a href="#profile-panel">프로필 크롤링</a></li>
                  <li><a href="#archive-panel">문제 + 제출코드</a></li>
                  <li><a href="#artifacts-panel-anchor">저장 결과</a></li>
                  <li><a href="#task-panel-anchor">현재 작업</a></li>
                  <li><a href="#log-panel-anchor">최근 로그</a></li>
                </ul>
              </div>
            </blockquote>
          </div>
        </div>
      </div>

      <div class="row dashboard-section-gap">
        <div class="col-md-12">
          <div id="hero-stats" class="row"></div>
        </div>
      </div>

      <div class="row">
        <div class="col-md-4">
          <div class="panel panel-default dashboard-section-gap" id="profile-panel">
            <div class="panel-heading"><h3 class="panel-title">프로필 크롤링</h3></div>
            <div class="panel-body">
              <form id="profile-form" class="dashboard-form" method="post" action="/api/tasks/profile">
                <div class="dashboard-note-box">
                  현재 로그인한 사용자의 프로필과 언어 통계를 기본 경로에 저장합니다.
                </div>
                <button type="submit" class="btn btn-u btn-u-blue btn-block">프로필 크롤링 시작</button>
              </form>
            </div>
          </div>

          <div class="panel panel-default dashboard-section-gap" id="archive-panel">
            <div class="panel-heading"><h3 class="panel-title">문제 + 제출코드 크롤링</h3></div>
            <div class="panel-body">
              <form id="archive-form" class="dashboard-form" method="post" action="/api/tasks/archive">
                <div class="form-group">
                  <label for="archive-problem-filter">문제 번호 필터</label>
                  <input id="archive-problem-filter" class="form-control" name="problemFilter" placeholder="예: 1000,1001-1010">
                </div>
                <div class="form-group">
                  <label for="archive-problem-limit">최대 문제 수</label>
                  <input id="archive-problem-limit" class="form-control" name="problemLimit" type="number" min="1" step="1" placeholder="비우면 전체">
                </div>
                <div class="dashboard-note-box">
                  <strong>프로필 선행 필요</strong> 프로필 크롤링 후 시작됩니다. 기본값으로 체크포인트 이어받기와 기본 저장 경로를 사용합니다.
                </div>
                <button type="submit" class="btn btn-u btn-u-blue btn-block">문제 + 제출코드 크롤링 시작</button>
              </form>
            </div>
          </div>

          <div class="panel panel-default dashboard-section-gap">
            <div class="panel-heading"><h3 class="panel-title">요약</h3></div>
            <div class="panel-body" id="summary-panel"></div>
          </div>
        </div>

        <div class="col-md-8">
          <div class="panel panel-default dashboard-section-gap" id="artifacts-panel-anchor">
            <div class="panel-heading"><h3 class="panel-title">저장 결과</h3></div>
            <div class="panel-body">
              <div id="artifacts-panel"></div>
            </div>
          </div>

          <div class="panel panel-default dashboard-section-gap" id="task-panel-anchor">
            <div class="panel-heading"><h3 class="panel-title">현재 작업</h3></div>
            <div class="panel-body" id="task-panel"></div>
          </div>

          <div class="panel panel-default dashboard-section-gap" id="log-panel-anchor">
            <div class="panel-heading"><h3 class="panel-title">최근 로그</h3></div>
            <div class="panel-body dashboard-log-panel">
              <div id="log-panel"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <script id="dashboard-initial-state" type="application/json">${escapeScriptJson(state)}</script>
  <script>
    const initialState = JSON.parse(document.getElementById("dashboard-initial-state").textContent);
    let dashboardState = initialState;

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function getTaskStatusMeta(status) {
      switch (status) {
        case "running":
          return { label: "실행 중", className: "running" };
        case "stopping":
          return { label: "중지 중", className: "stopping" };
        case "stopped":
          return { label: "중지됨", className: "stopped" };
        case "completed":
          return { label: "완료", className: "completed" };
        case "failed":
          return { label: "실패", className: "failed" };
        default:
          return { label: "대기", className: "idle" };
      }
    }

    function extractTaskProgress(task) {
      if (!task || !Array.isArray(task.statusLines)) {
        return null;
      }

      for (const line of task.statusLines) {
        const progressMatch = line.match(/진행:\\s*(\\d+)\\/(\\d+)/);
        if (progressMatch) {
          const done = Number(progressMatch[1]);
          const total = Number(progressMatch[2]);
          if (total > 0) {
            return {
              percent: Math.max(0, Math.min(100, (done / total) * 100)),
              label: done + " / " + total,
            };
          }
        }

        const phaseMatch = line.match(/단계:\\s*(\\d+)\\/(\\d+)/);
        if (phaseMatch) {
          const done = Number(phaseMatch[1]);
          const total = Number(phaseMatch[2]);
          if (total > 0) {
            return {
              percent: Math.max(0, Math.min(100, (done / total) * 100)),
              label: done + " / " + total + " 단계",
            };
          }
        }
      }

      return null;
    }

    function getStatusValue(task, label) {
      if (!task || !Array.isArray(task.statusLines)) {
        return null;
      }

      for (const line of task.statusLines) {
        const index = line.indexOf(":");
        if (index === -1) {
          continue;
        }

        const currentLabel = line.slice(0, index).trim();
        if (currentLabel === label) {
          return line.slice(index + 1).trim();
        }
      }

      return null;
    }

    function resolveActiveVisualState(taskStatus) {
      if (taskStatus === "failed") {
        return "failed";
      }

      if (taskStatus === "stopped" || taskStatus === "stopping") {
        return "stopped";
      }

      return "active";
    }

    function createLinearSteps(definitions, activeIndex, completedCount, taskStatus) {
      return definitions.map((definition, index) => {
        let state = "pending";
        if (taskStatus === "completed") {
          state = "completed";
        } else if (index < completedCount) {
          state = "completed";
        } else if (index === activeIndex) {
          state = resolveActiveVisualState(taskStatus);
        }

        return {
          label: definition.label,
          note: definition.note || "",
          state,
        };
      });
    }

    function buildProfilePhaseSteps(task) {
      const lines = Array.isArray(task.statusLines) ? task.statusLines.join(" ") : "";
      let activeIndex = 0;
      let completedCount = 0;

      if (task.status === "completed") {
        activeIndex = 2;
        completedCount = 3;
      } else if (lines.includes("언어 통계 수집 중")) {
        activeIndex = 1;
        completedCount = 1;
      } else if (lines.includes("프로필 JSON 저장 완료")) {
        activeIndex = 2;
        completedCount = 2;
      }

      return createLinearSteps([
        { label: "프로필 페이지", note: "등수, 제출 수, 문제 목록" },
        { label: "언어 통계", note: "언어별 제출 현황" },
        { label: "JSON 저장", note: "profile.json 기록" },
      ], activeIndex, completedCount, task.status);
    }

    function buildSubmissionPhaseSteps(task) {
      const pageValue = getStatusValue(task, "페이지");
      const rowsValue = getStatusValue(task, "행 수");
      const lastSubmission = getStatusValue(task, "마지막 제출");
      let activeIndex = 0;
      let completedCount = 0;

      if (task.status === "completed") {
        activeIndex = 1;
        completedCount = 2;
      }

      return createLinearSteps([
        {
          label: "status 페이지 순회",
          note: rowsValue ? "수집 " + rowsValue : (pageValue ? "페이지 " + pageValue : "제출 기록 탐색"),
        },
        {
          label: "제출 JSON 저장",
          note: lastSubmission && lastSubmission !== "-" ? "마지막 " + lastSubmission : "submissions.json 기록",
        },
      ], activeIndex, completedCount, task.status);
    }

    function buildProblemPhaseSteps(task) {
      const currentPhase = getStatusValue(task, "현재 단계") || "";
      const currentProblem = getStatusValue(task, "현재 문제");
      const sourceProgress = getStatusValue(task, "코드 다운로드");
      const submissionCount = getStatusValue(task, "문제별 제출 수");
      let activeIndex = 0;
      let completedCount = 0;

      if (task.status === "completed" || currentPhase === "완료" || currentPhase === "기존 문제 건너뜀") {
        activeIndex = 3;
        completedCount = 4;
      } else if (currentPhase === "solved.ac 메타 다운로드") {
        activeIndex = 1;
        completedCount = 1;
      } else if (currentPhase === "제출 코드 다운로드") {
        activeIndex = 2;
        completedCount = 2;
      } else if (currentPhase === "문제 폴더 저장") {
        activeIndex = 3;
        completedCount = 3;
      }

      return createLinearSteps([
        {
          label: "문제 HTML",
          note: currentProblem && currentProblem !== "-" ? currentProblem : "문제 본문 다운로드",
        },
        { label: "solved.ac 메타", note: "티어와 알고리즘 태그" },
        {
          label: "제출 코드",
          note: sourceProgress && sourceProgress !== "-" ? sourceProgress : (submissionCount ? "제출 수 " + submissionCount : "코드 파일 수집"),
        },
        { label: "문제 폴더 저장", note: "index.html, meta.json, sources/" },
      ], activeIndex, completedCount, task.status);
    }

    function buildArchiveMajorSteps(task) {
      const stageValue = getStatusValue(task, "단계") || "";
      let activeIndex = 1;
      let completedCount = 1;

      if (task.status === "completed") {
        activeIndex = 2;
        completedCount = 3;
      } else if (stageValue.includes("2/2")) {
        activeIndex = 2;
        completedCount = 2;
      }

      return createLinearSteps([
        { label: "프로필 확인", note: "profile.json 선행 확인" },
        { label: "제출 기록 수집", note: getStatusValue(task, "행 수") || "status 페이지 순회" },
        { label: "문제 백업", note: getStatusValue(task, "현재 문제") || "문제와 제출 코드 저장" },
      ], activeIndex, completedCount, task.status);
    }

    function buildSyncMajorSteps(task) {
      const stageValue = getStatusValue(task, "단계") || "";
      let activeIndex = 0;
      let completedCount = 0;

      if (task.status === "completed") {
        activeIndex = 2;
        completedCount = 3;
      } else if (stageValue.includes("2/3")) {
        activeIndex = 1;
        completedCount = 1;
      } else if (stageValue.includes("3/3")) {
        activeIndex = 2;
        completedCount = 2;
      }

      return createLinearSteps([
        { label: "프로필", note: "profile.json 생성" },
        { label: "제출 기록", note: getStatusValue(task, "행 수") || "submissions.json 생성" },
        { label: "문제 백업", note: getStatusValue(task, "현재 문제") || "문제와 코드 저장" },
      ], activeIndex, completedCount, task.status);
    }

    function buildTaskVisualization(task) {
      const stageValue = getStatusValue(task, "단계") || "";

      if (task.kind === "profile") {
        return {
          steps: buildProfilePhaseSteps(task),
          checklistTitle: null,
          checklist: [],
        };
      }

      if (task.kind === "archive") {
        const isProblemStage = task.status === "completed" || stageValue.includes("2/2");
        return {
          steps: buildArchiveMajorSteps(task),
          checklistTitle: isProblemStage ? "문제 백업 세부 단계" : "제출 기록 수집 세부 단계",
          checklist: isProblemStage ? buildProblemPhaseSteps(task) : buildSubmissionPhaseSteps(task),
        };
      }

      if (task.kind === "sync") {
        let checklistTitle = "프로필 수집 세부 단계";
        let checklist = buildProfilePhaseSteps(task);
        if (stageValue.includes("2/3")) {
          checklistTitle = "제출 기록 수집 세부 단계";
          checklist = buildSubmissionPhaseSteps(task);
        } else if (task.status === "completed" || stageValue.includes("3/3")) {
          checklistTitle = "문제 백업 세부 단계";
          checklist = buildProblemPhaseSteps(task);
        }

        return {
          steps: buildSyncMajorSteps(task),
          checklistTitle,
          checklist,
        };
      }

      if (task.kind === "submissions") {
        return {
          steps: buildSubmissionPhaseSteps(task),
          checklistTitle: null,
          checklist: [],
        };
      }

      if (task.kind === "problems") {
        return {
          steps: buildProblemPhaseSteps(task),
          checklistTitle: null,
          checklist: [],
        };
      }

      return null;
    }

    function renderStepIcon(state) {
      if (state === "completed") {
        return '<i class="fa fa-check"></i>';
      }

      if (state === "active") {
        return '<i class="fa fa-circle-o-notch fa-spin"></i>';
      }

      if (state === "failed") {
        return '<i class="fa fa-times"></i>';
      }

      if (state === "stopped") {
        return '<i class="fa fa-pause"></i>';
      }

      return '<i class="fa fa-circle-thin"></i>';
    }

    function renderTaskSteps(steps) {
      if (!steps || steps.length === 0) {
        return "";
      }

      return '<div class="dashboard-stepper">' + steps.map((step, index) => {
        const connector = index < steps.length - 1 ? '<span class="dashboard-step-connector"></span>' : '';
        return (
          '<div class="dashboard-step ' + step.state + '">' +
            '<span class="dashboard-step-icon">' + renderStepIcon(step.state) + '</span>' +
            '<div class="dashboard-step-body">' +
              '<span class="dashboard-step-label">' + escapeHtml(step.label) + '</span>' +
              (step.note ? '<span class="dashboard-step-note">' + escapeHtml(step.note) + '</span>' : '') +
            '</div>' +
          '</div>' +
          connector
        );
      }).join("") + '</div>';
    }

    function renderTaskChecklist(title, checklist) {
      if (!checklist || checklist.length === 0) {
        return "";
      }

      return (
        '<div class="dashboard-checklist">' +
          (title ? '<h4 class="dashboard-checklist-title">' + escapeHtml(title) + '</h4>' : '') +
          '<ul class="dashboard-checklist-list">' +
            checklist.map((item) => (
              '<li class="dashboard-checklist-item ' + item.state + '">' +
                '<span class="dashboard-check-icon">' + renderStepIcon(item.state) + '</span>' +
                '<div class="dashboard-check-content">' +
                  '<span class="dashboard-check-label">' + escapeHtml(item.label) + '</span>' +
                  (item.note ? '<span class="dashboard-check-note">' + escapeHtml(item.note) + '</span>' : '') +
                '</div>' +
              '</li>'
            )).join("") +
          '</ul>' +
        '</div>'
      );
    }

    function renderTaskVisualization(task) {
      const model = buildTaskVisualization(task);
      if (!model) {
        return "";
      }

      return (
        '<div class="dashboard-step-visual">' +
          renderTaskSteps(model.steps) +
          renderTaskChecklist(model.checklistTitle, model.checklist) +
        '</div>'
      );
    }

    function renderHeroStats(artifacts) {
      const stats = [
        {
          label: "체크포인트",
          value: artifacts.sync.exists ? (artifacts.sync.phase || "사용 중") : "없음",
          note: artifacts.sync.exists ? "업데이트 " + escapeHtml(artifacts.sync.updatedAt || "-") : "대기 중인 백업 체크포인트 없음",
        },
        {
          label: "프로필",
          value: artifacts.profile.username || "-",
          note: artifacts.profile.exists ? "프로필 저장 " + escapeHtml(artifacts.profile.fetchedAt || "-") : "아직 프로필 JSON 없음",
        },
        {
          label: "제출",
          value: artifacts.submissions.totalCount === null ? "-" : escapeHtml(String(artifacts.submissions.totalCount)),
          note: artifacts.submissions.exists ? escapeHtml(artifacts.submissions.username || "-") + " 제출 백업" : "아직 제출 JSON 없음",
        },
        {
          label: "문제",
          value: escapeHtml(String(artifacts.problems.totalCount || 0)),
          note: artifacts.problems.exists ? "백업된 문제 폴더" : "문제 폴더가 비어 있음",
        },
      ];

      document.getElementById("hero-stats").innerHTML = stats
        .map((item) => \`
          <div class="col-sm-6 col-md-3">
            <div class="dashboard-stat-card">
              <span class="dashboard-stat-label">\${escapeHtml(item.label)}</span>
              <span class="dashboard-stat-value">\${item.value}</span>
              <span class="dashboard-stat-note">\${item.note}</span>
            </div>
          </div>
        \`)
        .join("");
    }

    function renderSummary(artifacts) {
      const username =
        artifacts.profile.username ||
        artifacts.submissions.username ||
        artifacts.sync.username ||
        "-";
      const rows = [
        ["사용자", username],
        ["프로필 JSON", artifacts.profile.exists ? (artifacts.profile.fetchedAt || "저장됨") : "없음"],
        ["제출 JSON", artifacts.submissions.exists ? String(artifacts.submissions.totalCount || 0) + "개 제출" : "없음"],
        ["문제 폴더", artifacts.problems.exists ? String(artifacts.problems.totalCount) + "개 문제" : "없음"],
        ["백업 체크포인트", artifacts.sync.exists ? (artifacts.sync.phase || "사용 중") + " · " + (artifacts.sync.updatedAt || "-") : "없음"],
      ];

      document.getElementById("summary-panel").innerHTML =
        '<table id="statics" class="table table-hover dashboard-summary-table"><tbody>' +
        rows.map((row) => '<tr><th>' + escapeHtml(row[0]) + '</th><td>' + escapeHtml(row[1]) + '</td></tr>').join("") +
        '</tbody></table>';
    }

    function renderArtifactCard(card) {
      return \`
        <div class="dashboard-artifact-card \${escapeHtml(card.tone)}">
          <div class="dashboard-artifact-head">
            <h4>\${escapeHtml(card.title)}</h4>
            <span class="dashboard-artifact-flag \${card.exists ? "ready" : "empty"}">\${card.exists ? "READY" : "EMPTY"}</span>
          </div>
          <span class="dashboard-artifact-value">\${card.value}</span>
          <div class="dashboard-artifact-meta">\${card.note}</div>
          <div class="dashboard-link-row">\${card.actions}</div>
        </div>
      \`;
    }

    function renderArtifacts(artifacts) {
      renderHeroStats(artifacts);
      renderSummary(artifacts);

      const cards = [
        {
          tone: "sync",
          title: "백업 체크포인트",
          exists: artifacts.sync.exists,
          value: artifacts.sync.exists ? escapeHtml(artifacts.sync.phase || "사용 중") : "없음",
          note: artifacts.sync.exists
            ? "사용자 " + escapeHtml(artifacts.sync.username || "-") + " · " + escapeHtml(artifacts.sync.updatedAt || "-")
            : "현재 이어받을 sync 체크포인트가 없습니다.",
          actions:
            '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\\'sync\\')">체크포인트 위치 열기</button>',
        },
        {
          tone: "profile",
          title: "프로필 JSON",
          exists: artifacts.profile.exists,
          value: artifacts.profile.username ? escapeHtml(artifacts.profile.username) : "없음",
          note: artifacts.profile.exists
            ? "프로필 저장 시각 " + escapeHtml(artifacts.profile.fetchedAt || "-")
            : "프로필 JSON이 아직 생성되지 않았습니다.",
          actions: artifacts.profile.exists
            ? '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\\'profile\\')">저장 위치 열기</button>' +
              '<a class="btn btn-xs dashboard-btn-primary" href="' + escapeHtml(artifacts.profile.infoUrl) + '">프로필 보기</a>' +
              '<a class="btn btn-default btn-xs" href="' + escapeHtml(artifacts.profile.languageUrl) + '">언어 보기</a>'
            : '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\\'profile\\')">저장 위치 열기</button>',
        },
        {
          tone: "submissions",
          title: "제출 JSON",
          exists: artifacts.submissions.exists,
          value: artifacts.submissions.totalCount === null ? "없음" : escapeHtml(String(artifacts.submissions.totalCount)),
          note: artifacts.submissions.exists
            ? "사용자 " + escapeHtml(artifacts.submissions.username || "-") + " 제출 백업"
            : "제출 기록 JSON이 아직 생성되지 않았습니다.",
          actions: artifacts.submissions.exists
            ? '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\\'submissions\\')">저장 위치 열기</button>' +
              '<a class="btn btn-xs dashboard-btn-primary" href="' + escapeHtml(artifacts.submissions.statusUrl) + '">제출 보기</a>'
            : '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\\'submissions\\')">저장 위치 열기</button>',
        },
        {
          tone: "problems",
          title: "문제 백업",
          exists: artifacts.problems.exists,
          value: escapeHtml(String(artifacts.problems.totalCount || 0)),
          note: artifacts.problems.exists
            ? "문제 폴더, 메타, 문제별 제출 기록과 코드가 저장돼 있습니다."
            : "문제 폴더가 아직 비어 있습니다.",
          actions: artifacts.problems.exists
            ? '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\\'problems\\')">저장 위치 열기</button>' +
              '<a class="btn btn-xs dashboard-btn-primary" href="' + escapeHtml(artifacts.problems.listUrl) + '">문제 목록 보기</a>'
            : '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\\'problems\\')">저장 위치 열기</button>',
        },
      ];

      document.getElementById("artifacts-panel").innerHTML =
        '<div class="dashboard-artifact-grid">' + cards.map(renderArtifactCard).join("") + '</div>';
    }

    function renderStatusRows(lines) {
      if (!lines || lines.length === 0) {
        return '<tr><td colspan="2" class="dashboard-empty">상태 정보가 없습니다.</td></tr>';
      }

      return lines.map((line) => {
        const index = line.indexOf(":");
        if (index === -1) {
          return '<tr><th>Status</th><td>' + escapeHtml(line) + '</td></tr>';
        }

        const label = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        return '<tr><th>' + escapeHtml(label) + '</th><td>' + escapeHtml(value) + '</td></tr>';
      }).join("");
    }

    function renderTask(task) {
      const target = document.getElementById("task-panel");
      const logsTarget = document.getElementById("log-panel");

      if (!task) {
        target.innerHTML = '<p class="dashboard-empty">아직 실행된 작업이 없습니다.</p>';
        logsTarget.innerHTML = '<p class="dashboard-empty">로그가 없습니다.</p>';
        return;
      }

      const status = getTaskStatusMeta(task.status);
      const progress = extractTaskProgress(task);
      target.innerHTML = \`
        <div class="clearfix">
          <span class="dashboard-status-badge \${status.className}">\${status.label}</span>
          \${(task.status === "running" || task.status === "stopping")
            ? '<div class="pull-right dashboard-task-controls"><button id="stop-task-button" type="button" class="btn btn-default btn-xs"' + (task.status === "stopping" ? ' disabled' : '') + '>중지 요청</button></div>'
            : ''}
        </div>
        <h3 class="dashboard-task-title">\${escapeHtml(task.title)}</h3>
        <p class="dashboard-task-meta">시작: \${escapeHtml(task.startedAt)}\${task.finishedAt ? ' · 종료: ' + escapeHtml(task.finishedAt) : ''}</p>
        \${task.summary ? '<div class="alert alert-info">' + escapeHtml(task.summary) + '</div>' : ''}
        \${renderTaskVisualization(task)}
        \${progress ? '<div class="dashboard-progress"><div class="dashboard-progress-meta"><span>진행률</span><span>' + escapeHtml(progress.label) + '</span></div><div class="progress progress-u"><div class="progress-bar progress-bar-u" role="progressbar" style="width:' + progress.percent.toFixed(1) + '%"></div></div></div>' : ''}
        <div class="table-responsive">
          <table class="table table-striped dashboard-status-table">
            <tbody>\${renderStatusRows(task.statusLines || [])}</tbody>
          </table>
        </div>
      \`;

      const stopButton = document.getElementById("stop-task-button");
      if (stopButton) {
        stopButton.addEventListener("click", async () => {
          await stopCurrentTask();
        });
      }

      logsTarget.innerHTML = (task.logs && task.logs.length > 0)
        ? '<ul class="list-group dashboard-log-list">' + task.logs.map((line) => '<li class="list-group-item">' + escapeHtml(line) + '</li>').join("") + '</ul>'
        : '<p class="dashboard-empty">로그가 없습니다.</p>';
    }

    function renderState(state) {
      renderArtifacts(state.artifacts);
      renderTask(state.task);
      const running = !!(state.task && (state.task.status === "running" || state.task.status === "stopping"));
      document.querySelectorAll("button[type=submit]").forEach((button) => {
        button.disabled = running;
      });
    }

    async function readJsonResponse(response) {
      const text = await response.text();
      if (!text) {
        return {};
      }

      try {
        return JSON.parse(text);
      } catch (error) {
        console.error("dashboard response parse error", error, text);
        return {
          error: "응답을 읽지 못했습니다.",
        };
      }
    }

    function setFormPending(form, pending, pendingLabel) {
      const submitButton = form ? form.querySelector("button[type=submit]") : null;
      if (!submitButton) {
        return;
      }

      if (!submitButton.dataset.originalLabel) {
        submitButton.dataset.originalLabel = submitButton.textContent || "";
      }

      submitButton.disabled = pending;
      submitButton.textContent = pending
        ? pendingLabel
        : submitButton.dataset.originalLabel;
    }

    async function refreshState(showAlertOnError = false) {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        const payload = await readJsonResponse(response);
        if (!response.ok) {
          throw new Error(payload.error || "상태를 불러오지 못했습니다.");
        }

        dashboardState = payload;
        renderState(dashboardState);
      } catch (error) {
        console.error("dashboard state refresh failed", error);
        if (showAlertOnError) {
          alert(error instanceof Error ? error.message : "상태를 불러오지 못했습니다.");
        }
      }
    }

    async function startTask(formId, endpoint) {
      const form = document.getElementById(formId);
      if (!form) {
        alert("작업 폼을 찾지 못했습니다. 페이지를 새로고침하세요.");
        return;
      }

      setFormPending(form, true, "시작 중...");

      try {
        const body = new URLSearchParams(new FormData(form));
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
            accept: "application/json",
            "x-requested-with": "fetch",
          },
          body,
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) {
          alert(payload.error || "작업 시작에 실패했습니다.");
          return;
        }

        await refreshState(true);
      } catch (error) {
        console.error("dashboard start task failed", error);
        alert(error instanceof Error ? error.message : "작업 시작에 실패했습니다.");
      } finally {
        setFormPending(form, false, "시작 중...");
        renderState(dashboardState);
      }
    }

    async function openArtifactLocation(key) {
      try {
        const response = await fetch("/api/open-location", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: new URLSearchParams({ key }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) {
          alert(payload.error || "저장 위치를 열지 못했습니다.");
        }
      } catch (error) {
        console.error("dashboard open location failed", error);
        alert(error instanceof Error ? error.message : "저장 위치를 열지 못했습니다.");
      }
    }

    async function stopCurrentTask() {
      try {
        const response = await fetch("/api/tasks/stop", {
          method: "POST",
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) {
          alert(payload.error || "중지 요청에 실패했습니다.");
          return;
        }

        await refreshState(true);
      } catch (error) {
        console.error("dashboard stop task failed", error);
        alert(error instanceof Error ? error.message : "중지 요청에 실패했습니다.");
      }
    }

    document.getElementById("profile-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      await startTask("profile-form", "/api/tasks/profile");
    });

    document.getElementById("archive-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      await startTask("archive-form", "/api/tasks/archive");
    });

    renderState(dashboardState);
    setInterval(() => {
      void refreshState(false);
    }, 1500);
  </script>
</body>
</html>`;
}

function renderProblemsIndexPage(
  entries: ProblemListEntry[],
  problemsDir: string,
  options: {
    query: string;
    totalCount: number;
  },
): string {
  const rows = entries.length > 0
    ? entries
        .map(
          (entry) => `
            <tr>
              <td><a href="${escapeHtmlAttr(entry.problemUrl)}">${entry.problemId}</a></td>
              <td>${escapeHtml(entry.title ?? "-")}</td>
              <td>${renderProblemTierCell(entry)}</td>
              <td>${renderProblemTagsCell(entry)}</td>
              <td>${escapeHtml(entry.submissionCount === null ? "-" : formatNumber(entry.submissionCount))}</td>
            </tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="dashboard-empty">조건에 맞는 문제가 없습니다.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>문제 목록</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.2.0/css/bootstrap.min.css">
  <style>
    body { background: #fff; color: #333; padding: 24px 16px; }
    .page-wrap { max-width: 1100px; margin: 0 auto; }
    .meta { color: #666; margin-bottom: 18px; }
    .search-form {
      margin: 18px 0 14px;
      padding: 14px 16px;
      border: 1px solid #ddd;
      border-radius: 6px;
      background: #fafafa;
    }
    .search-help {
      margin-top: 8px;
      color: #666;
      font-size: 12px;
    }
    .search-help code {
      background: #f1f1f1;
      color: #333;
    }
    .dashboard-tier-cell {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }
    .dashboard-tier-icon {
      width: 18px;
      height: 18px;
      vertical-align: middle;
    }
    .dashboard-tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .dashboard-tag-chip {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      background: #f0f7ff;
      color: #0b65a5;
      font-size: 12px;
      white-space: nowrap;
    }
  </style>
</head>
<body>
  <div class="page-wrap">
    <h1>문제 목록</h1>
    <p class="meta">출력 디렉터리: ${escapeHtml(problemsDir)} · 총 ${formatNumber(options.totalCount)}개 · 현재 ${formatNumber(entries.length)}개</p>
    <p><a href="/">대시보드로 돌아가기</a></p>
    <form class="search-form" action="/problems" method="get">
      <div class="input-group">
        <input type="text" class="form-control" name="q" value="${escapeHtmlAttr(options.query)}" placeholder="문제 번호, 제목, tag:segtree, tier:d5">
        <span class="input-group-btn">
          <button type="submit" class="btn btn-primary">검색</button>
        </span>
      </div>
      <div class="search-help">
        예시: <code>19581</code>, <code>트리 tag:lca</code>, <code>tag:segtree</code>, <code>tier:d5</code>, <code>tag:dp tier:g3</code>
      </div>
    </form>
    <div class="table-responsive">
      <table class="table table-bordered table-striped dashboard-problems-table">
        <thead>
          <tr>
            <th>문제 번호</th>
            <th>제목</th>
            <th>티어</th>
            <th>태그</th>
            <th>제출 수</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}

function renderProblemTierCell(entry: ProblemListEntry): string {
  if (entry.tierLevel === null && !entry.tierLabel) {
    return "-";
  }

  const iconHtml =
    entry.tierLevel === null
      ? ""
      : `<img src="${escapeHtmlAttr(buildTierIconUrl(entry.tierLevel))}" class="dashboard-tier-icon" alt="${escapeHtmlAttr(entry.tierLabel ?? `Tier ${entry.tierLevel}`)}">`;
  const label = escapeHtml(entry.tierLabel ?? `Tier ${entry.tierLevel}`);

  return `<span class="dashboard-tier-cell">${iconHtml}<span>${label}</span></span>`;
}

function renderProblemTagsCell(entry: ProblemListEntry): string {
  if (entry.tagNames.length === 0) {
    return "-";
  }

  const visibleTags = entry.tagNames.slice(0, 4);
  const hiddenCount = Math.max(entry.tagNames.length - visibleTags.length, 0);
  const chips = visibleTags
    .map((tagName) => `<span class="dashboard-tag-chip">${escapeHtml(tagName)}</span>`)
    .join("");
  const moreChip =
    hiddenCount > 0
      ? `<span class="dashboard-tag-chip">+${hiddenCount}</span>`
      : "";

  return `<div class="dashboard-tag-list">${chips}${moreChip}</div>`;
}

function buildTierIconUrl(tierLevel: number): string {
  return `https://d2gd6pc034wcta.cloudfront.net/tier/${tierLevel}.svg`;
}

function renderDashboardErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.2.0/css/bootstrap.min.css">
</head>
<body style="padding:24px 16px;">
  <div class="container">
    <div class="alert alert-warning">${escapeHtml(message)}</div>
    <p><a href="/">대시보드로 돌아가기</a></p>
  </div>
</body>
</html>`;
}

function respondHtml(
  response: ServerResponse,
  html: string,
  statusCode = 200,
  headers: Record<string, string> = {},
): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    ...headers,
  });
  response.end(html);
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown,
  headers: Record<string, string> = {},
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function formatSubmissionProgressLabel(
  rowsFetched: number,
  estimatedTotalCount: number | null,
  limitCount: number | null,
): string {
  if (limitCount && limitCount > 0) {
    const percent = ((rowsFetched / limitCount) * 100).toFixed(1);
    return `${rowsFetched}/${limitCount} rows (${percent}%, limit)`;
  }

  if (!estimatedTotalCount || estimatedTotalCount <= 0) {
    return `${rowsFetched} rows`;
  }

  if (rowsFetched <= estimatedTotalCount) {
    const percent = ((rowsFetched / estimatedTotalCount) * 100).toFixed(1);
    return `${rowsFetched}/${estimatedTotalCount} rows (${percent}%, profile est.)`;
  }

  return `${rowsFetched}/${estimatedTotalCount}+ rows (profile est. exceeded)`;
}

function formatRateLimitLabel(
  delayMs: number,
  reason: "none" | "base" | "backoff",
  backoffAttempt: number,
): string {
  const seconds = (delayMs / 1000).toFixed(1);
  if (reason === "backoff" && backoffAttempt > 0) {
    return `${seconds}s backoff (${backoffAttempt}/3)`;
  }

  return `${seconds}s`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "-" : formatNumber(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value);
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function normalizeServerStartError(error: unknown, host: string, port: number): Error {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code);

    if (code === "EADDRINUSE") {
      return new ConfigurationError(`Port ${port} is already in use.`);
    }

    if (code === "EACCES") {
      return new ConfigurationError(
        `Could not bind to ${host}:${port}. That port may be restricted by Windows. Try --port 3000 or --port 0.`,
      );
    }
  }

  return error instanceof Error ? error : new Error(String(error));
}
