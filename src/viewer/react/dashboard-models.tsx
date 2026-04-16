import type { JSX } from "react";

import type {
  DashboardArtifactsState,
  DashboardTaskSnapshot,
  DashboardTaskStatus,
} from "../dashboard-types.js";

export interface ArtifactCardModel {
  tone: "sync" | "profile" | "submissions" | "problems";
  title: string;
  exists: boolean;
  value: string;
  note: string;
  actions: Array<
    | { type: "button"; label: string; key: string }
    | { type: "link"; label: string; href: string; primary: boolean; external: boolean }
  >;
}

export type VisualState = "pending" | "active" | "completed" | "failed" | "stopped";

export interface VisualStep {
  label: string;
  note: string;
  state: VisualState;
}

export interface TaskVisualizationModel {
  steps: VisualStep[];
  checklistTitle: string | null;
  checklist: VisualStep[];
}

export interface HeroStatModel {
  label: string;
  value: string;
  note: string;
}

export interface TaskProgressModel {
  percent: number;
  label: string;
}

export interface ProblemCrawlProgressModel {
  percent: number;
  completedProblems: number;
  totalProblems: number;
  savedProblems: number | null;
  skippedProblems: number | null;
  remainingProblems: number;
  availableProblems: number | null;
  selectionSummary: string | null;
  currentProblem: string | null;
  currentPhase: string | null;
  currentSubmissionCount: string | null;
  sourceProgress: string | null;
}

export function buildHeroStats(artifacts: DashboardArtifactsState): HeroStatModel[] {
  return [
    {
      label: "체크포인트",
      value: artifacts.sync.exists ? (artifacts.sync.phase || "사용 중") : "없음",
      note: artifacts.sync.exists ? `업데이트 ${artifacts.sync.updatedAt || "-"}` : "대기 중인 백업 체크포인트 없음",
    },
    {
      label: "프로필",
      value: artifacts.profile.username || "-",
      note: artifacts.profile.exists ? `프로필 저장 ${artifacts.profile.fetchedAt || "-"}` : "아직 프로필 JSON 없음",
    },
    {
      label: "제출",
      value: artifacts.submissions.totalCount === null ? "-" : String(artifacts.submissions.totalCount),
      note: artifacts.submissions.exists ? `${artifacts.submissions.username || "-"} 제출 백업` : "아직 제출 JSON 없음",
    },
    {
      label: "문제",
      value: String(artifacts.problems.totalCount || 0),
      note: artifacts.problems.exists ? "백업된 문제 폴더" : "문제 폴더가 비어 있음",
    },
  ];
}

export function buildArtifactCards(artifacts: DashboardArtifactsState): ArtifactCardModel[] {
  return [
    {
      tone: "sync",
      title: "백업 체크포인트",
      exists: artifacts.sync.exists,
      value: artifacts.sync.exists ? (artifacts.sync.phase || "사용 중") : "없음",
      note: artifacts.sync.exists
        ? `사용자 ${artifacts.sync.username || "-"} · ${artifacts.sync.updatedAt || "-"}`
        : "현재 이어받을 sync 체크포인트가 없습니다.",
      actions: [{ type: "button", label: "체크포인트 위치 열기", key: "sync" }],
    },
    {
      tone: "profile",
      title: "프로필 JSON",
      exists: artifacts.profile.exists,
      value: artifacts.profile.username || "없음",
      note: artifacts.profile.exists
        ? `프로필 저장 시각 ${artifacts.profile.fetchedAt || "-"}`
        : "프로필 JSON이 아직 생성되지 않았습니다.",
      actions: [
        { type: "button", label: "저장 위치 열기", key: "profile" },
        ...(artifacts.profile.exists && artifacts.profile.infoUrl
          ? [{ type: "link", label: "프로필 보기", href: artifacts.profile.infoUrl, primary: true, external: false } as const]
          : []),
        ...(artifacts.profile.exists && artifacts.profile.languageUrl
          ? [{ type: "link", label: "언어 보기", href: artifacts.profile.languageUrl, primary: false, external: false } as const]
          : []),
      ],
    },
    {
      tone: "submissions",
      title: "제출 JSON",
      exists: artifacts.submissions.exists,
      value: artifacts.submissions.totalCount === null ? "없음" : String(artifacts.submissions.totalCount),
      note: artifacts.submissions.exists
        ? `사용자 ${artifacts.submissions.username || "-"} 제출 백업`
        : "제출 기록 JSON이 아직 생성되지 않았습니다.",
      actions: [
        { type: "button", label: "저장 위치 열기", key: "submissions" },
        ...(artifacts.submissions.exists && artifacts.submissions.statusUrl
          ? [{ type: "link", label: "제출 보기", href: artifacts.submissions.statusUrl, primary: true, external: false } as const]
          : []),
      ],
    },
    {
      tone: "problems",
      title: "문제 백업",
      exists: artifacts.problems.exists,
      value: String(artifacts.problems.totalCount || 0),
      note: artifacts.problems.exists
        ? "문제 폴더, 메타, 문제별 제출 기록과 코드가 저장돼 있습니다."
        : "문제 폴더가 아직 비어 있습니다.",
      actions: [
        { type: "button", label: "저장 위치 열기", key: "problems" },
        ...(artifacts.problems.exists && artifacts.problems.listUrl
          ? [{ type: "link", label: "문제 목록 보기", href: artifacts.problems.listUrl, primary: true, external: false } as const]
          : []),
      ],
    },
  ];
}

export function renderStatusRows(lines: string[]): JSX.Element[] {
  if (!lines || lines.length === 0) {
    return [
      <tr key="empty">
        <td colSpan={2} className="dashboard-empty">상태 정보가 없습니다.</td>
      </tr>,
    ];
  }

  return lines.map((line, index) => {
    const separator = line.indexOf(":");
    if (separator === -1) {
      return (
        <tr key={`line-${index}`}>
          <th>Status</th>
          <td>{line}</td>
        </tr>
      );
    }

    return (
      <tr key={`line-${index}`}>
        <th>{line.slice(0, separator).trim()}</th>
        <td>{line.slice(separator + 1).trim()}</td>
      </tr>
    );
  });
}

export function getTaskStatusMeta(status: DashboardTaskStatus): { label: string; className: string } {
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

export function extractTaskProgress(task: DashboardTaskSnapshot | null): TaskProgressModel | null {
  if (!task || !Array.isArray(task.statusLines)) {
    return null;
  }

  for (const line of task.statusLines) {
    const progressMatch = line.match(/진행:\s*(\d+)\/(\d+)/);
    if (progressMatch) {
      const done = Number(progressMatch[1]);
      const total = Number(progressMatch[2]);
      if (total > 0) {
        return {
          percent: Math.max(0, Math.min(100, (done / total) * 100)),
          label: `${done} / ${total}`,
        };
      }
    }

    const phaseMatch = line.match(/단계:\s*(\d+)\/(\d+)/);
    if (phaseMatch) {
      const done = Number(phaseMatch[1]);
      const total = Number(phaseMatch[2]);
      if (total > 0) {
        return {
          percent: Math.max(0, Math.min(100, (done / total) * 100)),
          label: `${done} / ${total} 단계`,
        };
      }
    }
  }

  return null;
}

export function extractProblemCrawlProgress(task: DashboardTaskSnapshot | null): ProblemCrawlProgressModel | null {
  const progressValue = getStatusValue(task, "진행");
  if (!progressValue) {
    return null;
  }

  const progressMatch = progressValue.match(
    /([\d,]+)\s*\/\s*([\d,]+)(?:\s*\(saved\s+([\d,]+),\s*skipped\s+([\d,]+)\))?/i,
  );
  if (!progressMatch) {
    return null;
  }

  const completedProblems = parseNumber(progressMatch[1]);
  const totalProblems = parseNumber(progressMatch[2]);
  if (completedProblems === null || totalProblems === null || totalProblems <= 0) {
    return null;
  }

  const targetValue = getStatusValue(task, "대상 문제");
  const targetMatch = targetValue?.match(/([\d,]+)\s*\/\s*([\d,]+)/);
  const availableProblems = targetMatch ? parseNumber(targetMatch[2]) : null;

  return {
    percent: Math.max(0, Math.min(100, (completedProblems / totalProblems) * 100)),
    completedProblems,
    totalProblems,
    savedProblems: parseNumber(progressMatch[3] ?? null),
    skippedProblems: parseNumber(progressMatch[4] ?? null),
    remainingProblems: Math.max(totalProblems - completedProblems, 0),
    availableProblems,
    selectionSummary: normalizeStatusValue(getStatusValue(task, "문제 선택")),
    currentProblem: normalizeStatusValue(getStatusValue(task, "현재 문제")),
    currentPhase: normalizeStatusValue(getStatusValue(task, "현재 단계")),
    currentSubmissionCount: normalizeStatusValue(getStatusValue(task, "문제별 제출 수")),
    sourceProgress: normalizeStatusValue(getStatusValue(task, "코드 다운로드")),
  };
}

function getStatusValue(task: DashboardTaskSnapshot | null, label: string): string | null {
  if (!task) {
    return null;
  }

  for (const line of task.statusLines) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    if (line.slice(0, separator).trim() === label) {
      return line.slice(separator + 1).trim();
    }
  }

  return null;
}

function normalizeStatusValue(value: string | null): string | null {
  if (!value || value === "-") {
    return null;
  }

  return value;
}

function parseNumber(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildTaskVisualization(task: DashboardTaskSnapshot | null): TaskVisualizationModel | null {
  if (!task) {
    return null;
  }

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

function resolveActiveVisualState(taskStatus: DashboardTaskStatus): VisualState {
  if (taskStatus === "failed") {
    return "failed";
  }
  if (taskStatus === "stopped" || taskStatus === "stopping") {
    return "stopped";
  }
  return "active";
}

function createLinearSteps(
  definitions: Array<{ label: string; note: string }>,
  activeIndex: number,
  completedCount: number,
  taskStatus: DashboardTaskStatus,
): VisualStep[] {
  return definitions.map((definition, index) => {
    let state: VisualState = "pending";
    if (taskStatus === "completed") {
      state = "completed";
    } else if (index < completedCount) {
      state = "completed";
    } else if (index === activeIndex) {
      state = resolveActiveVisualState(taskStatus);
    }

    return {
      label: definition.label,
      note: definition.note,
      state,
    };
  });
}

function buildProfilePhaseSteps(task: DashboardTaskSnapshot): VisualStep[] {
  const lines = task.statusLines.join(" ");
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

function buildSubmissionPhaseSteps(task: DashboardTaskSnapshot): VisualStep[] {
  const pageValue = getStatusValue(task, "페이지");
  const rowsValue = getStatusValue(task, "행 수");
  const problemProgressValue = getStatusValue(task, "문제 진행");
  const currentProblemValue = getStatusValue(task, "현재 문제");
  const lastSubmission = getStatusValue(task, "마지막 제출");

  return createLinearSteps([
    {
      label: "status 페이지 순회",
      note:
        problemProgressValue ||
        (currentProblemValue ? `현재 ${currentProblemValue}` : null) ||
        (rowsValue ? `수집 ${rowsValue}` : null) ||
        (pageValue ? `페이지 ${pageValue}` : "제출 기록 탐색"),
    },
    {
      label: "제출 JSON 저장",
      note: lastSubmission && lastSubmission !== "-" ? `마지막 ${lastSubmission}` : "submissions.json 기록",
    },
  ], 0, task.status === "completed" ? 2 : 0, task.status);
}

function buildProblemPhaseSteps(task: DashboardTaskSnapshot): VisualStep[] {
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
      note: sourceProgress && sourceProgress !== "-" ? sourceProgress : (submissionCount ? `제출 수 ${submissionCount}` : "코드 파일 수집"),
    },
    { label: "문제 폴더 저장", note: "index.html, meta.json, sources/" },
  ], activeIndex, completedCount, task.status);
}

function buildArchiveMajorSteps(task: DashboardTaskSnapshot): VisualStep[] {
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
    {
      label: "제출 기록 수집",
      note: getStatusValue(task, "문제 진행") || getStatusValue(task, "행 수") || "status 페이지 순회",
    },
    { label: "문제 백업", note: getStatusValue(task, "현재 문제") || "문제와 제출 코드 저장" },
  ], activeIndex, completedCount, task.status);
}

function buildSyncMajorSteps(task: DashboardTaskSnapshot): VisualStep[] {
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
    {
      label: "제출 기록",
      note: getStatusValue(task, "문제 진행") || getStatusValue(task, "행 수") || "submissions.json 생성",
    },
    { label: "문제 백업", note: getStatusValue(task, "현재 문제") || "문제와 코드 저장" },
  ], activeIndex, completedCount, task.status);
}

export function iconClassForState(state: VisualState): string {
  switch (state) {
    case "completed":
      return "fa fa-check";
    case "active":
      return "fa fa-circle-o-notch fa-spin";
    case "failed":
      return "fa fa-times";
    case "stopped":
      return "fa fa-pause";
    default:
      return "fa fa-circle-thin";
  }
}
