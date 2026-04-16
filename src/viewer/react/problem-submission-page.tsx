import type { JSX } from "react";
import { PureComponent } from "react";

import { highlightCodeBlock } from "./code-highlighting.js";
import { ViewerDocument } from "./render.js";
import { ProblemSubmissionsMenu, SubmissionsTopChrome, type ReactRenderSubmissionsStatusOptions } from "./submissions-components.js";
import { formatValueWithUnit } from "./shared.js";

const PROBLEM_SUBMISSION_PAGE_STYLE = `
  body { background: #fff; color: #333; }
  a, a:focus, a:hover, a:active { color: #0076c0; }
  .viewer-topbar-note { margin-left: 10px; color: #777; font-size: 12px; }
  .viewer-nav .navbar-nav > li > a { padding-left: 14px; padding-right: 14px; }
  .problem-submission-card {
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #fff;
    overflow: hidden;
  }
  .problem-submission-meta {
    padding: 16px 18px 10px;
    border-bottom: 1px solid #eee;
  }
  .problem-submission-title {
    margin: 0 0 10px;
    font-size: 22px;
    font-weight: 700;
    color: #333;
  }
  .problem-submission-title code {
    font-size: 0.92em;
    color: #555;
    background: transparent;
    padding: 0;
  }
  .problem-submission-meta-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    font-size: 13px;
    color: #555;
  }
  .problem-submission-result {
    font-weight: 700;
  }
  .problem-submission-actions {
    padding: 12px 18px;
    border-bottom: 1px solid #eee;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .problem-submission-code-wrap {
    overflow: auto;
    background: #fbfbfb;
  }
  .problem-submission-code {
    margin: 0;
    padding: 0;
    font-family: "Source Code Pro", monospace;
    font-size: 13px;
    line-height: 1.55;
    color: #222;
    counter-reset: code-line;
  }
  .problem-submission-line {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
  }
  .problem-submission-line-number {
    display: inline-block;
    padding: 0 12px 0 0;
    text-align: right;
    color: #999;
    border-right: 1px solid #ececec;
    user-select: none;
  }
  .problem-submission-line-content {
    display: inline-block;
    padding: 0 16px;
    white-space: pre;
  }
  .problem-submission-line-content.hljs {
    background: transparent;
    color: #24292f;
  }
  .problem-submission-line-content .hljs-comment,
  .problem-submission-line-content .hljs-quote {
    color: #6a737d;
    font-style: italic;
  }
  .problem-submission-line-content .hljs-keyword,
  .problem-submission-line-content .hljs-selector-tag,
  .problem-submission-line-content .hljs-literal,
  .problem-submission-line-content .hljs-section,
  .problem-submission-line-content .hljs-link,
  .problem-submission-line-content .hljs-selector-id {
    color: #d73a49;
  }
  .problem-submission-line-content .hljs-string,
  .problem-submission-line-content .hljs-title,
  .problem-submission-line-content .hljs-built_in,
  .problem-submission-line-content .hljs-type,
  .problem-submission-line-content .hljs-attribute,
  .problem-submission-line-content .hljs-symbol,
  .problem-submission-line-content .hljs-bullet,
  .problem-submission-line-content .hljs-addition {
    color: #22863a;
  }
  .problem-submission-line-content .hljs-number,
  .problem-submission-line-content .hljs-meta,
  .problem-submission-line-content .hljs-regexp,
  .problem-submission-line-content .hljs-variable,
  .problem-submission-line-content .hljs-template-variable,
  .problem-submission-line-content .hljs-selector-class {
    color: #005cc5;
  }
  .problem-submission-line-content .hljs-function,
  .problem-submission-line-content .hljs-function .hljs-title,
  .problem-submission-line-content .hljs-title.function_,
  .problem-submission-line-content .hljs-title.class_ {
    color: #6f42c1;
  }
  .problem-submission-line-content .hljs-emphasis {
    font-style: italic;
  }
  .problem-submission-line-content .hljs-strong {
    font-weight: 700;
  }
  .problem-submission-empty {
    padding: 18px;
    color: #777;
  }
  @media (max-width: 767px) {
    .viewer-topbar-note { display: none; }
    .problem-submission-title { font-size: 18px; }
    .problem-submission-line {
      grid-template-columns: 44px minmax(0, 1fr);
    }
    .problem-submission-line-number {
      padding-right: 8px;
    }
    .problem-submission-line-content {
      padding: 0 10px;
    }
  }
`;

export interface ProblemSubmissionViewModel {
  username: string;
  problemId: number;
  problemTitle: string | null;
  submissionId: number;
  result: string;
  resultClass: string | null;
  memoryKb: number | null;
  timeMs: number | null;
  language: string;
  codeLength: number | null;
  submittedAt: string | null;
  code: string;
  problemUrl: string;
  submissionsUrl: string;
  previousSubmissionUrl: string | null;
  nextSubmissionUrl: string | null;
}

export function renderProblemSubmissionReactPage(
  model: ProblemSubmissionViewModel,
  origin: string,
  options: ReactRenderSubmissionsStatusOptions = {},
): string {
  return ViewerDocument({
    title: `제출 #${model.submissionId}`,
    styleText: PROBLEM_SUBMISSION_PAGE_STYLE,
    body: (
      <ProblemSubmissionPageMarkup model={model} origin={origin} options={options} />
    ),
  });
}

class ProblemSubmissionPageMarkup extends PureComponent<{
  model: ProblemSubmissionViewModel;
  origin: string;
  options: ReactRenderSubmissionsStatusOptions;
}> {
  public render(): JSX.Element {
    const { model, origin, options } = this.props;
    const problemNav = {
      problemId: model.problemId,
      problemTitle: model.problemTitle,
      problemUrl: model.problemUrl,
      submissionsUrl: model.submissionsUrl,
      activeTab: "submissions" as const,
    };

    return (
      <div className="wrapper">
        <SubmissionsTopChrome origin={origin} username={model.username} options={options} />
        <div className="container content">
          <div className="row">
            <div className="col-md-12">
              <ProblemSubmissionsMenu options={problemNav} />
            </div>
            <div className="col-md-12">
              <div className="problem-submission-card">
                <div className="problem-submission-meta">
                  <h1 className="problem-submission-title">
                    <code>#{model.submissionId}</code>
                    {" · "}
                    {model.problemId}번
                    {model.problemTitle ? ` ${model.problemTitle}` : ""}
                  </h1>
                  <div className="problem-submission-meta-grid">
                    <span className={`problem-submission-result ${model.resultClass ?? ""}`}>{model.result}</span>
                    <span>{model.language}</span>
                    <span>{formatValueWithUnit(model.timeMs, "ms")}</span>
                    <span>{formatValueWithUnit(model.memoryKb, "KB")}</span>
                    <span>{formatValueWithUnit(model.codeLength, "B")}</span>
                    <span>{model.submittedAt ?? "-"}</span>
                  </div>
                </div>
                <div className="problem-submission-actions">
                  <a className="btn btn-default btn-sm" href={model.problemUrl}>문제</a>
                  <a className="btn btn-default btn-sm" href={model.submissionsUrl}>제출 목록</a>
                  {model.previousSubmissionUrl ? (
                    <a className="btn btn-default btn-sm" href={model.previousSubmissionUrl}>◀ 이전 제출</a>
                  ) : null}
                  {model.nextSubmissionUrl ? (
                    <a className="btn btn-default btn-sm" href={model.nextSubmissionUrl}>다음 제출 ▶</a>
                  ) : null}
                </div>
                <SubmissionCodeBlock code={model.code} language={model.language} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

class SubmissionCodeBlock extends PureComponent<{ code: string; language: string }> {
  public render(): JSX.Element {
    const highlighted = highlightCodeBlock(this.props.code, this.props.language);
    const lines = highlighted.lines;

    if (lines.length === 0) {
      return <div className="problem-submission-empty">저장된 코드가 없습니다.</div>;
    }

    return (
      <div className="problem-submission-code-wrap">
        <pre className="problem-submission-code">
          {lines.map((line, index) => (
            <div key={`line-${index + 1}`} className="problem-submission-line">
              <span className="problem-submission-line-number">{index + 1}</span>
              <span
                className="problem-submission-line-content hljs"
                dangerouslySetInnerHTML={{ __html: line || " " }}
              />
            </div>
          ))}
        </pre>
      </div>
    );
  }
}
