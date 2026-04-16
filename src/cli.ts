import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { Command, Option } from "commander";

import {
  type BojUserLanguageStats,
  type BojUserProfile,
  type BojUserSubmissionsCheckpoint,
  type BojUserSubmissionFetchProgress,
  type BojUserSubmissionsSnapshot,
} from "./boj/session.js";
import { loadConfig } from "./config.js";
import { AuthenticationError, ConfigurationError, StopRequestedError } from "./errors.js";
import {
  authenticateClient,
  createClient,
  createInterruptController,
  formatDisplayPath,
  writeJsonFile,
} from "./cli-support.js";
import {
  backupProblemsFromSubmissions,
  type ProblemBackupProgress,
  type ProblemBackupResult,
} from "./problem-backup.js";
import {
  runArchiveSync,
  runBackupSync,
  type BackupSyncStageProgress,
} from "./sync.js";
import { runSimpleTui } from "./tui.js";
import { resolveUserArtifactPaths } from "./user-artifacts.js";
import { startDashboardViewerServer } from "./viewer/dashboard-site.js";
import { openProfileViewer, startProfileViewerServer } from "./viewer/profile-site.js";
import { startSubmissionsViewerServer } from "./viewer/submission-site.js";

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();

  program
    .name("boj-backup")
    .description("BOJ 백업용 CLI")
    .version("0.1.0");
  program.showHelpAfterError();
  program.addHelpText(
    "after",
    [
      "",
      "기본 흐름:",
      "  boj-backup login",
      "  boj-backup profile",
      "  boj-backup archive",
      "  boj-backup serve --open",
      "  boj-backup tui",
    ].join("\n"),
  );

  program
    .command("login")
    .description("현재 BOJ 로그인 세션을 확인합니다.")
    .addOption(new Option("--next <path>", "BOJ next path to request after login").default("/").hideHelp())
    .action(async (options: { next: string }) => {
      const config = loadConfig();
      const client = createClient(config);
      const username = await authenticateClient(client, config);

      console.log(`로그인 확인 완료: ${username}`);
    });

  program
    .command("sync [handle]", { hidden: true })
    .description("Run the full backup flow: profile, profile-selected problem crawl, and problem backup with stage-level resume.")
    .option("--profile <path>", "Profile JSON output path", "data/profile.json")
    .option("--submissions <path>", "Submissions JSON output path", "data/submissions.json")
    .option("--problems <path>", "Problem backup output directory", "problems")
    .option("--problem-filter <filter>", "Problem ids/ranges for problem backup, e.g. 1000,1001-1010")
    .option("--problem-limit <count>", "Limit archive crawl to the N profile-selected problems", parsePositiveInteger)
    .option("--checkpoint <path>", "Path to the full sync checkpoint JSON file")
    .option("--submissions-checkpoint <path>", "Path to the submissions checkpoint JSON file")
    .option("--no-resume", "Ignore existing sync/submissions checkpoints and start from the beginning")
    .option("--overwrite-problems", "Refetch problem folders even if they already exist")
    .option("--delay <seconds>", "Base delay between BOJ requests in seconds (min 2)", parseDelaySeconds)
    .action(async (
      handle: string | undefined,
      options: {
        profile: string;
        submissions: string;
        problems: string;
        problemFilter?: string;
        problemLimit?: number;
        checkpoint?: string;
        submissionsCheckpoint?: string;
        resume?: boolean;
        overwriteProblems?: boolean;
        delay?: number;
      },
    ) => {
      const config = loadConfig();
      const client = createClient(config, options.delay);
      const syncReporter = createSyncStageReporter();
      const interrupt = createInterruptController(
        "전체 동기화 중지 요청을 받았습니다. 현재 요청이 끝나면 안전하게 정지합니다.",
      );

      let result;
      try {
        result = await runBackupSync({
          client,
          handle,
          resolveUsername: () => authenticateClient(client, config),
          profilePath: options.profile,
          submissionsPath: options.submissions,
          problemsDir: options.problems,
          problemFilter: options.problemFilter,
          problemLimit: options.problemLimit,
          checkpointPath: options.checkpoint,
          submissionsCheckpointPath: options.submissionsCheckpoint,
          resume: options.resume,
          overwriteProblems: options.overwriteProblems,
          shouldStop: interrupt.shouldStop,
          onStage: syncReporter.stage,
          onLog: syncReporter.log,
          onSubmissionsProgress: syncReporter.submissions,
          onProblemProgress: syncReporter.problems,
        });
      } catch (error) {
        syncReporter.interrupt();
        throw error;
      } finally {
        interrupt.close();
      }

      syncReporter.finish(result);
      console.log(`사용자: ${result.username}`);
      console.log(`프로필 JSON: ${result.profilePath}`);
      console.log(`제출 JSON: ${result.submissionsPath}`);
      console.log(`문제 폴더: ${result.problemsDir}`);
    });

  program
    .command("profile")
    .description("현재 사용자의 프로필 JSON을 저장합니다.")
    .addOption(new Option("--handle <id>", "Override username").hideHelp())
    .addOption(new Option("--json", "Print the combined profile snapshot as JSON").hideHelp())
    .addOption(new Option("-o, --output <path>", "Write the combined profile snapshot JSON to a file").hideHelp())
    .addOption(
      new Option("--delay <seconds>", "Base delay between BOJ requests in seconds (min 2)")
        .argParser(parseDelaySeconds)
        .hideHelp(),
    )
    .action(async (
      options: { handle?: string; json?: boolean; output?: string; delay?: number },
    ) => {
      const config = loadConfig();
      const client = createClient(config, options.delay);
      const targetHandle = options.handle ?? (await authenticateClient(client, config));
      const snapshot = await client.fetchUserSnapshot(targetHandle);
      const defaultPaths = resolveUserArtifactPaths(targetHandle);
      const outputPath = options.output ?? defaultPaths.profilePath;

      await writeJsonFile(outputPath, snapshot);

      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
      } else {
        printProfile(snapshot.profile);
      }
      console.log(`프로필 JSON: ${outputPath}`);
    });

  program
    .command("archive")
    .description("프로필 문제 목록을 기준으로 각 문제의 제출/지문/코드를 순서대로 백업합니다.")
    .option("--problem-limit <count>", "이미 백업되지 않은 문제 기준으로 최대 N개 문제만 추가 백업", parsePositiveInteger)
    .option("--no-resume", "이전 체크포인트를 무시하고 처음부터 다시 시작")
    .option("--overwrite", "이미 저장된 문제도 다시 다운로드")
    .addOption(new Option("--handle <id>", "Override username").hideHelp())
    .addOption(new Option("--profile <path>", "Existing profile JSON path").hideHelp())
    .addOption(new Option("--submissions <path>", "Submissions JSON output path").hideHelp())
    .addOption(new Option("--problems <path>", "Problem backup output directory").hideHelp())
    .addOption(new Option("--problem-filter <filter>", "Problem ids/ranges for problem backup").hideHelp())
    .addOption(new Option("--checkpoint <path>", "Path to the archive checkpoint JSON file").hideHelp())
    .addOption(
      new Option("--submissions-checkpoint <path>", "Path to the submissions checkpoint JSON file").hideHelp(),
    )
    .addOption(
      new Option("--delay <seconds>", "Base delay between BOJ requests in seconds (min 2)")
        .argParser(parseDelaySeconds)
        .hideHelp(),
    )
    .action(async (options: {
      handle?: string;
      profile?: string;
      submissions?: string;
      problems?: string;
      problemFilter?: string;
      problemLimit?: number;
      checkpoint?: string;
      submissionsCheckpoint?: string;
      resume?: boolean;
      overwrite?: boolean;
      delay?: number;
    }) => {
      const config = loadConfig();
      const client = createClient(config, options.delay);
      const username = options.handle ?? (await authenticateClient(client, config));
      const artifacts = resolveUserArtifactPaths(username);
      const syncReporter = createSyncStageReporter();
      const interrupt = createInterruptController(
        "문제 + 제출코드 백업 중지 요청을 받았습니다. 현재 요청이 끝나면 안전하게 정지합니다.",
      );

      let result;
      try {
        result = await runArchiveSync({
          client,
          handle: username,
          profilePath: options.profile ?? artifacts.profilePath,
          submissionsPath: options.submissions ?? artifacts.submissionsPath,
          problemsDir: options.problems ?? artifacts.problemsDir,
          problemFilter: options.problemFilter,
          problemLimit: options.problemLimit,
          checkpointPath: options.checkpoint,
          submissionsCheckpointPath: options.submissionsCheckpoint,
          resume: options.resume,
          overwriteProblems: options.overwrite,
          shouldStop: interrupt.shouldStop,
          onStage: syncReporter.stage,
          onLog: syncReporter.log,
          onSubmissionsProgress: syncReporter.submissions,
          onProblemProgress: syncReporter.problems,
        });
      } catch (error) {
        syncReporter.interrupt();
        throw error;
      } finally {
        interrupt.close();
      }

      syncReporter.finish(result);
      console.log(`사용자: ${result.username}`);
      console.log(`프로필 JSON: ${result.profilePath}`);
      console.log(`제출 JSON: ${result.submissionsPath}`);
      console.log(`문제 폴더: ${result.problemsDir}`);
    });

  program
    .command("submissions [handle]", { hidden: true })
    .description("Fetch BOJ submission history from public status pages. Defaults to the authenticated user when handle is omitted.")
    .option("--json", "Print the submissions snapshot as JSON")
    .option("-o, --output <path>", "Write the submissions snapshot JSON to a file")
    .option("--submission-limit <count>", "Limit crawl to the N most recent submissions", parsePositiveInteger)
    .option("--checkpoint <path>", "Path to the submissions checkpoint JSON file")
    .option("--no-resume", "Ignore an existing submissions checkpoint and start from the first page")
    .option("--delay <seconds>", "Base delay between BOJ requests in seconds (min 2)", parseDelaySeconds)
    .action(async (
      handle: string | undefined,
      options: {
        json?: boolean;
        output?: string;
        submissionLimit?: number;
        checkpoint?: string;
        resume?: boolean;
        delay?: number;
      },
    ) => {
      const config = loadConfig();
      const client = createClient(config, options.delay);
      const interrupt = createInterruptController(
        "제출 기록 수집 중지 요청을 받았습니다. 현재 요청이 끝나면 안전하게 정지합니다.",
      );
      try {
        let targetHandle = handle;

        if (!targetHandle) {
          targetHandle = await authenticateClient(client, config);
        }

        const checkpointPath = resolveSubmissionsCheckpointPath(
          targetHandle,
          options.output,
          options.checkpoint,
        );
        const checkpoint =
          options.resume === false
            ? null
            : await readSubmissionsCheckpoint(checkpointPath, targetHandle);
        const estimatedTotalCount =
          checkpoint?.estimatedTotalCount ?? (await client.fetchUserProfile(targetHandle)).submissionCount;
        const progress = createSubmissionsProgressReporter(
          targetHandle,
          estimatedTotalCount,
        );

        if (checkpoint) {
          announceSubmissionsResume(checkpointPath, checkpoint);
        }

        let submissions: BojUserSubmissionsSnapshot;
        try {
          submissions = await client.fetchUserSubmissions(targetHandle, {
            limitCount: options.submissionLimit ?? null,
            estimatedTotalCount,
            onProgress: progress.update,
            resumeFrom: checkpoint,
            shouldStop: interrupt.shouldStop,
            onCheckpoint: (nextCheckpoint) => writeJsonFile(checkpointPath, nextCheckpoint),
          });
        } catch (error) {
          progress.interrupt();
          console.error(`Checkpoint saved to ${checkpointPath}`);
          throw error;
        }

        progress.finish(submissions);
        await removeFileIfExists(checkpointPath);

        if (options.output) {
          await writeJsonFile(options.output, submissions);
        }

        if (options.json) {
          console.log(JSON.stringify(submissions, null, 2));
          return;
        }

        printSubmissionsSummary(submissions);

        if (options.output) {
          console.log(`JSON saved to ${path.resolve(options.output)}`);
        }
      } finally {
        interrupt.close();
      }
    });

  program
    .command("backup-problems <input>", { hidden: true })
    .description(
      "Back up BOJ problem pages and per-problem submission history for the problem IDs found in a submissions JSON file.",
    )
    .option(
      "-o, --output-dir <path>",
      "Directory where per-problem folders will be created",
      "problems",
    )
    .option("--overwrite", "Refetch problems even if the target problem folder already exists")
    .option("--problem-filter <filter>", "Problem ids/ranges to back up, e.g. 1000,1001-1010")
    .option("--problem-limit <count>", "Limit backup to the N most recent unique problems", parsePositiveInteger)
    .option("--delay <seconds>", "Base delay between BOJ requests in seconds (min 2)", parseDelaySeconds)
    .action(async (
      input: string,
      options: {
        outputDir: string;
        overwrite?: boolean;
        problemFilter?: string;
        problemLimit?: number;
        delay?: number;
      },
    ) => {
      const config = loadConfig();
      const client = createClient(config, options.delay);
      const interrupt = createInterruptController(
        "문제 백업 중지 요청을 받았습니다. 현재 요청이 끝나면 안전하게 정지합니다.",
      );
      try {
        await authenticateClient(client, config);
        const progress = createProblemBackupProgressReporter();

        let result: ProblemBackupResult;
        try {
          result = await backupProblemsFromSubmissions({
            client,
          inputPath: input,
          outputDir: options.outputDir,
          overwrite: options.overwrite,
          problemFilter: options.problemFilter,
          problemLimit: options.problemLimit,
          onProgress: progress.update,
          shouldStop: interrupt.shouldStop,
        });
        } catch (error) {
          progress.interrupt();
          throw error;
        }

        progress.finish(result);
        printProblemBackupSummary(result);
      } finally {
        interrupt.close();
      }
    });

  program
    .command("languages [handle]", { hidden: true })
    .description("Fetch and print BOJ language stats. Defaults to the authenticated user when handle is omitted.")
    .option("--delay <seconds>", "Base delay between BOJ requests in seconds (min 2)", parseDelaySeconds)
    .action(async (handle: string | undefined, options: { delay?: number }) => {
      const config = loadConfig();
      const client = createClient(config, options.delay);

      let targetHandle = handle;

      if (!targetHandle) {
        targetHandle = await authenticateClient(client, config);
      }

      const languageStats = await client.fetchUserLanguageStats(targetHandle);
      printLanguageStats(languageStats);
    });

  program
    .command("serve")
    .description("브라우저 대시보드를 실행합니다.")
    .option("--port <port>", "Port to bind the local server to. Use 0 for an auto-assigned port", parsePort, 0)
    .option("--open", "Open the dashboard in a browser after the server starts")
    .addOption(new Option("--host <host>", "Host to bind the local server to").default("127.0.0.1").hideHelp())
    .addOption(new Option("--profile <path>", "Override the profile JSON path for the dashboard").hideHelp())
    .addOption(new Option("--submissions <path>", "Override the submissions JSON path for the dashboard").hideHelp())
    .addOption(new Option("--problems <path>", "Override the problems output directory for the dashboard").hideHelp())
    .action(
      async (
        options: {
          host: string;
          port: number;
          profile?: string;
          submissions?: string;
          problems?: string;
          open?: boolean;
        },
      ) => {
        const viewer = await startDashboardViewerServer({
          host: options.host,
          port: options.port,
          profilePath: options.profile,
          submissionsPath: options.submissions,
          problemsDir: options.problems,
        });

        console.log("Dashboard viewer ready.");
        console.log(`Dashboard: ${viewer.dashboardUrl}`);
        console.log("Press Ctrl+C to stop the server.");

        if (options.open) {
          openProfileViewer(viewer.dashboardUrl);
        }
      },
    );

  program
    .command("tui")
    .description("간단한 터미널 메뉴로 login / profile / archive / serve를 실행합니다.")
    .action(async () => {
      await runSimpleTui();
    });

  program
    .command("serve-profile <input>", { hidden: true })
    .description("Serve a BOJ-style local profile page from a saved profile JSON snapshot.")
    .option("--host <host>", "Host to bind the local server to", "127.0.0.1")
    .option("--port <port>", "Port to bind the local server to. Use 0 for an auto-assigned port", parsePort, 0)
    .option("--submissions <path>", "Also mount a local submissions status page from a submissions JSON file")
    .option("--open", "Open the profile page in a browser after the server starts")
    .action(
      async (
        input: string,
        options: { host: string; port: number; submissions?: string; open?: boolean },
      ) => {
        const viewer = await startProfileViewerServer({
          inputPath: input,
          submissionsInputPath: options.submissions,
          host: options.host,
          port: options.port,
        });

        console.log(`Profile viewer ready for ${viewer.username}.`);
        console.log(`Info: ${viewer.infoUrl}`);
        console.log(`Language: ${viewer.languageUrl}`);
        if (viewer.statusUrl) {
          console.log(`Status: ${viewer.statusUrl}`);
        }
        console.log("Press Ctrl+C to stop the server.");

        if (options.open) {
          openProfileViewer(viewer.infoUrl);
        }
      },
    );

  program
    .command("serve-submissions <input>", { hidden: true })
    .description("Serve a BOJ-style local status page from a saved submissions JSON snapshot.")
    .option("--host <host>", "Host to bind the local server to", "127.0.0.1")
    .option("--port <port>", "Port to bind the local server to. Use 0 for an auto-assigned port", parsePort, 0)
    .option("--open", "Open the status page in a browser after the server starts")
    .action(
      async (
        input: string,
        options: { host: string; port: number; open?: boolean },
      ) => {
        const viewer = await startSubmissionsViewerServer({
          inputPath: input,
          host: options.host,
          port: options.port,
        });

        console.log(`Submissions viewer ready for ${viewer.username}.`);
        console.log(`Status: ${viewer.statusUrl}`);
        console.log("Press Ctrl+C to stop the server.");

        if (options.open) {
          openProfileViewer(viewer.statusUrl);
        }
      },
    );

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof StopRequestedError) {
      console.error(error.message);
      process.exitCode = 130;
      return;
    }

    if (error instanceof ConfigurationError || error instanceof AuthenticationError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }

    throw error;
  }
}

function printProfile(profile: BojUserProfile): void {
  console.log(`사용자: ${profile.username}`);

  for (const label of PROFILE_SUMMARY_FIELDS) {
    const value = profile.stats[label];
    if (!value) {
      continue;
    }

    console.log(`${label}: ${value}`);
  }

  for (const problemList of Object.values(profile.problemLists)) {
    console.log(`${problemList.label} 목록 수: ${problemList.problemIds.length}`);
  }
}

const PROFILE_SUMMARY_FIELDS = [
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

function printLanguageStats(languageStats: BojUserLanguageStats): void {
  console.log(`사용자: ${languageStats.username}`);

  const headers = languageStats.headers;
  if (headers.length === 0) {
    return;
  }

  console.log(headers.join(" | "));
  for (const row of languageStats.rows) {
    const values = headers.map((header, index) => {
      if (index === 0) {
        return row.language;
      }

      return row.stats[header] ?? "";
    });

    console.log(values.join(" | "));
  }
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ConfigurationError(`Invalid port: ${value}`);
  }

  return port;
}

function parseDelaySeconds(value: string): number {
  const seconds = Number.parseFloat(value);

  if (!Number.isFinite(seconds) || seconds < 2) {
    throw new ConfigurationError(`Invalid delay: ${value}. Use 2 or greater.`);
  }

  return seconds;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigurationError(`Invalid positive integer: ${value}`);
  }

  return parsed;
}

function printSubmissionsSummary(submissions: BojUserSubmissionsSnapshot): void {
  console.log(`사용자: ${submissions.username}`);
  console.log(`수집한 제출: ${submissions.totalCount}`);
  console.log(`수집한 페이지: ${submissions.pagesFetched}`);
  if (submissions.limitCount !== null) {
    console.log(`제출 수 제한: ${submissions.limitCount}`);
  }

  if (submissions.estimatedTotalCount !== null) {
    console.log(`프로필 기준 예상 제출: ${submissions.estimatedTotalCount}`);
  }
}

function printProblemBackupSummary(result: ProblemBackupResult): void {
  console.log(`사용자: ${result.username}`);
  console.log(`선택: ${result.selectionSummary}`);
  console.log(`선택한 문제: ${result.totalProblems}/${result.availableProblems}`);
  console.log(`백업한 문제: ${result.savedProblems}`);
  console.log(`기존 문제: ${result.skippedProblems}`);
  console.log(`대상 문제: ${result.totalProblems}`);
  console.log(`저장한 코드 파일: ${result.savedSourceFiles}`);
  console.log(`기존 코드 파일: ${result.skippedSourceFiles}`);
  console.log(`전체 코드 파일: ${result.totalSourceFiles}`);
  console.log(`저장 경로: ${result.outputDir}`);
}

function createSubmissionsProgressReporter(
  username: string,
  estimatedTotalCount: number | null,
): {
  update: (progress: BojUserSubmissionFetchProgress) => void;
  finish: (submissions: BojUserSubmissionsSnapshot) => void;
  interrupt: () => void;
} {
  return {
    update(progress) {
      const delayLabel = formatRateLimitLabel(
        progress.nextDelayMs,
        progress.delayReason,
        progress.backoffAttempt,
      );
      const message = formatSubmissionProgressLogLine(
        "[submissions]",
        progress,
        estimatedTotalCount,
        delayLabel,
        username,
      );

      process.stderr.write(`${message}\n`);
    },
    finish(submissions) {
      const message =
        `[submissions] ${username} done: ${submissions.totalCount} rows from ${submissions.pagesFetched} pages`;
      process.stderr.write(`${message}\n`);
    },
    interrupt() {
      return;
    },
  };
}

function createSyncStageReporter(): {
  stage: (progress: BackupSyncStageProgress) => void;
  log: (message: string) => void;
  submissions: (progress: BojUserSubmissionFetchProgress) => void;
  problems: (progress: ProblemBackupProgress) => void;
  finish: (result: { username: string; resumed: boolean }) => void;
  interrupt: () => void;
} {
  return {
    stage(progress) {
      process.stderr.write(
        `[sync] ${progress.phaseIndex}/${progress.totalPhases} ${progress.username} ${formatSyncStageLabel(progress.phase)}\n`,
      );
    },
    log(message) {
      process.stderr.write(`[sync] ${message}\n`);
    },
    submissions(progress) {
      const delayLabel = formatRateLimitLabel(
        progress.nextDelayMs,
        progress.delayReason,
        progress.backoffAttempt,
      );
      const message = formatSubmissionProgressLogLine(
        "[sync:submissions]",
        progress,
        progress.estimatedTotalCount,
        delayLabel,
      );
      process.stderr.write(`${message}\n`);
    },
    problems(progress) {
      if (progress.phase === "init" || progress.currentProblemId === null) {
        process.stderr.write(
          `[sync:problems] ${progress.username} selected ${progress.totalProblems}/${progress.availableProblems}, ` +
            `filter ${progress.selectionSummary}, existing ${progress.knownExistingProblems}, output ${progress.outputDir}\n`,
        );
        return;
      }

      const delayLabel = formatRateLimitLabel(
        progress.nextDelayMs,
        progress.delayReason,
        progress.backoffAttempt,
      );
      const problemLabel = formatProblemTaskLabel(progress);

      switch (progress.phase) {
        case "skip-existing":
          process.stderr.write(
            `[sync:problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} skip\n`,
          );
          process.stderr.write("  └─ 이미 완료된 문제 폴더라 건너뜀\n");
          return;
        case "fetch-problem-page":
          process.stderr.write(
            `[sync:problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} 문제 다운로드 중, delay ${delayLabel}\n`,
          );
          return;
        case "fetch-problem-metadata":
          process.stderr.write(
            `[sync:problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} solved.ac 메타 다운로드 중, delay ${delayLabel}\n`,
          );
          return;
        case "fetch-submission-sources":
          process.stderr.write(
            `[sync:problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} 제출 코드 다운로드 중 ${formatSourceProgressLabel(progress)}, delay ${delayLabel}\n`,
          );
          return;
        case "write-problem-files":
          process.stderr.write(
            `[sync:problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} 폴더 저장 중, delay ${delayLabel}\n`,
          );
          process.stderr.write(renderProblemTaskTree(progress, false));
          return;
        case "problem-complete":
          process.stderr.write(
            `[sync:problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} 완료\n`,
          );
          process.stderr.write(renderProblemTaskTree(progress, true));
          return;
      }
    },
    finish(result) {
      process.stderr.write(
        `[sync] ${result.username} done${result.resumed ? " (resumed)" : ""}\n`,
      );
    },
    interrupt() {
      return;
    },
  };
}

function formatSyncStageLabel(phase: BackupSyncStageProgress["phase"]): string {
  switch (phase) {
    case "profile":
      return "프로필 수집";
    case "submissions":
      return "제출 기록 수집";
    case "problems":
      return "문제 백업";
  }
}

function createProblemBackupProgressReporter(): {
  update: (progress: ProblemBackupProgress) => void;
  finish: (result: ProblemBackupResult) => void;
  interrupt: () => void;
} {
  let started = false;

  return {
    update(progress) {
      if (!started) {
        started = true;
        const startMessage =
          `[problems] ${progress.username} selected ${progress.totalProblems}/${progress.availableProblems}, ` +
          `filter ${progress.selectionSummary}, ` +
          `existing ${progress.knownExistingProblems}, output ${progress.outputDir}`;
        process.stderr.write(`${startMessage}\n`);
      }

      if (progress.phase === "init" || progress.currentProblemId === null) {
        return;
      }

      const delayLabel = formatRateLimitLabel(
        progress.nextDelayMs,
        progress.delayReason,
        progress.backoffAttempt,
      );
      const problemLabel = formatProblemTaskLabel(progress);

      switch (progress.phase) {
        case "skip-existing":
          process.stderr.write(
            `[problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} skip\n`,
          );
          process.stderr.write("  └─ 이미 완료된 문제 폴더라 건너뜀\n");
          return;
        case "fetch-problem-page":
          process.stderr.write(
            `[problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} 문제 다운로드 중, delay ${delayLabel}\n`,
          );
          return;
        case "fetch-problem-metadata":
          process.stderr.write(
            `[problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} solved.ac 메타 다운로드 중, delay ${delayLabel}\n`,
          );
          return;
        case "fetch-submission-sources":
          process.stderr.write(
            `[problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} 제출 코드 다운로드 중 ${formatSourceProgressLabel(progress)}, delay ${delayLabel}\n`,
          );
          return;
        case "write-problem-files":
          process.stderr.write(
            `[problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} 폴더 저장 중, delay ${delayLabel}\n`,
          );
          process.stderr.write(renderProblemTaskTree(progress, false));
          return;
        case "problem-complete":
          process.stderr.write(
            `[problems] ${progress.completedProblems}/${progress.totalProblems} ${problemLabel} 완료\n`,
          );
          process.stderr.write(renderProblemTaskTree(progress, true));
          return;
      }
    },
    finish(result) {
      if (started) {
        process.stderr.write(
          `[problems] ${result.username} done: ${result.totalProblems}/${result.availableProblems}, ` +
            `saved ${result.savedProblems}, existing ${result.skippedProblems}\n`,
        );
      }
    },
    interrupt() {
      return;
    },
  };
}

function formatProblemTaskLabel(progress: ProblemBackupProgress): string {
  const directoryLabel = progress.currentProblemDir
    ? formatDisplayPath(progress.currentProblemDir)
    : `#${progress.currentProblemId}`;
  const titleSuffix = progress.currentProblemTitle ? ` (${progress.currentProblemTitle})` : "";
  return `${directoryLabel}${titleSuffix}`;
}

function renderProblemTaskTree(progress: ProblemBackupProgress, completed: boolean): string {
  const submissionCountLabel =
    progress.currentSubmissionCount === null
      ? ""
      : ` (${formatNumber(progress.currentSubmissionCount)}개 제출)`;
  const sourceCountLabel =
    progress.totalSourceFiles === null
      ? ""
      : ` (${formatNumber(progress.totalSourceFiles)}개 코드)`;
  const prefix = completed ? "[ok]" : "[..]";

  return [
    `  ├─ ${prefix} index.html (문제 페이지)`,
    `  ├─ ${prefix} meta.json (티어/태그 메타)`,
    `  ├─ ${prefix} submissions.json (문제별 제출 기록)${submissionCountLabel}`,
    `  └─ ${prefix} sources/ (제출 코드 폴더)${sourceCountLabel}`,
  ].join("\n") + "\n";
}

function formatSourceProgressLabel(progress: ProblemBackupProgress): string {
  if (
    progress.currentSourceIndex === null ||
    progress.totalSourceFiles === null ||
    progress.currentSubmissionId === null
  ) {
    return "";
  }

  return `${progress.currentSourceIndex}/${progress.totalSourceFiles} (#${progress.currentSubmissionId})`;
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

function announceSubmissionsResume(
  checkpointPath: string,
  checkpoint: BojUserSubmissionsCheckpoint,
): void {
  const limitCount = checkpoint.limitCount ?? null;
  const message =
    `[submissions] resuming ${checkpoint.username}: ` +
    `${checkpoint.totalCount} rows from ${checkpoint.pagesFetched} pages ` +
    `${limitCount !== null ? `(limit ${limitCount}) ` : ""}` +
    `(${checkpointPath})`;
  process.stderr.write(`${message}\n`);
}

async function removeFileIfExists(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

function isNodeError(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code;
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

function formatProblemSelectionProgressLabel(progress: BojUserSubmissionFetchProgress): string | null {
  if (
    progress.selectedProblemCount === null ||
    progress.selectedProblemCount === undefined ||
    progress.completedProblemCount === null ||
    progress.completedProblemCount === undefined ||
    progress.selectedProblemCount <= 0
  ) {
    return null;
  }

  const percent = ((progress.completedProblemCount / progress.selectedProblemCount) * 100).toFixed(1);
  return `${progress.completedProblemCount}/${progress.selectedProblemCount} problems (${percent}%)`;
}

function formatCurrentProblemLabel(progress: BojUserSubmissionFetchProgress): string | null {
  if (progress.currentProblemId === null || progress.currentProblemId === undefined) {
    return null;
  }

  return `#${progress.currentProblemId}`;
}

function formatSubmissionProgressLogLine(
  prefix: string,
  progress: BojUserSubmissionFetchProgress,
  estimatedTotalCount: number | null,
  delayLabel: string,
  usernameOverride?: string,
): string {
  const username = usernameOverride ?? progress.username;
  const problemProgressLabel = formatProblemSelectionProgressLabel(progress);
  const currentProblemLabel = formatCurrentProblemLabel(progress);

  if (problemProgressLabel) {
    return (
      `${prefix} ${username} problems ${problemProgressLabel}` +
      (currentProblemLabel ? `, current ${currentProblemLabel}` : "") +
      `, page ${progress.pagesFetched}, rows ${progress.rowsFetched}` +
      (progress.lastSubmissionId ? `, last #${progress.lastSubmissionId}` : "") +
      `, delay ${delayLabel}`
    );
  }

  const progressLabel = formatSubmissionProgressLabel(
    progress.rowsFetched,
    estimatedTotalCount,
    progress.limitCount,
  );
  return (
    `${prefix} ${username} page ${progress.pagesFetched}, ${progressLabel}` +
    (progress.lastSubmissionId ? `, last #${progress.lastSubmissionId}` : "") +
    `, delay ${delayLabel}`
  );
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
