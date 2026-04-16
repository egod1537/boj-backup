import type { JSX } from "react";
import { PureComponent } from "react";

import type { BojUserSubmissionRow, BojUserSubmissionsSnapshot } from "../../boj/session.js";
import {
  SUBMISSION_ROW_INDEX,
  formatValueWithUnit,
  getSubmissionRowValue,
} from "./shared.js";

export interface ReactRenderSubmissionsStatusOptions {
  localProfileOrigin?: string | null;
  dashboardUrl?: string | null;
  problemNav?: {
    problemId: number;
    problemTitle?: string | null;
    problemUrl: string;
    submissionsUrl: string;
    activeTab: "problem" | "submissions";
  };
}

export class SubmissionsTopChrome extends PureComponent<{
  origin: string;
  username: string;
  options: ReactRenderSubmissionsStatusOptions;
}> {
  public render(): JSX.Element {
    const { origin, username, options } = this.props;
    const profileUrl = options.localProfileOrigin
      ? `${options.localProfileOrigin}/user/${encodeURIComponent(username)}`
      : "https://www.acmicpc.net/ranklist";
    const brandUrl = options.localProfileOrigin ? profileUrl : `${origin}/status`;

    return (
      <div className="header no-print">
        <div className="navbar navbar-default mega-menu viewer-nav" role="navigation">
          <div className="container">
            <div className="navbar-header">
              <a className="navbar-brand" href={brandUrl}>
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
                {options.localProfileOrigin ? (
                  <li>
                    <a href={`${options.localProfileOrigin}/user/${encodeURIComponent(username)}`}>정보</a>
                  </li>
                ) : null}
                {options.localProfileOrigin ? (
                  <li>
                    <a href={`${options.localProfileOrigin}/user/language/${encodeURIComponent(username)}`}>언어</a>
                  </li>
                ) : null}
                <li className="active"><a href={`${origin}/status`}>제출</a></li>
                <li>
                  <a href={profileUrl} target={options.localProfileOrigin ? undefined : "_blank"} rel={options.localProfileOrigin ? undefined : "noreferrer"}>
                    원본 프로필
                  </a>
                </li>
                {options.dashboardUrl ? (
                  <li>
                    <a href={options.dashboardUrl}>대시보드</a>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export class StatusTable extends PureComponent<{
  snapshot: BojUserSubmissionsSnapshot;
  options: ReactRenderSubmissionsStatusOptions;
}> {
  public render(): JSX.Element {
    const { snapshot, options } = this.props;
    const visibleColumns = buildVisibleStatusColumns(snapshot);
    return (
      <table className="table table-striped table-bordered" id="status-table">
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshot.rows.map((row) => (
            <StatusRow
              key={String(getSubmissionRowValue<number | null>(row, SUBMISSION_ROW_INDEX.submissionId))}
              username={snapshot.username}
              row={row}
              options={options}
            />
          ))}
        </tbody>
      </table>
    );
  }
}

function buildVisibleStatusColumns(
  snapshot: BojUserSubmissionsSnapshot,
): Array<{ key: string; label: string }> {
  const visibleColumns: Array<{ key: string; label: string }> = [];

  for (const column of snapshot.columns) {
    if (!column.visible) {
      continue;
    }

    visibleColumns.push({
      key: column.key,
      label: column.label,
    });

    if (column.key === "submissionId") {
      visibleColumns.push({
        key: "username",
        label: "아이디",
      });
    }
  }

  return visibleColumns;
}

export class ProblemSubmissionsMenu extends PureComponent<{
  options: ReactRenderSubmissionsStatusOptions["problemNav"];
}> {
  public render(): JSX.Element | null {
    const problemNav = this.props.options;
    if (!problemNav) {
      return null;
    }

    const problemLabel = `${problemNav.problemId}번${problemNav.problemTitle ? ` - ${problemNav.problemTitle}` : ""}`;
    return (
      <ul className="nav nav-pills no-print problem-menu">
        <li className={problemNav.activeTab === "problem" ? "active" : undefined}>
          <a href={problemNav.problemUrl}>{problemLabel}</a>
        </li>
        <li className={problemNav.activeTab === "submissions" ? "active" : undefined}>
          <a href={problemNav.submissionsUrl}>내 제출</a>
        </li>
      </ul>
    );
  }
}

class StatusRow extends PureComponent<{
  username: string;
  row: BojUserSubmissionRow;
  options: ReactRenderSubmissionsStatusOptions;
}> {
  public render(): JSX.Element {
    const { username, row, options } = this.props;
    const submissionId = getSubmissionRowValue<number | null>(row, SUBMISSION_ROW_INDEX.submissionId);
    const problemId = getSubmissionRowValue<number | null>(row, SUBMISSION_ROW_INDEX.problemId);
    const problemTitle = getSubmissionRowValue<string | null>(row, SUBMISSION_ROW_INDEX.problemTitle);
    const result = getSubmissionRowValue<string>(row, SUBMISSION_ROW_INDEX.result);
    const resultClass = getSubmissionRowValue<string | null>(row, SUBMISSION_ROW_INDEX.resultClass);
    const memoryKb = getSubmissionRowValue<number | null>(row, SUBMISSION_ROW_INDEX.memoryKb);
    const timeMs = getSubmissionRowValue<number | null>(row, SUBMISSION_ROW_INDEX.timeMs);
    const language = getSubmissionRowValue<string>(row, SUBMISSION_ROW_INDEX.language);
    const codeLength = getSubmissionRowValue<number | null>(row, SUBMISSION_ROW_INDEX.codeLength);
    const submittedAt = getSubmissionRowValue<string | null>(row, SUBMISSION_ROW_INDEX.submittedAt);
    const profileUrl = options.localProfileOrigin
      ? `${options.localProfileOrigin}/user/${encodeURIComponent(username)}`
      : `https://www.acmicpc.net/user/${encodeURIComponent(username)}`;
    const submissionUrl =
      options.problemNav && submissionId !== null
        ? `/source/${submissionId}`
        : null;
    const problemUrl =
      options.problemNav && problemId === options.problemNav.problemId
        ? options.problemNav.problemUrl
        : problemId !== null
          ? `https://www.acmicpc.net/problem/${problemId}`
          : null;
    const submittedAtUrl = options.problemNav
      ? options.problemNav.submissionsUrl
      : `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}`;

    return (
      <tr id={`solution-${submissionId ?? "unknown"}`}>
        <td className="viewer-submission-id">
          {submissionUrl ? <a href={submissionUrl}>{submissionId ?? "-"}</a> : (submissionId ?? "-")}
        </td>
        <td>
          <a href={profileUrl} target={options.localProfileOrigin ? undefined : "_blank"} rel={options.localProfileOrigin ? undefined : "noreferrer"}>
            <span className="user-blue">{username}</span>
          </a>
        </td>
        <td>
          {problemId !== null && problemUrl ? (
            <a
              href={problemUrl}
              data-placement="right"
              title={problemTitle ?? ""}
              className="problem_title tooltip-click"
              target={options.problemNav ? undefined : "_blank"}
              rel={options.problemNav ? undefined : "noreferrer"}
            >
              {problemId}
            </a>
          ) : "-"}
        </td>
        <td className="result">
          {resultClass ? <span className={`result-text ${resultClass}`}>{result}</span> : result}
        </td>
        <td className="memory">{formatValueWithUnit(memoryKb, "KB")}</td>
        <td className="time">{formatValueWithUnit(timeMs, "ms")}</td>
        <td>
          {submissionUrl ? <a href={submissionUrl}>{language}</a> : language}
        </td>
        <td>{formatValueWithUnit(codeLength, "B")}</td>
        <td>
          <a
            href={submittedAtUrl}
            target={options.problemNav ? undefined : "_blank"}
            rel={options.problemNav ? undefined : "noreferrer"}
          >
            {submittedAt ?? "-"}
          </a>
        </td>
      </tr>
    );
  }
}
