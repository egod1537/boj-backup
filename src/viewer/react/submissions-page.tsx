import type { BojUserSubmissionsSnapshot } from "../../boj/session.js";
import {
  ProblemSubmissionsMenu,
  type ReactRenderSubmissionsStatusOptions,
  StatusTable,
  SubmissionsTopChrome,
} from "./submissions-components.js";
import { SUBMISSIONS_PAGE_STYLE } from "./submissions-style.js";
import { ViewerDocument } from "./render.js";
import { formatDateTime, formatNumber } from "./shared.js";

export type { ReactRenderSubmissionsStatusOptions } from "./submissions-components.js";

export function renderSubmissionsStatusReactPage(
  snapshot: BojUserSubmissionsSnapshot,
  origin: string,
  options: ReactRenderSubmissionsStatusOptions = {},
): string {
  const username = snapshot.username;
  const problemIdValue = options.problemNav ? String(options.problemNav.problemId) : "";
  const formAction = options.problemNav ? options.problemNav.submissionsUrl : "/status";
  return ViewerDocument({
    title: options.problemNav ? `${options.problemNav.problemId}번 내 제출` : "채점 현황",
    styleText: SUBMISSIONS_PAGE_STYLE,
    body: (
      <div className="wrapper">
        <SubmissionsTopChrome origin={origin} username={username} options={options} />
        <div className="container content">
          <div className="row">
            <div className="col-md-12">
              <ProblemSubmissionsMenu options={options.problemNav} />
            </div>
            <div className="col-md-12">
              <div className="text-center">
                <form className="form-inline" action={formAction} method="get">
                  <input
                    type="text"
                    className="form-control margin-left-3"
                    name="problem_id"
                    placeholder="문제"
                    defaultValue={problemIdValue}
                  />
                  <input
                    type="text"
                    className="form-control margin-left-3"
                    name="user_id"
                    placeholder="아이디"
                    defaultValue={username}
                  />
                  <select className="form-control margin-left-3" disabled>
                    <option>모든 언어</option>
                  </select>
                  <select className="form-control margin-left-3" disabled>
                    <option>모든 결과</option>
                  </select>
                  <button type="submit" className="btn btn-primary btn-sm margin-left-3 form-control">검색</button>
                </form>
              </div>
            </div>
            <div className="margin-bottom-30" />
            <div className="col-md-12">
              <div className="viewer-status-meta">
                총 {formatNumber(snapshot.totalCount)}개 제출
                {snapshot.estimatedTotalCount !== null ? ` / 예상 ${formatNumber(snapshot.estimatedTotalCount)}개` : ""}
                {` · ${formatNumber(snapshot.pagesFetched)}개 페이지 수집 · ${formatDateTime(snapshot.fetchedAt)}`}
              </div>
              <div className="table-responsive viewer-status-wrap">
                <StatusTable snapshot={snapshot} options={options} />
              </div>
              <div className="viewer-status-links">
                <a href={snapshot.sourceUrl} target="_blank" rel="noreferrer">
                  BOJ 원본 채점 현황
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
  });
}

export function renderSubmissionsNotFoundReactPage(username: string, origin: string): string {
  return ViewerDocument({
    title: "Not Found",
    styleText: SUBMISSIONS_PAGE_STYLE,
    body: (
      <div className="wrapper">
        <SubmissionsTopChrome origin={origin} username={username} options={{}} />
        <div className="container content">
          <div className="row">
            <div className="col-md-12">
              <div className="panel panel-default">
                <div className="panel-heading"><h3 className="panel-title">페이지를 찾을 수 없습니다</h3></div>
                <div className="panel-body">
                  <p>다음 경로를 사용하세요.</p>
                  <ul>
                    <li>
                      <a href={`${origin}/status?user_id=${encodeURIComponent(username)}`}>/status?user_id={username}</a>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
  });
}
