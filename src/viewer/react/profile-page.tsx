import type { BojUserSnapshot, BojUserSubmissionsSnapshot } from "../../boj/session.js";
import {
  LanguageTable,
  ProblemPanel,
  ProfileHeader,
  ProfileTopChrome,
  SnapshotPanel,
  StatsTable,
} from "./profile-components.js";
import { PROFILE_PAGE_STYLE } from "./profile-style.js";
import { ViewerDocument } from "./render.js";

export function renderProfileInfoReactPage(
  snapshot: BojUserSnapshot,
  origin: string,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
  dashboardUrl: string | null = null,
): string {
  const username = snapshot.profile.username;
  return ViewerDocument({
    title: `${username} 정보`,
    includeUserInfoCss: true,
    styleText: PROFILE_PAGE_STYLE,
    body: (
      <div className="wrapper">
        <ProfileTopChrome
          origin={origin}
          username={username}
          activeTab="info"
          submissionsSnapshot={submissionsSnapshot}
          dashboardUrl={dashboardUrl}
        />
        <div className="container content">
          <div className="row">
            <div className="col-md-12">
              <div className="page-header profile-header">
                <ProfileHeader
                  snapshot={snapshot}
                />
              </div>
            </div>
            <div className="col-md-12">
              <div className="row">
                <div className="col-md-3">
                  <StatsTable
                    profile={snapshot.profile}
                    username={username}
                    submissionsSnapshot={submissionsSnapshot}
                  />
                </div>
                <div className="col-md-9">
                  <SnapshotPanel snapshot={snapshot} submissionsSnapshot={submissionsSnapshot} />
                  <ProblemPanel problemList={snapshot.profile.problemLists.solved} />
                  <ProblemPanel problemList={snapshot.profile.problemLists.partialSolved} />
                  <ProblemPanel problemList={snapshot.profile.problemLists.failed} />
                  <ProblemPanel problemList={snapshot.profile.problemLists.extraSolved} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
  });
}

export function renderProfileLanguageReactPage(
  snapshot: BojUserSnapshot,
  origin: string,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
  dashboardUrl: string | null = null,
): string {
  const username = snapshot.profile.username;
  return ViewerDocument({
    title: `${username} 언어 정보`,
    includeUserInfoCss: true,
    styleText: PROFILE_PAGE_STYLE,
    body: (
      <div className="wrapper">
        <ProfileTopChrome
          origin={origin}
          username={username}
          activeTab="language"
          submissionsSnapshot={submissionsSnapshot}
          dashboardUrl={dashboardUrl}
        />
        <div className="container content">
          <div className="row">
            <div className="col-md-12">
              <div className="page-header profile-header">
                <ProfileHeader
                  snapshot={snapshot}
                />
              </div>
            </div>
            <div className="col-md-12">
              <div className="table-responsive">
                <LanguageTable languageStats={snapshot.languageStats} />
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
  });
}

export function renderProfileNotFoundReactPage(
  username: string,
  origin: string,
  submissionsSnapshot: BojUserSubmissionsSnapshot | null,
  dashboardUrl: string | null = null,
): string {
  const localStatusPath = submissionsSnapshot ? `${origin}/status?user_id=${encodeURIComponent(username)}` : null;

  return ViewerDocument({
    title: "Not Found",
    includeUserInfoCss: true,
    styleText: PROFILE_PAGE_STYLE,
    body: (
      <div className="wrapper">
        <ProfileTopChrome
          origin={origin}
          username={username}
          activeTab="info"
          submissionsSnapshot={submissionsSnapshot}
          dashboardUrl={dashboardUrl}
        />
        <div className="container content">
          <div className="row">
            <div className="col-md-12">
              <div className="panel panel-default">
                <div className="panel-heading">
                  <h3 className="panel-title">페이지를 찾을 수 없습니다</h3>
                </div>
                <div className="panel-body">
                  <p>다음 경로만 지원합니다.</p>
                  <ul>
                    <li>
                      <a href={`${origin}/user/${encodeURIComponent(username)}`}>/user/{username}</a>
                    </li>
                    <li>
                      <a href={`${origin}/user/language/${encodeURIComponent(username)}`}>
                        /user/language/{username}
                      </a>
                    </li>
                    {localStatusPath ? (
                      <li>
                        <a href={localStatusPath}>/status?user_id={username}</a>
                      </li>
                    ) : null}
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
