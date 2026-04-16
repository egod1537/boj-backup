import type { JSX } from "react";
import { PureComponent } from "react";

import { openArtifactLocation } from "./dashboard-api.js";
import type { DashboardResumeState } from "../dashboard-types.js";
import type {
  ArtifactCardModel,
  ProblemCrawlProgressModel,
  TaskVisualizationModel,
  VisualStep,
} from "./dashboard-models.js";
import { iconClassForState } from "./dashboard-models.js";

export class ArtifactCard extends PureComponent<{ card: ArtifactCardModel }> {
  public render(): JSX.Element {
    const { card } = this.props;
    return (
      <div className={`dashboard-artifact-card ${card.tone}`}>
        <div className="dashboard-artifact-head">
          <h4>{card.title}</h4>
          <span className={`dashboard-artifact-flag ${card.exists ? "ready" : "empty"}`}>
            {card.exists ? "READY" : "EMPTY"}
          </span>
        </div>
        <span className="dashboard-artifact-value">{card.value}</span>
        <div className="dashboard-artifact-meta">{card.note}</div>
        <div className="dashboard-link-row">
          {card.actions.map((action) => action.type === "button" ? (
            <button
              key={action.label}
              type="button"
              className="btn btn-default btn-xs"
              onClick={() => void openArtifactLocation(action.key)}
            >
              {action.label}
            </button>
          ) : (
            <a
              key={action.label}
              className={`btn btn-xs ${action.primary ? "dashboard-btn-primary" : "btn-default"}`}
              href={action.href}
              target={action.external ? "_blank" : undefined}
              rel={action.external ? "noreferrer" : undefined}
            >
              {action.label}
            </a>
          ))}
        </div>
      </div>
    );
  }
}

export class TaskVisualization extends PureComponent<{ model: TaskVisualizationModel }> {
  public render(): JSX.Element {
    const { model } = this.props;
    return (
      <div className="dashboard-step-visual">
        {model.steps.length > 0 ? (
          <div className="dashboard-stepper">
            {model.steps.map((step, index) => (
              <StepCard key={`${step.label}-${index}`} step={step} showConnector={index < model.steps.length - 1} />
            ))}
          </div>
        ) : null}
        {model.checklist.length > 0 ? (
          <div className="dashboard-checklist">
            {model.checklistTitle ? <h4 className="dashboard-checklist-title">{model.checklistTitle}</h4> : null}
            <ul className="dashboard-checklist-list">
              {model.checklist.map((item, index) => (
                <li key={`${item.label}-${index}`} className={`dashboard-checklist-item ${item.state}`}>
                  <span className="dashboard-check-icon">
                    <i className={iconClassForState(item.state)} />
                  </span>
                  <div className="dashboard-check-content">
                    <span className="dashboard-check-label">{item.label}</span>
                    {item.note ? <span className="dashboard-check-note">{item.note}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }
}

export class ProblemCrawlProgressCard extends PureComponent<{ model: ProblemCrawlProgressModel }> {
  public render(): JSX.Element {
    const { model } = this.props;
    return (
      <div className="dashboard-problem-progress">
        <div className="dashboard-problem-progress-head">
          <div>
            <span className="dashboard-problem-progress-label">문제 크롤링 진행</span>
            <div className="dashboard-problem-progress-value">
              <strong>{model.completedProblems}</strong>
              <span>/ {model.totalProblems}</span>
            </div>
            <div className="dashboard-problem-progress-note">
              {model.selectionSummary ? `선택: ${model.selectionSummary}` : "선택 정보 없음"}
              {model.availableProblems !== null ? ` · 전체 후보 ${model.availableProblems}` : ""}
            </div>
          </div>
          <div className="dashboard-problem-progress-percent">{model.percent.toFixed(1)}%</div>
        </div>

        <div className="progress progress-u dashboard-problem-progress-bar">
          <div
            className="progress-bar progress-bar-u"
            role="progressbar"
            style={{ width: `${model.percent.toFixed(1)}%` }}
          />
        </div>

        <div className="dashboard-problem-progress-grid">
          <div className="dashboard-problem-progress-stat">
            <span className="dashboard-problem-progress-stat-label">저장됨</span>
            <strong>{model.savedProblems ?? 0}</strong>
          </div>
          <div className="dashboard-problem-progress-stat">
            <span className="dashboard-problem-progress-stat-label">건너뜀</span>
            <strong>{model.skippedProblems ?? 0}</strong>
          </div>
          <div className="dashboard-problem-progress-stat">
            <span className="dashboard-problem-progress-stat-label">남은 문제</span>
            <strong>{model.remainingProblems}</strong>
          </div>
        </div>

        <div className="dashboard-problem-progress-details">
          <div className="dashboard-problem-progress-detail">
            <span className="dashboard-problem-progress-detail-label">현재 문제</span>
            <strong>{model.currentProblem ?? "-"}</strong>
          </div>
          <div className="dashboard-problem-progress-detail">
            <span className="dashboard-problem-progress-detail-label">현재 단계</span>
            <strong>{model.currentPhase ?? "-"}</strong>
          </div>
          <div className="dashboard-problem-progress-detail">
            <span className="dashboard-problem-progress-detail-label">문제별 제출 수</span>
            <strong>{model.currentSubmissionCount ?? "-"}</strong>
          </div>
          <div className="dashboard-problem-progress-detail">
            <span className="dashboard-problem-progress-detail-label">코드 다운로드</span>
            <strong>{model.sourceProgress ?? "-"}</strong>
          </div>
        </div>
      </div>
    );
  }
}

export class ResumeCheckpointCard extends PureComponent<{
  resume: DashboardResumeState;
  disabled: boolean;
  pending: boolean;
  onResume: (resume: DashboardResumeState) => void;
}> {
  public render(): JSX.Element {
    const { resume, disabled, pending, onResume } = this.props;
    const phaseLabels = this.getPhaseLabels(resume);

    return (
      <div className={`dashboard-resume-card ${resume.kind}`}>
        <div className="dashboard-resume-head">
          <div>
            <span className="dashboard-resume-kicker">Resume</span>
            <h4>{resume.title}</h4>
            <div className="dashboard-resume-meta">
              사용자 {resume.username} · {resume.updatedAt}
            </div>
          </div>
          <span className="dashboard-artifact-flag ready">READY</span>
        </div>

        <div className="dashboard-resume-phase">
          <span className="dashboard-resume-phase-label">
            단계 {resume.phaseIndex}/{resume.totalPhases}
          </span>
          <strong>{resume.phase}</strong>
        </div>

        <div className="dashboard-resume-stepbar">
          {phaseLabels.map((label, index) => {
            const stepNumber = index + 1;
            const className =
              stepNumber < resume.phaseIndex
                ? "completed"
                : stepNumber === resume.phaseIndex
                  ? "active"
                  : "pending";
            return (
              <span key={label} className={`dashboard-resume-step ${className}`}>
                {label}
              </span>
            );
          })}
        </div>

        <div className="dashboard-resume-progress">
          <div className="dashboard-progress-meta">
            <span>{resume.progressLabel}</span>
            <span>{resume.progressPercent.toFixed(1)}%</span>
          </div>
          <div className="progress progress-u dashboard-resume-progress-bar">
            <div
              className="progress-bar progress-bar-u"
              role="progressbar"
              style={{ width: `${resume.progressPercent.toFixed(1)}%` }}
            />
          </div>
        </div>

        <div className="dashboard-resume-note">{resume.note}</div>

        {resume.submissionLimit !== null || resume.problemLimit !== null || resume.problemFilter ? (
          <div className="dashboard-resume-settings">
            {resume.submissionLimit !== null ? (
              <span className="dashboard-resume-setting">제출 수 제한 {resume.submissionLimit}</span>
            ) : null}
            {resume.problemLimit !== null ? (
              <span className="dashboard-resume-setting">문제 수 제한 {resume.problemLimit}</span>
            ) : null}
            {resume.problemFilter ? (
              <span className="dashboard-resume-setting">문제 필터 {resume.problemFilter}</span>
            ) : null}
          </div>
        ) : null}

        <div className="dashboard-link-row">
          <button
            type="button"
            className="btn btn-u btn-u-blue btn-sm"
            disabled={disabled || pending}
            onClick={() => onResume(resume)}
          >
            {pending ? "이어받는 중..." : resume.action.label}
          </button>
        </div>
      </div>
    );
  }

  private getPhaseLabels(resume: DashboardResumeState): string[] {
    switch (resume.kind) {
      case "sync":
        return ["프로필", "제출 기록", "문제 백업"];
      case "archive":
        return ["제출 기록", "문제 백업"];
      case "submissions":
        return ["제출 기록"];
    }
  }
}

class StepCard extends PureComponent<{ step: VisualStep; showConnector: boolean }> {
  public render(): JSX.Element {
    const { step, showConnector } = this.props;
    return (
      <>
        <div className={`dashboard-step ${step.state}`}>
          <span className="dashboard-step-icon">
            <i className={iconClassForState(step.state)} />
          </span>
          <div className="dashboard-step-body">
            <span className="dashboard-step-label">{step.label}</span>
            {step.note ? <span className="dashboard-step-note">{step.note}</span> : null}
          </div>
        </div>
        {showConnector ? <span className="dashboard-step-connector" /> : null}
      </>
    );
  }
}
