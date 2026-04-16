import type { FormEvent, JSX } from "react";
import { Component } from "react";

import type { DashboardResumeState, DashboardStateResponse } from "../dashboard-types.js";
import {
  PipelineStageCard,
  ProblemCrawlProgressCard,
  ResumeCheckpointCard,
  TaskVisualization,
} from "./dashboard-components.js";
import { refreshState, startTask, stopCurrentTask } from "./dashboard-api.js";
import {
  buildHeroStats,
  buildPipelineStages,
  type PipelineStageModel,
  buildTaskVisualization,
  extractProblemCrawlProgress,
  extractTaskProgress,
  getTaskStatusMeta,
  renderStatusRows,
} from "./dashboard-models.js";
import { DASHBOARD_STYLE } from "./dashboard-style.js";
import { JsonScript, ViewerDocument } from "./render.js";

export function renderDashboardReactPage(state: DashboardStateResponse): string {
  return ViewerDocument({
    title: "BOJ Backup Dashboard",
    includeUserInfoCss: true,
    styleText: DASHBOARD_STYLE,
    body: (
      <div id="dashboard-root">
        <DashboardApp initialState={state} />
      </div>
    ),
    scripts: (
      <>
        <JsonScript id="dashboard-initial-state" value={state} />
        <script type="module" src="/assets/dashboard-client.js" />
      </>
    ),
  });
}

interface DashboardAppProps {
  initialState: DashboardStateResponse;
}

interface DashboardAppState {
  dashboardState: DashboardStateResponse;
  expandedStageKey: PipelineStageModel["key"] | null;
  pendingActionKey: string | null;
  resumePendingKey: string | null;
  logsExpanded: boolean;
}

export class DashboardApp extends Component<DashboardAppProps, DashboardAppState> {
  private pollingIntervalId: number | null = null;

  public constructor(props: DashboardAppProps) {
    super(props);
    const initialPipelineStages = buildPipelineStages(props.initialState.artifacts, props.initialState.task);
    this.state = {
      dashboardState: props.initialState,
      expandedStageKey: resolveDefaultExpandedStage(initialPipelineStages),
      pendingActionKey: null,
      resumePendingKey: null,
      logsExpanded: false,
    };
  }

  public componentDidMount(): void {
    this.pollingIntervalId = window.setInterval(() => {
      void this.reloadState();
    }, 1500);
  }

  public componentWillUnmount(): void {
    if (this.pollingIntervalId !== null) {
      window.clearInterval(this.pollingIntervalId);
      this.pollingIntervalId = null;
    }
  }

  private readonly reloadState = async (showAlertOnError = false): Promise<void> => {
    const dashboardState = await refreshState(showAlertOnError);
    if (dashboardState) {
      this.setState({ dashboardState });
    }
  };

  private readonly startPipelineTask = async (
    pendingActionKey: string,
    endpoint: string,
    body = new URLSearchParams(),
  ): Promise<void> => {
    this.setState({ pendingActionKey });
    try {
      await startTask(endpoint, body);
      await this.reloadState(true);
    } finally {
      this.setState({ pendingActionKey: null });
    }
  };

  private readonly handleStageToggle = (stageKey: PipelineStageModel["key"]): void => {
    this.setState((previousState) => ({
      expandedStageKey: previousState.expandedStageKey === stageKey ? null : stageKey,
    }));
  };

  private readonly handleProfileStart = async (): Promise<void> => {
    await this.startPipelineTask("profile", "/api/tasks/profile");
  };

  private readonly handleArchiveStart = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const body = createFormBody(event.currentTarget);
    if (body.has("startFresh")) {
      body.delete("startFresh");
      body.set("resume", "off");
    } else {
      body.set("resume", "on");
    }
    await this.startPipelineTask("archive", "/api/tasks/archive", body);
  };

  private readonly handleStopCurrentTask = async (): Promise<void> => {
    const dashboardState = await stopCurrentTask();
    if (dashboardState) {
      this.setState({ dashboardState });
    }
  };

  private readonly handleResumeStart = async (resume: DashboardResumeState): Promise<void> => {
    this.setState({ resumePendingKey: resume.key });
    try {
      await startTask(resume.action.endpoint, createBodyFromRecord(resume.action.body));
      await this.reloadState(true);
    } finally {
      this.setState({ resumePendingKey: null });
    }
  };

  private readonly handleLogsToggle = (): void => {
    this.setState((previousState) => ({
      logsExpanded: !previousState.logsExpanded,
    }));
  };

  public render(): JSX.Element {
    const { dashboardState, expandedStageKey, pendingActionKey, resumePendingKey, logsExpanded } = this.state;
    const running = !!(
      dashboardState.task &&
      (dashboardState.task.status === "running" || dashboardState.task.status === "stopping")
    );
    const profileUrl = dashboardState.artifacts.profile.infoUrl ?? "https://www.acmicpc.net/user";
    const languageUrl = dashboardState.artifacts.profile.languageUrl ?? "https://www.acmicpc.net/user/language";
    const problemsUrl = dashboardState.artifacts.problems.listUrl ?? "/problems";
    const pipelineStages = buildPipelineStages(dashboardState.artifacts, dashboardState.task);
    const taskVisualization = buildTaskVisualization(dashboardState.task);
    const problemCrawlProgress = extractProblemCrawlProgress(dashboardState.task);
    const taskProgress = extractTaskProgress(dashboardState.task);
    const taskStatus = dashboardState.task ? getTaskStatusMeta(dashboardState.task.status) : null;

    return (
      <div className="wrapper">
        <div className="header no-print">
          <div className="navbar navbar-default mega-menu dashboard-nav" role="navigation">
            <div className="container">
              <div className="navbar-header">
                <a className="navbar-brand" href="/">
                  <img
                    id="logo-header"
                    src="https://d2gd6pc034wcta.cloudfront.net/images/logo@2x.png"
                    alt="Logo"
                    data-retina=""
                  />
                </a>
              </div>
              <div className="collapse navbar-collapse navbar-responsive-collapse">
                <ul className="nav navbar-nav">
                  <li><a href={profileUrl} target={dashboardState.artifacts.profile.exists ? undefined : "_blank"} rel={dashboardState.artifacts.profile.exists ? undefined : "noreferrer"}>프로필</a></li>
                  <li><a href={languageUrl} target={dashboardState.artifacts.profile.exists ? undefined : "_blank"} rel={dashboardState.artifacts.profile.exists ? undefined : "noreferrer"}>언어</a></li>
                  <li><a href={problemsUrl}>문제 백업</a></li>
                  <li className="active"><a href="/">대시보드</a></li>
                </ul>
                <span className="navbar-text dashboard-nav-note">local backup dashboard</span>
              </div>
            </div>
          </div>
        </div>

        <div className="container content">
          <div className="row dashboard-section-gap">
            <div className="col-md-12">
              <div className="page-header dashboard-page-header">
                <h1>BOJ Backup Dashboard</h1>
                <blockquote className="no-mathjax">
                  <span className="dashboard-subtitle">
                    프로필 JSON을 먼저 만들고, 그 다음 문제 단위로 제출/지문/코드를 함께 백업합니다.
                  </span>
                </blockquote>
              </div>
            </div>
          </div>

          <div className="row dashboard-section-gap">
            {buildHeroStats(dashboardState.artifacts).map((item) => (
              <div key={item.label} className="col-sm-6 col-md-3">
                <div className="dashboard-stat-card">
                  <span className="dashboard-stat-label">{item.label}</span>
                  <span className="dashboard-stat-value">{item.value}</span>
                  <span className="dashboard-stat-note">{item.note}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="row">
            <div className="col-md-6">
              <div className="panel panel-default dashboard-section-gap" id="artifacts-panel-anchor">
                <div className="panel-heading"><h3 className="panel-title">백업 파이프라인</h3></div>
                <div className="panel-body">
                  <div className="dashboard-pipeline">
                    {pipelineStages.map((stage, index) => (
                      <PipelineStageCard
                        key={stage.key}
                        stage={stage}
                        showConnector={index < pipelineStages.length - 1}
                        expanded={expandedStageKey === stage.key}
                        onToggle={this.handleStageToggle}
                      >
                        {this.renderPipelineStageBody(stage, running, pendingActionKey)}
                      </PipelineStageCard>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-md-6">
              <div className="panel panel-default dashboard-section-gap" id="task-panel-anchor">
                <div className="panel-heading"><h3 className="panel-title">현재 작업</h3></div>
                <div className="panel-body">
                  {dashboardState.task ? (
                    <>
                      <div className="clearfix">
                        <span className={`dashboard-status-badge ${taskStatus?.className ?? "idle"}`}>
                          {taskStatus?.label ?? "대기"}
                        </span>
                        {dashboardState.task.status === "running" || dashboardState.task.status === "stopping" ? (
                          <div className="pull-right dashboard-task-controls">
                            <button
                              type="button"
                              className="btn btn-default btn-xs"
                              disabled={dashboardState.task.status === "stopping"}
                              onClick={() => void this.handleStopCurrentTask()}
                            >
                              중지 요청
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <h3 className="dashboard-task-title">{dashboardState.task.title}</h3>
                      <p className="dashboard-task-meta">
                        시작: {dashboardState.task.startedAt}
                        {dashboardState.task.finishedAt ? ` · 종료: ${dashboardState.task.finishedAt}` : ""}
                      </p>
                      {dashboardState.task.summary ? <div className="alert alert-info">{dashboardState.task.summary}</div> : null}
                      {taskVisualization ? <TaskVisualization model={taskVisualization} /> : null}
                      {problemCrawlProgress ? <ProblemCrawlProgressCard model={problemCrawlProgress} /> : null}
                      {!problemCrawlProgress && taskProgress ? (
                        <div className="dashboard-progress">
                          <div className="dashboard-progress-meta">
                            <span>진행률</span>
                            <span>{taskProgress.label}</span>
                          </div>
                          <div className="progress progress-u">
                            <div
                              className="progress-bar progress-bar-u"
                              role="progressbar"
                              style={{ width: `${taskProgress.percent.toFixed(1)}%` }}
                            />
                          </div>
                        </div>
                      ) : null}
                      <div className="table-responsive">
                        <table className="table table-striped dashboard-status-table">
                          <tbody>
                            {renderStatusRows(dashboardState.task.statusLines)}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : (
                    <p className="dashboard-empty">아직 실행된 작업이 없습니다.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="row">
            <div className="col-md-12">
              <div className="panel panel-default dashboard-section-gap" id="log-panel-anchor">
                <div className="panel-heading dashboard-foldout-heading">
                  <h3 className="panel-title">최근 로그</h3>
                  <button
                    type="button"
                    className="btn btn-default btn-xs dashboard-foldout-toggle"
                    onClick={this.handleLogsToggle}
                  >
                    {logsExpanded ? "접기" : "펼치기"}
                  </button>
                </div>
                {logsExpanded ? (
                  <div className="panel-body dashboard-log-panel">
                    {dashboardState.task && dashboardState.task.logs.length > 0 ? (
                      <ul className="list-group dashboard-log-list">
                        {dashboardState.task.logs.map((line, index) => (
                          <li key={`${index}-${line}`} className="list-group-item">{line}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="dashboard-empty">로그가 없습니다.</p>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {dashboardState.resume.length > 0 ? (
            <div className="row">
              <div className="col-md-12">
                <div className="panel panel-default dashboard-section-gap" id="resume-panel">
                  <div className="panel-heading"><h3 className="panel-title">체크포인트 / 이어받기</h3></div>
                  <div className="panel-body">
                    <div className="dashboard-resume-stack">
                      {dashboardState.resume.map((resume) => (
                        <ResumeCheckpointCard
                          key={resume.key}
                          resume={resume}
                          disabled={running}
                          pending={resumePendingKey === resume.key}
                          onResume={(nextResume) => void this.handleResumeStart(nextResume)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  private renderPipelineStageBody(
    stage: PipelineStageModel,
    running: boolean,
    pendingActionKey: string | null,
  ): JSX.Element {
    const blocked = stage.state === "blocked";

    if (stage.key === "profile") {
      return (
        <div className="dashboard-stage-section">
          <div className="dashboard-note-box">
            현재 로그인한 사용자의 프로필과 언어 통계를 `profile.json`으로 다시 저장합니다.
          </div>
          <button
            type="button"
            className="btn btn-u btn-u-blue btn-block"
            disabled={running || pendingActionKey === "profile"}
            onClick={() => void this.handleProfileStart()}
          >
            {pendingActionKey === "profile" ? "시작 중..." : "프로필 JSON 다시 수집"}
          </button>
        </div>
      );
    }

    return (
      <form className="dashboard-stage-form" onSubmit={this.handleArchiveStart}>
        <div className="dashboard-note-box">
          프로필에서 문제 목록을 뽑은 뒤 문제 번호 오름차순으로 정렬하고, 각 문제마다 제출 내역을 수집하고 바로 문제 HTML, 메타데이터, 제출 코드를 저장합니다.
          `submissions.json` 도 이 과정에서 같이 갱신됩니다.
        </div>
        <div className="form-group">
          <label htmlFor="pipeline-problem-limit">최대 문제 수</label>
          <input
            id="pipeline-problem-limit"
            className="form-control"
            name="problemLimit"
            type="number"
            min="1"
            step="1"
            placeholder="비우면 전체"
          />
          <p className="dashboard-stage-help">이미 백업되지 않은 문제 기준으로 문제 번호 오름차순 최대 N개만 추가합니다.</p>
        </div>
        <div className="checkbox dashboard-stage-checkbox">
          <label>
            <input name="overwrite" type="checkbox" />
            이미 저장된 문제도 다시 저장
          </label>
        </div>
        <div className="checkbox dashboard-stage-checkbox">
          <label>
            <input name="startFresh" type="checkbox" />
            체크포인트를 무시하고 처음부터 다시 수집
          </label>
        </div>
        <button
          type="submit"
          className="btn btn-u btn-u-blue btn-block"
          disabled={running || blocked || pendingActionKey === "archive"}
        >
          {pendingActionKey === "archive" ? "시작 중..." : "문제 아카이브 다시 실행"}
        </button>
      </form>
    );
  }
}

function createFormBody(form: HTMLFormElement): URLSearchParams {
  const formData = new FormData(form);
  const body = new URLSearchParams();

  formData.forEach((value, key) => {
    if (typeof value === "string") {
      body.append(key, value);
    }
  });

  return body;
}

function createBodyFromRecord(values: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    body.append(key, value);
  }

  return body;
}

function resolveDefaultExpandedStage(
  stages: PipelineStageModel[],
): PipelineStageModel["key"] | null {
  const activeStage = stages.find((stage) => stage.state === "active");
  if (activeStage) {
    return activeStage.key;
  }

  const pendingStage = stages.find((stage) => stage.state === "pending");
  if (pendingStage) {
    return pendingStage.key;
  }

  const blockedStage = stages.find((stage) => stage.state === "blocked");
  if (blockedStage) {
    return blockedStage.key;
  }

  return stages[0]?.key ?? null;
}
