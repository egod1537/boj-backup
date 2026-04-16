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
        <div className="topbar">
          <div className="container">
            <ul className="loginbar pull-right">
              <li><a href="https://www.acmicpc.net/register" target="_blank" rel="noreferrer">회원가입</a></li>
              <li className="topbar-devider" />
              <li><a href="https://www.acmicpc.net/login" target="_blank" rel="noreferrer">로그인</a></li>
            </ul>
          </div>
        </div>
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
                <li><a href="https://www.acmicpc.net/problemset" target="_blank" rel="noreferrer">문제</a></li>
                <li><a href="https://www.acmicpc.net/workbook/top" target="_blank" rel="noreferrer">문제집</a></li>
                <li><a href="https://www.acmicpc.net/contest/official/list" target="_blank" rel="noreferrer">대회</a></li>
                <li className="active"><a href={`${origin}/status`}>채점 현황</a></li>
                <li>
                  <a href={profileUrl} target={options.localProfileOrigin ? undefined : "_blank"} rel={options.localProfileOrigin ? undefined : "noreferrer"}>
                    랭킹
                  </a>
                </li>
                <li><a href="https://www.acmicpc.net/board/list/all" target="_blank" rel="noreferrer">게시판</a></li>
                <li><a href="https://www.acmicpc.net/group/list/all" target="_blank" rel="noreferrer">그룹</a></li>
              </ul>
              <span className="navbar-text viewer-topbar-note">local submissions viewer</span>
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
    const visibleColumns = snapshot.columns.filter((column) => column.visible);
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
        ? `${options.problemNav.submissionsUrl}/${submissionId}`
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
        <td>{language}</td>
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
