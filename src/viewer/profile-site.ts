import { spawn } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  BojUserLanguageStats,
  BojUserProblemList,
  BojUserProfile,
  BojUserSnapshot,
  BojUserSubmissionsSnapshot,
} from "../boj/session.js";
import { ConfigurationError } from "../errors.js";
import {
  renderProfileInfoReactPage,
  renderProfileLanguageReactPage,
  renderProfileNotFoundReactPage,
} from "./react/profile-page.js";
import { BOJ_FAVICON_32_URL } from "./react/render.js";
import { renderSubmissionsStatusPage } from "./submission-site.js";

const RESULT_LABEL_CLASS: Record<string, string> = {
  "맞았습니다": "result-ac",
  "출력 형식": "result-pe",
  "틀렸습니다": "result-wa",
  "시간 초과": "result-tle",
  "메모리 초과": "result-mle",
  "출력 초과": "result-ole",
  "런타임 에러": "result-rte",
  "컴파일 에러": "result-ce",
  "채점 불가": "result-del",
};

const PROFILE_STATS_ORDER = [
  "등수",
  "맞은 문제",
  "맞았지만 만점을 받지 못한 문제",
  "시도했지만 맞지 못한 문제",
  "제출",
  "만든 문제",
  "문제를 검수",
  "맞았습니다",
  "출력 형식",
  "틀렸습니다",
  "시간 초과",
  "메모리 초과",
  "출력 초과",
  "런타임 에러",
  "컴파일 에러",
  "학교/회사",
  "Codeforces",
  "Atcoder",
] as const;

export interface StartProfileViewerOptions {
  inputPath: string;
  submissionsInputPath?: string;
  host: string;
  port: number;
}

export interface StartedProfileViewer {
  server: Server;
  username: string;
  inputPath: string;
  infoUrl: string;
  languageUrl: string;
  statusUrl: string | null;
}

export async function startProfileViewerServer(
  options: StartProfileViewerOptions,
): Promise<StartedProfileViewer> {
  const inputPath = path.resolve(options.inputPath);
  const snapshot = await readProfileSnapshot(inputPath);
  const submissionsSnapshot = options.submissionsInputPath
    ? await readSubmissionsSnapshot(path.resolve(options.submissionsInputPath))
    : null;
  const username = snapshot.profile.username || snapshot.username;

  if (!username) {
    throw new ConfigurationError("Profile JSON does not contain a username.");
  }

  if (submissionsSnapshot && submissionsSnapshot.username !== username) {
    throw new ConfigurationError(
      `Submissions JSON belongs to ${submissionsSnapshot.username}, not ${username}.`,
    );
  }

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(requestUrl.pathname);
    const infoPath = `/user/${username}`;
    const languagePath = `/user/language/${username}`;

    if (pathname === "/") {
      response.writeHead(302, { Location: infoPath });
      response.end();
      return;
    }

    if (pathname === "/favicon.ico") {
      response.writeHead(302, { Location: BOJ_FAVICON_32_URL });
      response.end();
      return;
    }

    if (pathname === infoPath || pathname === "/user") {
      respondHtml(response, renderProfileInfoPage(snapshot, requestUrl.origin, submissionsSnapshot));
      return;
    }

    if (pathname === languagePath || pathname === "/user/language") {
      respondHtml(response, renderProfileLanguagePage(snapshot, requestUrl.origin, submissionsSnapshot));
      return;
    }

    if (pathname === "/status" && submissionsSnapshot) {
      const requestedUser = requestUrl.searchParams.get("user_id");

      if (!requestedUser || requestedUser === username) {
        respondHtml(
          response,
          renderSubmissionsStatusPage(submissionsSnapshot, requestUrl.origin, {
            localProfileOrigin: requestUrl.origin,
          }),
        );
        return;
      }

      return;
    }

    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    response.end(renderNotFoundPage(username, requestUrl.origin, submissionsSnapshot));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: unknown) => {
      reject(normalizeServerStartError(error, options.host, options.port));
    };

    server.once("error", onError);
    server.listen(options.port, options.host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine profile viewer server address.");
  }

  const displayHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
  const baseUrl = `http://${displayHost}:${address.port}`;

  return {
    server,
    username,
    inputPath,
    infoUrl: `${baseUrl}/user/${encodeURIComponent(username)}`,
    languageUrl: `${baseUrl}/user/language/${encodeURIComponent(username)}`,
    statusUrl: submissionsSnapshot
      ? `${baseUrl}/status?user_id=${encodeURIComponent(username)}`
      : null,
  };
}

export function openProfileViewer(url: string): void {
  const command =
    process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", url] }
      : process.platform === "darwin"
        ? { file: "open", args: [url] }
        : { file: "xdg-open", args: [url] };

  const child = spawn(command.file, command.args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();
}

async function readProfileSnapshot(inputPath: string): Promise<BojUserSnapshot> {
  let raw: string;

  try {
    raw = await readFile(inputPath, "utf8");
  } catch (error) {
    throw new ConfigurationError(`Could not read profile JSON: ${inputPath}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError(`Profile JSON is not valid JSON: ${inputPath}`);
  }

  if (!isProfileSnapshot(parsed)) {
    throw new ConfigurationError(
      "Profile JSON must contain profile and languageStats objects generated by the profile command.",
    );
  }

  return parsed;
}

function isProfileSnapshot(value: unknown): value is BojUserSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const snapshot = value as Partial<BojUserSnapshot>;
  return (
    !!snapshot.profile &&
    typeof snapshot.profile === "object" &&
    !!snapshot.languageStats &&
    typeof snapshot.languageStats === "object"
  );
}

function respondHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

export function renderProfileInfoPage(
  snapshot: BojUserSnapshot,
  origin: string,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
): string {
  return renderProfileInfoReactPage(snapshot, origin, submissionsSnapshot);
}

export function renderProfileLanguagePage(
  snapshot: BojUserSnapshot,
  origin: string,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
): string {
  return renderProfileLanguageReactPage(snapshot, origin, submissionsSnapshot);
}

function renderShell(args: {
  title: string;
  activeTab: "info" | "language";
  username: string;
  origin: string;
  submissionsSnapshot: BojUserSubmissionsSnapshot | null;
  content: string;
}): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(args.title)}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.2.0/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/unify/css/style.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/css/connect.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/css/result.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/css/label.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/unify/css/custom.css?version=20240112">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.6.3/css/font-awesome.css">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/unify/css/theme-colors/blue.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/css/fa-color.css?version=20240112">
  <link rel="stylesheet" href="https://ddo7jzca0m2vt.cloudfront.net/css/user_info.css?version=20240112">
  <link href="https://fonts.googleapis.com/css?family=Noto+Sans+KR:400,700|Open+Sans:400,400i,700,700i|Source+Code+Pro&amp;subset=korean" rel="stylesheet">
  <style>
    :root {
      --boj-text-main: #333;
      --boj-text-muted: #555;
      --boj-text-subtle: #777;
      --boj-link: #0076c0;
      --boj-border: #ddd;
      --boj-soft-bg: #fff;
    }
    body {
      background: #fff;
      color: var(--boj-text-main);
    }
    p, li, li a, blockquote, .profile-bio,
    .viewer-meta-card, .viewer-source-links, .viewer-empty,
    .viewer-topbar-note, .panel-body {
      color: var(--boj-text-muted);
    }
    a,
    a:focus,
    a:hover,
    a:active {
      color: var(--boj-link);
    }
    .profile-header { margin-bottom: 20px; }
    .viewer-topbar-note { margin-left: 10px; font-size: 12px; }
    .viewer-nav .navbar-nav > li > a { padding-left: 14px; padding-right: 14px; }
    .viewer-panel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
    .viewer-meta-card { background: var(--boj-soft-bg); border: 1px solid var(--boj-border); border-radius: 4px; padding: 14px 16px; min-height: 90px; }
    .viewer-meta-card strong { display: block; margin-bottom: 6px; color: var(--boj-text-main); }
    .viewer-meta-card span { color: inherit; word-break: break-word; }
    .viewer-empty { color: var(--boj-text-muted); font-style: italic; }
    .problem-list a,
    .problem-list a:link,
    .problem-list a:visited,
    .problem-list a:hover,
    .problem-list a:active {
      color: var(--boj-link) !important;
    }
    .problem-list a { display: inline-block; margin-right: 6px; margin-bottom: 6px; }
    .profile-bio { display: block; margin-bottom: 12px; }
    .viewer-source-links { margin-top: 10px; font-size: 12px; }
    .viewer-source-links a { margin-right: 12px; }
    .table-responsive { border: 0; }
    @media (max-width: 767px) {
      .page-header h1 { font-size: 28px; }
      .viewer-topbar-note { display: none; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    ${renderTopChrome(args.origin, args.username, args.activeTab, args.submissionsSnapshot)}
    <div class="container content">
      ${args.content}
    </div>
  </div>
</body>
</html>`;
}

function renderTopChrome(
  origin: string,
  username: string,
  activeTab: "info" | "language",
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
): string {
  const infoPath = `${origin}/user/${encodeURIComponent(username)}`;
  const languagePath = `${origin}/user/language/${encodeURIComponent(username)}`;
  const statusPath = submissionsSnapshot
    ? `${origin}/status?user_id=${encodeURIComponent(username)}`
    : "https://www.acmicpc.net/status";

  return `
    <div class="header no-print">
      <div class="topbar">
        <div class="container">
          <ul class="loginbar pull-right">
            <li><a href="https://www.acmicpc.net/register" target="_blank" rel="noreferrer">회원가입</a></li>
            <li class="topbar-devider"></li>
            <li><a href="https://www.acmicpc.net/login" target="_blank" rel="noreferrer">로그인</a></li>
          </ul>
        </div>
      </div>
      <div class="navbar navbar-default mega-menu viewer-nav" role="navigation">
        <div class="container">
          <div class="navbar-header">
            <a class="navbar-brand" href="${escapeHtml(infoPath)}">
              <img id="logo-header" src="https://d2gd6pc034wcta.cloudfront.net/images/logo@2x.png" alt="Logo" data-retina>
            </a>
          </div>
          <div class="collapse navbar-collapse navbar-responsive-collapse">
            <ul class="nav navbar-nav">
              <li><a href="https://www.acmicpc.net/problemset" target="_blank" rel="noreferrer">문제</a></li>
              <li><a href="https://www.acmicpc.net/workbook/top" target="_blank" rel="noreferrer">문제집</a></li>
              <li><a href="https://www.acmicpc.net/contest/official/list" target="_blank" rel="noreferrer">대회</a></li>
              <li><a href="${escapeHtml(statusPath)}"${submissionsSnapshot ? "" : ' target="_blank" rel="noreferrer"'}>채점 현황</a></li>
              <li class="active"><a href="${escapeHtml(activeTab === "info" ? infoPath : languagePath)}">랭킹</a></li>
              <li><a href="https://www.acmicpc.net/board/list/all" target="_blank" rel="noreferrer">게시판</a></li>
              <li><a href="https://www.acmicpc.net/group/list/all" target="_blank" rel="noreferrer">그룹</a></li>
            </ul>
            <span class="navbar-text viewer-topbar-note">local profile viewer</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderProfileHeader(
  snapshot: BojUserSnapshot,
  activeTab: "info" | "language",
  origin: string,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
): string {
  const username = snapshot.profile.username;
  const infoPath = `${origin}/user/${encodeURIComponent(username)}`;
  const languagePath = `${origin}/user/language/${encodeURIComponent(username)}`;
  const statusPath = submissionsSnapshot
    ? `${origin}/status?user_id=${encodeURIComponent(username)}`
    : null;
  const tierImage = snapshot.profile.tierImageUrl
    ? `<img src="${escapeHtml(snapshot.profile.tierImageUrl)}" class="solvedac-tier">`
    : "";
  const bio = snapshot.profile.bio
    ? `<span class="profile-bio">${escapeHtml(snapshot.profile.bio)}</span>`
    : "";

  return `
    <h1>
      <a href="https://solved.ac/profile/${encodeURIComponent(username)}" class="no-ul" target="_blank" rel="noreferrer">
        ${tierImage}${tierImage ? "&nbsp;" : ""}
      </a>${escapeHtml(username)}
    </h1>
    <blockquote class="no-mathjax">
      ${bio}
      <div class="tab-v2 user-menu">
        <ul class="nav nav-tabs">
          <li class="${activeTab === "info" ? "active" : ""}"><a href="${escapeHtml(infoPath)}">정보</a></li>
          <li class="${activeTab === "language" ? "active" : ""}"><a href="${escapeHtml(languagePath)}">언어</a></li>
          ${statusPath ? `<li><a href="${escapeHtml(statusPath)}">제출</a></li>` : ""}
        </ul>
      </div>
    </blockquote>
  `;
}

function renderStatsTable(
  profile: BojUserProfile,
  username: string,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
): string {
  const rows = PROFILE_STATS_ORDER.map((label) =>
    renderStatsRow(profile, username, label, submissionsSnapshot),
  )
    .filter(Boolean)
    .join("");

  return `<table id="statics" class="table table-hover"><tbody>${rows}</tbody></table>`;
}

function renderStatsRow(
  profile: BojUserProfile,
  username: string,
  label: string,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
): string {
  let value = profile.stats[label];

  if (!value && label === "학교/회사" && profile.schoolOrCompany) {
    value = profile.schoolOrCompany;
  }

  if (!value) {
    return "";
  }

  const labelHtml = renderResultLabel(label);
  const link = getProfileStatLink(username, label, value, submissionsSnapshot);
  const className = profile.statClasses?.[label] || getDefaultStatClass(label);
  const textHtml = className
    ? `<span class="${escapeHtml(className)}">${escapeHtml(value)}</span>`
    : escapeHtml(value);
  const valueHtml = link
    ? isExternalLink(link)
      ? `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${textHtml}</a>`
      : `<a href="${escapeHtml(link)}">${textHtml}</a>`
    : textHtml;

  return `<tr><th>${labelHtml}</th><td>${valueHtml}</td></tr>`;
}

function renderSnapshotPanel(
  snapshot: BojUserSnapshot,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
): string {
  const localStatusLink = submissionsSnapshot
    ? `/status?user_id=${encodeURIComponent(snapshot.profile.username)}`
    : null;
  return `
    <div class="panel panel-default">
      <div class="panel-heading"><h3 class="panel-title">동기화 정보</h3></div>
      <div class="panel-body">
        <div class="viewer-panel-grid">
          <div class="viewer-meta-card">
            <strong>마지막 수집</strong>
            <span>${escapeHtml(formatDateTime(snapshot.fetchedAt))}</span>
          </div>
          <div class="viewer-meta-card">
            <strong>등수</strong>
            <span>${escapeHtml(formatNullableNumber(snapshot.profile.rank))}</span>
          </div>
          <div class="viewer-meta-card">
            <strong>맞은 문제</strong>
            <span>${escapeHtml(formatNullableNumber(snapshot.profile.solvedCount))}</span>
          </div>
          <div class="viewer-meta-card">
            <strong>제출</strong>
            <span>${escapeHtml(formatNullableNumber(snapshot.profile.submissionCount))}</span>
          </div>
        </div>
        <div class="viewer-source-links">
          <a href="https://www.acmicpc.net/user/${encodeURIComponent(snapshot.profile.username)}" target="_blank" rel="noreferrer">BOJ 원본 프로필</a>
          <a href="https://www.acmicpc.net/user/language/${encodeURIComponent(snapshot.profile.username)}" target="_blank" rel="noreferrer">BOJ 원본 언어 통계</a>
          ${localStatusLink ? `<a href="${escapeHtml(localStatusLink)}">로컬 제출 현황</a>` : ""}
          <a href="https://www.acmicpc.net/status?user_id=${encodeURIComponent(snapshot.profile.username)}" target="_blank" rel="noreferrer">BOJ 원본 채점 현황</a>
        </div>
      </div>
    </div>
  `;
}

function renderProblemPanel(problemList: BojUserProblemList): string {
  const items =
    problemList.problemIds.length > 0
      ? problemList.problemIds
          .map(
            (problemId) =>
              `<a href="https://www.acmicpc.net/problem/${problemId}" class="" target="_blank" rel="noreferrer">${problemId}</a>`,
          )
          .join(" ")
      : `<span class="viewer-empty">목록이 비어 있습니다.</span>`;

  return `
    <div class="panel panel-default">
      <div class="panel-heading"><h3 class="panel-title">${escapeHtml(problemList.label)}</h3></div>
      <div class="panel-body"><div class="problem-list">${items}</div></div>
    </div>
  `;
}

function renderLanguageTable(languageStats: BojUserLanguageStats): string {
  const headers = languageStats.headers
    .map((header) => `<th>${renderResultLabel(header)}</th>`)
    .join("");
  const rows = languageStats.rows
    .map((row) => {
      const cells = languageStats.headers
        .map((header, index) => {
          const value = index === 0 ? row.language : row.stats[header] ?? "";
          const tag = index === 0 ? "th" : "td";
          return `<${tag}>${escapeHtml(value)}</${tag}>`;
        })
        .join("");

      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table class="table table-bordered table-striped"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderResultLabel(label: string): string {
  const className = RESULT_LABEL_CLASS[label];

  if (!className) {
    return escapeHtml(label);
  }

  return `<span class="${className}">${escapeHtml(label)}</span>`;
}

function getProfileStatLink(
  username: string,
  label: string,
  value: string,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
): string | null {
  switch (label) {
    case "등수":
      return "https://www.acmicpc.net/ranklist";
    case "맞은 문제":
      return `https://www.acmicpc.net/problemset?user=${encodeURIComponent(username)}&user_solved=1`;
    case "맞았지만 만점을 받지 못한 문제":
      return `https://www.acmicpc.net/problemset?user=${encodeURIComponent(username)}&user_solved=2`;
    case "시도했지만 맞지 못한 문제":
      return `https://www.acmicpc.net/problemset?user=${encodeURIComponent(username)}&user_solved=0`;
    case "제출":
      if (submissionsSnapshot) {
        return `/status?user_id=${encodeURIComponent(username)}`;
      }
      return `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}`;
    case "만든 문제":
      return `https://www.acmicpc.net/problem/author/${encodeURIComponent(username)}/1`;
    case "문제를 검수":
      return `https://www.acmicpc.net/problem/author/${encodeURIComponent(username)}/19`;
    case "맞았습니다":
      return `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}&result_id=4`;
    case "출력 형식":
      return `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}&result_id=5`;
    case "틀렸습니다":
      return `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}&result_id=6`;
    case "시간 초과":
      return `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}&result_id=7`;
    case "메모리 초과":
      return `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}&result_id=8`;
    case "출력 초과":
      return `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}&result_id=9`;
    case "런타임 에러":
      return `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}&result_id=10`;
    case "컴파일 에러":
      return `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}&result_id=11`;
    case "Codeforces":
      return `http://codeforces.com/profile/${encodeURIComponent(value)}`;
    case "Atcoder":
      return `https://atcoder.jp/users/${encodeURIComponent(value)}`;
    default:
      return null;
  }
}

function getDefaultStatClass(label: string): string {
  switch (label) {
    case "Codeforces":
      return "user-blue";
    case "Atcoder":
      return "atcoder-blue";
    default:
      return "";
  }
}

function renderNotFoundPage(
  username: string,
  origin: string,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
): string {
  return renderProfileNotFoundReactPage(username, origin, submissionsSnapshot);
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatNullableNumber(value: number | null): string {
  if (value === null) {
    return "-";
  }

  return formatNumber(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeServerStartError(error: unknown, host: string, port: number): Error {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code);

    if (code === "EADDRINUSE") {
      return new ConfigurationError(`Port ${port} is already in use.`);
    }

    if (code === "EACCES") {
      return new ConfigurationError(
        `Could not bind to ${host}:${port}. That port may be restricted by Windows. Try --port 3000 or --port 0.`,
      );
    }
  }

  return error instanceof Error ? error : new Error(String(error));
}

function isExternalLink(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function readSubmissionsSnapshot(inputPath: string): Promise<BojUserSubmissionsSnapshot> {
  let raw: string;

  try {
    raw = await readFile(inputPath, "utf8");
  } catch {
    throw new ConfigurationError(`Could not read submissions JSON: ${inputPath}`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError(`Submissions JSON is not valid JSON: ${inputPath}`);
  }

  if (!isSubmissionsSnapshot(parsed)) {
    throw new ConfigurationError(
      "Submissions JSON must contain username, columns, and rows generated by the submissions command.",
    );
  }

  return parsed;
}

function isSubmissionsSnapshot(value: unknown): value is BojUserSubmissionsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const snapshot = value as Partial<BojUserSubmissionsSnapshot>;
  return (
    typeof snapshot.username === "string" &&
    Array.isArray(snapshot.columns) &&
    Array.isArray(snapshot.rows)
  );
}
