import type { FormEvent, JSX } from "react";
import { Component } from "react";

import type { DashboardResumeState, DashboardStateResponse } from "../dashboard-types.js";
import {
  ArtifactCard,
  ProblemCrawlProgressCard,
  ResumeCheckpointCard,
  TaskVisualization,
} from "./dashboard-components.js";
import { refreshState, startTask, stopCurrentTask } from "./dashboard-api.js";
import {
  buildArtifactCards,
  buildHeroStats,
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
  profilePending: boolean;
  archivePending: boolean;
  resumePendingKey: string | null;
}

export class DashboardApp extends Component<DashboardAppProps, DashboardAppState> {
  private pollingIntervalId: number | null = null;

  public constructor(props: DashboardAppProps) {
    super(props);
    this.state = {
      dashboardState: props.initialState,
      profilePending: false,
      archivePending: false,
      resumePendingKey: null,
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

  private readonly handleProfileStart = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    this.setState({ profilePending: true });
    try {
      await startTask("/api/tasks/profile");
      await this.reloadState(true);
    } finally {
      this.setState({ profilePending: false });
    }
  };

  private readonly handleArchiveStart = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    this.setState({ archivePending: true });
    try {
      await startTask("/api/tasks/archive", createFormBody(event.currentTarget));
      await this.reloadState(true);
    } finally {
      this.setState({ archivePending: false });
    }
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

  public render(): JSX.Element {
    const { dashboardState, profilePending, archivePending, resumePendingKey } = this.state;
    const running = !!(
      dashboardState.task &&
      (dashboardState.task.status === "running" || dashboardState.task.status === "stopping")
    );
    const profileUrl = dashboardState.artifacts.profile.infoUrl ?? "https://www.acmicpc.net/user";
    const languageUrl = dashboardState.artifacts.profile.languageUrl ?? "https://www.acmicpc.net/user/language";
    const statusUrl = dashboardState.artifacts.submissions.statusUrl ?? "https://www.acmicpc.net/status";
    const problemsUrl = dashboardState.artifacts.problems.listUrl ?? "/problems";
    const artifactCards = buildArtifactCards(dashboardState.artifacts);
    const taskVisualization = buildTaskVisualization(dashboardState.task);
    const problemCrawlProgress = extractProblemCrawlProgress(dashboardState.task);
    const taskProgress = extractTaskProgress(dashboardState.task);
    const taskStatus = dashboardState.task ? getTaskStatusMeta(dashboardState.task.status) : null;

    return (
      <div className="wrapper">
        <div className="header no-print">
          <div className="topbar">
            <div className="container">
              <ul className="loginbar pull-right">
                <li><a href="https://www.acmicpc.net/register" target="_blank" rel="noreferrer">회원가입</a></li>
                <li className="topbar-devider" />
                <li><a href="https://www.acmicpc.net/login" target="_blank" rel="noreferrer">로그인</a></li>
              </ul>
            </div>
          </div>
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
                    프로필 크롤링과 문제 + 제출코드 크롤링을 분리해서 실행하고, 각 단계는 이어받을 수 있습니다.
                  </span>
                  <div className="tab-v2">
                    <ul className="nav nav-tabs">
                      <li className="active"><a href="/">대시보드</a></li>
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
            <div className="col-md-4">
              <div className="panel panel-default dashboard-section-gap" id="profile-panel">
                <div className="panel-heading"><h3 className="panel-title">프로필 크롤링</h3></div>
                <div className="panel-body">
                  <form className="dashboard-form" onSubmit={this.handleProfileStart}>
                    <div className="dashboard-note-box">
                      현재 로그인한 사용자의 프로필과 언어 통계를 기본 경로에 저장합니다.
                    </div>
                    <button type="submit" className="btn btn-u btn-u-blue btn-block" disabled={running || profilePending}>
                      {profilePending ? "시작 중..." : "프로필 크롤링 시작"}
                    </button>
                  </form>
                </div>
              </div>

              <div className="panel panel-default dashboard-section-gap" id="archive-panel">
                <div className="panel-heading"><h3 className="panel-title">문제 + 제출코드 크롤링</h3></div>
                <div className="panel-body">
                  <form className="dashboard-form" onSubmit={this.handleArchiveStart}>
                    <div className="dashboard-note-box">
                      <strong>프로필 선행 필요</strong> 프로필 크롤링 후 시작됩니다. 기본값으로 체크포인트 이어받기와 기본 저장 경로를 사용합니다.
                    </div>
                    <div className="form-group">
                      <label htmlFor="archive-problem-limit">최대 문제 수</label>
                      <input
                        id="archive-problem-limit"
                        className="form-control"
                        name="problemLimit"
                        type="number"
                        min="1"
                        step="1"
                        placeholder="비우면 전체"
                      />
                    </div>
                    <button type="submit" className="btn btn-u btn-u-blue btn-block" disabled={running || archivePending}>
                      {archivePending ? "시작 중..." : "문제 + 제출코드 크롤링 시작"}
                    </button>
                  </form>
                </div>
              </div>

              {dashboardState.resume.length > 0 ? (
                <div className="panel panel-default dashboard-section-gap" id="resume-panel">
                  <div className="panel-heading"><h3 className="panel-title">이어받기</h3></div>
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
              ) : null}
            </div>

            <div className="col-md-8">
              <div className="panel panel-default dashboard-section-gap" id="artifacts-panel-anchor">
                <div className="panel-heading"><h3 className="panel-title">저장 결과</h3></div>
                <div className="panel-body">
                  <div className="dashboard-artifact-grid">
                    {artifactCards.map((card) => (
                      <ArtifactCard key={card.title} card={card} />
                    ))}
                  </div>
                </div>
              </div>

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

              <div className="panel panel-default dashboard-section-gap" id="log-panel-anchor">
                <div className="panel-heading"><h3 className="panel-title">최근 로그</h3></div>
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
              </div>
            </div>
          </div>
        </div>
      </div>
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
