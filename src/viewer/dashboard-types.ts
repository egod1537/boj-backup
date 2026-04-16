export type DashboardTaskKind = "sync" | "profile" | "archive" | "submissions" | "problems";
export type DashboardTaskStatus = "idle" | "running" | "stopping" | "stopped" | "completed" | "failed";
export type DashboardResumeKind = "sync" | "archive" | "submissions";

export interface DashboardArtifactPaths {
  rootDir: string;
  profilePath: string;
  submissionsPath: string;
  problemsDir: string;
}

export interface DashboardTaskSnapshot {
  id: number;
  kind: DashboardTaskKind;
  title: string;
  status: DashboardTaskStatus;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  statusLines: string[];
  logs: string[];
  stopRequested: boolean;
}

export interface DashboardArtifactsState {
  sync: {
    exists: boolean;
    path: string;
    username: string | null;
    phase: string | null;
    updatedAt: string | null;
  };
  profile: {
    exists: boolean;
    path: string;
    username: string | null;
    fetchedAt: string | null;
    infoUrl: string | null;
    languageUrl: string | null;
  };
  submissions: {
    exists: boolean;
    path: string;
    username: string | null;
    fetchedAt: string | null;
    totalCount: number | null;
    statusUrl: string | null;
  };
  problems: {
    exists: boolean;
    path: string;
    totalCount: number;
    listUrl: string | null;
  };
}

export interface DashboardResumeActionState {
  endpoint: string;
  label: string;
  body: Record<string, string>;
}

export interface DashboardResumeState {
  key: string;
  kind: DashboardResumeKind;
  title: string;
  username: string;
  updatedAt: string;
  phase: string;
  phaseIndex: number;
  totalPhases: number;
  progressPercent: number;
  progressLabel: string;
  note: string;
  submissionLimit: number | null;
  problemLimit: number | null;
  problemFilter: string | null;
  action: DashboardResumeActionState;
}

export interface DashboardStateResponse {
  artifacts: DashboardArtifactsState;
  resume: DashboardResumeState[];
  task: DashboardTaskSnapshot | null;
}

export interface ProblemListEntry {
  problemId: number;
  title: string | null;
  tierLevel: number | null;
  tierLabel: string | null;
  submissionCount: number | null;
  tagNames: string[];
  tagAliases: string[];
  problemUrl: string;
}
