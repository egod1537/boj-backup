import type { JSX, ReactNode } from "react";
import { PureComponent } from "react";

import type {
  BojUserLanguageStats,
  BojUserProblemList,
  BojUserProfile,
  BojUserSnapshot,
  BojUserSubmissionsSnapshot,
} from "../../boj/session.js";
import {
  PROFILE_STATS_ORDER,
  RESULT_LABEL_CLASS,
  formatDateTime,
  formatNullableNumber,
  isExternalLink,
} from "./shared.js";

export class ProfileTopChrome extends PureComponent<{
  origin: string;
  username: string;
  activeTab: "info" | "language";
  submissionsSnapshot: BojUserSubmissionsSnapshot | null;
  dashboardUrl?: string | null;
}> {
  public render(): JSX.Element {
    const { origin, username, activeTab, submissionsSnapshot, dashboardUrl } = this.props;
    const infoPath = `${origin}/user/${encodeURIComponent(username)}`;
    const languagePath = `${origin}/user/language/${encodeURIComponent(username)}`;
    const statusPath = submissionsSnapshot
      ? `${origin}/status?user_id=${encodeURIComponent(username)}`
      : "https://www.acmicpc.net/status";

    return (
      <div className="header no-print">
        <div className="navbar navbar-default mega-menu viewer-nav" role="navigation">
          <div className="container">
            <div className="navbar-header">
              <a className="navbar-brand" href={infoPath}>
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
                <li className={activeTab === "info" ? "active" : undefined}>
                  <a href={infoPath}>정보</a>
                </li>
                <li className={activeTab === "language" ? "active" : undefined}>
                  <a href={languagePath}>언어</a>
                </li>
                {submissionsSnapshot ? (
                  <li>
                    <a href={statusPath}>제출</a>
                  </li>
                ) : null}
                {dashboardUrl ? (
                  <li>
                    <a href={dashboardUrl}>대시보드</a>
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

export class ProfileHeader extends PureComponent<{
  snapshot: BojUserSnapshot;
}> {
  public render(): JSX.Element {
    const { snapshot } = this.props;
    const username = snapshot.profile.username;

    return (
      <>
        <h1>
          <a
            href={`https://solved.ac/profile/${encodeURIComponent(username)}`}
            className="no-ul"
            target="_blank"
            rel="noreferrer"
          >
            {snapshot.profile.tierImageUrl ? (
              <>
                <img src={snapshot.profile.tierImageUrl} className="solvedac-tier" />
                &nbsp;
              </>
            ) : null}
          </a>
          {username}
        </h1>
        <blockquote className="no-mathjax">
          {snapshot.profile.bio ? <span className="profile-bio">{snapshot.profile.bio}</span> : null}
        </blockquote>
      </>
    );
  }
}

export class StatsTable extends PureComponent<{
  profile: BojUserProfile;
  username: string;
  submissionsSnapshot: BojUserSubmissionsSnapshot | null;
}> {
  public render(): JSX.Element {
    const { profile, username, submissionsSnapshot } = this.props;
    return (
      <table id="statics" className="table table-hover">
        <tbody>
          {PROFILE_STATS_ORDER.map((label) => (
            <StatsRow
              key={label}
              profile={profile}
              username={username}
              label={label}
              submissionsSnapshot={submissionsSnapshot}
            />
          ))}
        </tbody>
      </table>
    );
  }
}

export class SnapshotPanel extends PureComponent<{
  snapshot: BojUserSnapshot;
  submissionsSnapshot: BojUserSubmissionsSnapshot | null;
}> {
  public render(): JSX.Element {
    const { snapshot, submissionsSnapshot } = this.props;
    const username = snapshot.profile.username;
    const localStatusLink = submissionsSnapshot ? `/status?user_id=${encodeURIComponent(username)}` : null;

    return (
      <div className="panel panel-default">
        <div className="panel-heading"><h3 className="panel-title">동기화 정보</h3></div>
        <div className="panel-body">
          <div className="viewer-panel-grid">
            <MetaCard title="마지막 수집">{formatDateTime(snapshot.fetchedAt)}</MetaCard>
            <MetaCard title="등수">{formatNullableNumber(snapshot.profile.rank)}</MetaCard>
            <MetaCard title="맞은 문제">{formatNullableNumber(snapshot.profile.solvedCount)}</MetaCard>
            <MetaCard title="제출">{formatNullableNumber(snapshot.profile.submissionCount)}</MetaCard>
          </div>
          <div className="viewer-source-links">
            <a href={`https://www.acmicpc.net/user/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer">BOJ 원본 프로필</a>
            <a href={`https://www.acmicpc.net/user/language/${encodeURIComponent(username)}`} target="_blank" rel="noreferrer">BOJ 원본 언어 통계</a>
            {localStatusLink ? <a href={localStatusLink}>로컬 제출 현황</a> : null}
            <a href={`https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}`} target="_blank" rel="noreferrer">BOJ 원본 채점 현황</a>
          </div>
        </div>
      </div>
    );
  }
}

export class ProblemPanel extends PureComponent<{ problemList: BojUserProblemList }> {
  public render(): JSX.Element {
    const { problemList } = this.props;
    return (
      <div className="panel panel-default">
        <div className="panel-heading"><h3 className="panel-title">{problemList.label}</h3></div>
        <div className="panel-body">
          <div className="problem-list">
            {problemList.problemIds.length > 0 ? (
              problemList.problemIds.map((problemId) => (
                <a key={problemId} href={`https://www.acmicpc.net/problem/${problemId}`} target="_blank" rel="noreferrer">
                  {problemId}
                </a>
              ))
            ) : (
              <span className="viewer-empty">목록이 비어 있습니다.</span>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export class LanguageTable extends PureComponent<{ languageStats: BojUserLanguageStats }> {
  public render(): JSX.Element {
    const { languageStats } = this.props;
    return (
      <table className="table table-bordered table-striped">
        <thead>
          <tr>
            {languageStats.headers.map((header) => (
              <th key={header}><ResultLabel label={header} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {languageStats.rows.map((row) => (
            <tr key={row.language}>
              {languageStats.headers.map((header, index) => {
                const value = index === 0 ? row.language : row.stats[header] ?? "";
                return index === 0 ? <th key={header}>{value}</th> : <td key={header}>{value}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
}

class StatsRow extends PureComponent<{
  profile: BojUserProfile;
  username: string;
  label: string;
  submissionsSnapshot: BojUserSubmissionsSnapshot | null;
}> {
  public render(): JSX.Element | null {
    const { profile, username, label, submissionsSnapshot } = this.props;
    let value = profile.stats[label];
    if (!value && label === "학교/회사" && profile.schoolOrCompany) {
      value = profile.schoolOrCompany;
    }

    if (!value) {
      return null;
    }

    const link = getProfileStatLink(username, label, value, submissionsSnapshot);
    const className = profile.statClasses?.[label] || getDefaultStatClass(label);
    const text = className ? <span className={className}>{value}</span> : value;

    return (
      <tr>
        <th><ResultLabel label={label} /></th>
        <td>
          {link ? (
            <a href={link} target={isExternalLink(link) ? "_blank" : undefined} rel={isExternalLink(link) ? "noreferrer" : undefined}>
              {text}
            </a>
          ) : text}
        </td>
      </tr>
    );
  }
}

class MetaCard extends PureComponent<{ title: string; children: ReactNode }> {
  public render(): JSX.Element {
    return (
      <div className="viewer-meta-card">
        <strong>{this.props.title}</strong>
        <span>{this.props.children}</span>
      </div>
    );
  }
}

class ResultLabel extends PureComponent<{ label: string }> {
  public render(): JSX.Element {
    const className = RESULT_LABEL_CLASS[this.props.label];
    return className ? <span className={className}>{this.props.label}</span> : <>{this.props.label}</>;
  }
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
      return submissionsSnapshot
        ? `/status?user_id=${encodeURIComponent(username)}`
        : `https://www.acmicpc.net/status?user_id=${encodeURIComponent(username)}`;
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
