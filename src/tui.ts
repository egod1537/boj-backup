import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import type { BojUserSubmissionFetchProgress } from "./boj/session.js";
import type { ProblemBackupProgress } from "./problem-backup.js";
import { loadConfig } from "./config.js";
import { ConfigurationError } from "./errors.js";
import { runArchiveSyncWithAutoResume, type BackupSyncStageProgress } from "./sync.js";
import {
  createClient,
  createInterruptController,
  authenticateClient,
  writeJsonFile,
} from "./cli-support.js";
import { resolveUserArtifactPaths } from "./user-artifacts.js";
import { openProfileViewer } from "./viewer/profile-site.js";
import { startDashboardViewerServer } from "./viewer/dashboard-site.js";

export async function runSimpleTui(): Promise<void> {
  while (true) {
    console.clear();
    console.log("BOJ Backup");
    console.log("");
    console.log("1. 로그인 확인");
    console.log("2. 프로필 수집");
    console.log("3. 문제 + 제출코드 백업");
    console.log("4. 대시보드 열기");
    console.log("5. 종료");
    console.log("");

    const choice = await prompt("선택");
    console.log("");

    switch (choice.trim()) {
      case "1":
        await runMenuAction(runLoginMenuAction);
        break;
      case "2":
        await runMenuAction(runProfileMenuAction);
        break;
      case "3":
        await runMenuAction(runArchiveMenuAction);
        break;
      case "4":
        await runMenuAction(runDashboardMenuAction);
        break;
      case "5":
      case "q":
      case "Q":
        return;
      default:
        console.log("1-5 중 하나를 입력하세요.");
        await pause();
        break;
    }
  }
}

async function runLoginMenuAction(): Promise<void> {
  const config = loadConfig();
  const client = createClient(config);
  const username = await authenticateClient(client, config);
  const artifacts = resolveUserArtifactPaths(username);

  console.log(`로그인 확인 완료: ${username}`);
  console.log(`프로필 JSON: ${artifacts.profilePath}`);
  console.log(`제출 JSON: ${artifacts.submissionsPath}`);
  console.log(`문제 폴더: ${artifacts.problemsDir}`);
  await pause();
}

async function runProfileMenuAction(): Promise<void> {
  const config = loadConfig();
  const client = createClient(config);
  const username = await authenticateClient(client, config);
  const artifacts = resolveUserArtifactPaths(username);

  console.log(`[profile] ${username} 프로필 수집 시작`);
  const snapshot = await client.fetchUserSnapshot(username);
  await writeJsonFile(artifacts.profilePath, snapshot);
  console.log(`[profile] 저장 완료: ${artifacts.profilePath}`);
  await pause();
}

async function runArchiveMenuAction(): Promise<void> {
  const limitAnswer = await prompt("최대 문제 수 (엔터=전체)");
  const overwriteAnswer = await prompt("이미 저장된 문제도 다시 받을까요? [y/N]");
  const resumeAnswer = await prompt("이전 체크포인트에서 이어받을까요? [Y/n]");
  console.log("");

  const problemLimit = parseOptionalPositiveInteger(limitAnswer.trim());
  const overwriteProblems = /^y(es)?$/i.test(overwriteAnswer.trim());
  const resume = !/^n(o)?$/i.test(resumeAnswer.trim());

  const config = loadConfig();
  const client = createClient(config);
  const username = await authenticateClient(client, config);
  const artifacts = resolveUserArtifactPaths(username);
  const reporter = createTuiSyncReporter();
  const interrupt = createInterruptController(
    "백업 중지 요청을 받았습니다. 현재 요청이 끝나면 안전하게 정지합니다.",
  );

  try {
    const result = await runArchiveSyncWithAutoResume({
      client,
      handle: username,
      profilePath: artifacts.profilePath,
      submissionsPath: artifacts.submissionsPath,
      problemsDir: artifacts.problemsDir,
      problemLimit,
      resume,
      overwriteProblems,
      shouldStop: interrupt.shouldStop,
      onStage: reporter.stage,
      onLog: reporter.log,
      onSubmissionsProgress: reporter.submissions,
      onProblemProgress: reporter.problems,
    });

    reporter.finish(result.username);
    console.log(`프로필 JSON: ${result.profilePath}`);
    console.log(`제출 JSON: ${result.submissionsPath}`);
    console.log(`문제 폴더: ${result.problemsDir}`);
  } finally {
    interrupt.close();
  }

  await pause();
}

async function runDashboardMenuAction(): Promise<void> {
  const viewer = await startDashboardViewerServer({
    host: "127.0.0.1",
    port: 0,
  });

  console.log(`대시보드: ${viewer.dashboardUrl}`);
  console.log("브라우저를 열고 Enter를 누르면 서버를 종료합니다.");
  openProfileViewer(viewer.dashboardUrl);
  await pause("종료");
  await new Promise<void>((resolve, reject) => {
    viewer.server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function runMenuAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await pause();
  }
}

function createTuiSyncReporter(): {
  stage: (progress: BackupSyncStageProgress) => void;
  log: (message: string) => void;
  submissions: (progress: BojUserSubmissionFetchProgress) => void;
  problems: (progress: ProblemBackupProgress) => void;
  finish: (username: string) => void;
} {
  return {
    stage(progress) {
      const label = progress.phase === "submissions" ? "제출 JSON" : "문제 백업";
      console.log(`[archive] ${progress.phaseIndex}/${progress.totalPhases} ${label}`);
    },
    log(message) {
      console.log(`[archive] ${message}`);
    },
    submissions(progress) {
      console.log(
        `[archive:submissions] page ${progress.pagesFetched}, rows ${progress.rowsFetched}` +
          (progress.lastSubmissionId ? `, last #${progress.lastSubmissionId}` : ""),
      );
    },
    problems(progress) {
      if (progress.phase === "init") {
        console.log(
          `[archive:problems] ${progress.totalProblems}/${progress.availableProblems} selected`,
        );
        return;
      }

      if (progress.currentProblemId === null) {
        return;
      }

      if (progress.phase === "problem-complete") {
        console.log(
          `[archive:problems] ${progress.completedProblems}/${progress.totalProblems} #${progress.currentProblemId} 완료`,
        );
        return;
      }

      if (progress.phase === "skip-existing") {
        console.log(
          `[archive:problems] ${progress.completedProblems}/${progress.totalProblems} #${progress.currentProblemId} skip`,
        );
      }
    },
    finish(username) {
      console.log(`[archive] ${username} 백업 완료`);
    },
  };
}

async function prompt(label: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(`${label}: `);
  } finally {
    rl.close();
  }
}

async function pause(label = "계속"): Promise<void> {
  await prompt(`${label}하려면 Enter`);
}

function parseOptionalPositiveInteger(value: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigurationError(`잘못된 숫자입니다: ${value}`);
  }

  return parsed;
}
