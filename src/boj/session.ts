import { load, type CheerioAPI } from "cheerio";
import got, { type Got, type OptionsOfTextResponseBody, type Response } from "got";
import { Cookie, CookieJar } from "tough-cookie";

import { AuthenticationError, StopRequestedError } from "../errors.js";

export interface BojCredentials {
  userId: string;
  password: string;
}

export interface LoginOptions {
  nextPath?: string;
}

export interface LoginResult {
  username: string;
  redirectLocation: string;
  cookieHeader: string;
}

export interface BojUserProfile {
  username: string;
  bio: string | null;
  tierImageUrl: string | null;
  rank: number | null;
  solvedCount: number | null;
  partialSolvedCount: number | null;
  failedCount: number | null;
  submissionCount: number | null;
  schoolOrCompany: string | null;
  stats: Record<string, string>;
  statClasses: Record<string, string>;
  problemLists: BojUserProblemLists;
}

export interface BojUserLanguageRow {
  language: string;
  stats: Record<string, string>;
}

export interface BojUserLanguageStats {
  username: string;
  headers: string[];
  rows: BojUserLanguageRow[];
}

export interface BojUserSubmissionTableColumn {
  key: string;
  label: string;
  type: "number" | "text" | "datetime" | "class";
  visible: boolean;
  unit?: string;
}

export type BojUserSubmissionRow = [
  submissionId: number,
  problemId: number | null,
  problemTitle: string | null,
  result: string,
  resultClass: string | null,
  memoryKb: number | null,
  timeMs: number | null,
  language: string,
  codeLength: number | null,
  submittedAt: string | null,
  submittedAtTimestamp: number | null,
];

export interface BojUserSubmissionsSnapshot {
  username: string;
  fetchedAt: string;
  sourceUrl: string;
  mode?: "user-status" | "problem-status";
  limitCount: number | null;
  estimatedTotalCount: number | null;
  problemIds?: number[] | null;
  availableProblemCount?: number | null;
  selectionSummary?: string | null;
  totalCount: number;
  pagesFetched: number;
  columns: BojUserSubmissionTableColumn[];
  rows: BojUserSubmissionRow[];
}

export interface BojUserSubmissionsCheckpoint {
  kind: "boj-user-submissions-checkpoint";
  version: 1;
  username: string;
  startedAt: string;
  updatedAt: string;
  sourceUrl: string;
  mode?: "user-status" | "problem-status";
  limitCount: number | null;
  estimatedTotalCount: number | null;
  problemIds?: number[] | null;
  availableProblemCount?: number | null;
  selectionSummary?: string | null;
  problemIndex?: number | null;
  currentProblemId?: number | null;
  pagesFetched: number;
  totalCount: number;
  nextPath: string | null;
  seenPaths: string[];
  columns: BojUserSubmissionTableColumn[];
  rows: BojUserSubmissionRow[];
}

export interface BojUserSubmissionFetchProgress {
  username: string;
  limitCount: number | null;
  estimatedTotalCount: number | null;
  selectedProblemCount?: number | null;
  completedProblemCount?: number | null;
  currentProblemId?: number | null;
  pagesFetched: number;
  rowsFetched: number;
  lastSubmissionId: number | null;
  nextDelayMs: number;
  delayReason: BojRateLimitDelayReason;
  backoffAttempt: number;
}

export interface BojUserProblemList {
  label: string;
  count: number;
  problemIds: number[];
}

export interface BojUserProblemLists {
  solved: BojUserProblemList;
  partialSolved: BojUserProblemList;
  failed: BojUserProblemList;
  extraSolved: BojUserProblemList;
}

export interface BojUserSnapshot {
  username: string;
  fetchedAt: string;
  profile: BojUserProfile;
  languageStats: BojUserLanguageStats;
}

export interface BojProblemPageSnapshot {
  problemId: number;
  title: string | null;
  fetchedAt: string;
  sourceUrl: string;
  html: string;
}

export interface BojProblemMetadataTagDisplayName {
  language: string;
  name: string;
  short: string | null;
}

export interface BojProblemMetadataTag {
  key: string;
  isMeta: boolean;
  bojTagId: number | null;
  problemCount: number | null;
  displayNames: BojProblemMetadataTagDisplayName[];
  aliases: string[];
}

export interface BojProblemMetadataSnapshot {
  problemId: number;
  titleKo: string | null;
  level: number | null;
  tierLabel: string | null;
  acceptedUserCount: number | null;
  averageTries: number | null;
  official: boolean | null;
  sprout: boolean | null;
  givesNoRating: boolean | null;
  isLevelLocked: boolean | null;
  tags: BojProblemMetadataTag[];
}

export interface BojSubmissionSourceSnapshot {
  submissionId: number;
  username: string | null;
  problemId: number | null;
  problemTitle: string | null;
  result: string;
  resultClass: string | null;
  memoryKb: number | null;
  timeMs: number | null;
  language: string;
  codeLength: number | null;
  submittedAt: string | null;
  submittedAtTimestamp: number | null;
  sourceUrl: string;
  fetchedAt: string;
  code: string;
}

export type BojRateLimitDelayReason = "none" | "base" | "backoff";

export interface BojRateLimitSnapshot {
  requestDelayMs: number;
  jitterMs: number;
  nextDelayMs: number;
  scheduledDelayMs: number;
  delayReason: BojRateLimitDelayReason;
  backoffAttempt: number;
}

export const BOJ_USER_SUBMISSION_COLUMNS: BojUserSubmissionTableColumn[] = [
  { key: "submissionId", label: "제출 번호", type: "number", visible: true },
  { key: "problemId", label: "문제", type: "number", visible: true },
  { key: "problemTitle", label: "문제 제목", type: "text", visible: false },
  { key: "result", label: "결과", type: "text", visible: true },
  { key: "resultClass", label: "결과 클래스", type: "class", visible: false },
  { key: "memoryKb", label: "메모리", type: "number", visible: true, unit: "KB" },
  { key: "timeMs", label: "시간", type: "number", visible: true, unit: "ms" },
  { key: "language", label: "언어", type: "text", visible: true },
  { key: "codeLength", label: "코드 길이", type: "number", visible: true, unit: "B" },
  { key: "submittedAt", label: "제출한 시간", type: "datetime", visible: true },
  { key: "submittedAtTimestamp", label: "제출 시각 Unix", type: "number", visible: false },
];

interface LoginForm {
  action: string;
  hiddenFields: Record<string, string>;
  requiresCaptcha: boolean;
}

export class BojSessionClient {
  readonly cookieJar: CookieJar;

  private readonly http: Got;
  private readonly solvedAcHttp: Got;
  private readonly baseUrl: string;
  private readonly credentials: BojCredentials;
  private readonly requestDelayMs: number;
  private readonly requestJitterMs: number;
  private readonly backoffScheduleMs: number[];
  private nextRequestAt = 0;
  private nextSolvedAcRequestAt = 0;
  private scheduledDelayMs = 0;
  private delayReason: BojRateLimitDelayReason = "none";
  private backoffAttempt = 0;

  constructor(args: {
    baseUrl: string;
    credentials: BojCredentials;
    userAgent: string;
    requestDelayMs?: number;
    requestJitterMs?: number;
    backoffScheduleMs?: number[];
  }) {
    this.baseUrl = args.baseUrl;
    this.credentials = args.credentials;
    this.requestDelayMs = Math.max(args.requestDelayMs ?? 3_000, 2_000);
    this.requestJitterMs = Math.max(args.requestJitterMs ?? 500, 0);
    this.backoffScheduleMs = args.backoffScheduleMs ?? [10_000, 30_000, 60_000];
    this.cookieJar = new CookieJar();
    this.http = got.extend({
      prefixUrl: this.baseUrl,
      cookieJar: this.cookieJar,
      headers: {
        "user-agent": args.userAgent,
      },
      timeout: {
        request: 15_000,
      },
      retry: {
        limit: 0,
      },
      https: {
        rejectUnauthorized: true,
      },
    });
    this.solvedAcHttp = got.extend({
      prefixUrl: "https://solved.ac/api/v3",
      headers: {
        "user-agent": args.userAgent,
        accept: "application/json",
      },
      timeout: {
        request: 15_000,
      },
      retry: {
        limit: 0,
      },
      https: {
        rejectUnauthorized: true,
      },
    });
  }

  async login(options: LoginOptions = {}): Promise<LoginResult> {
    const nextPath = options.nextPath ?? "/";
    const loginForm = await this.fetchLoginForm(nextPath);

    if (loginForm.requiresCaptcha) {
      throw new AuthenticationError(
        "BOJ login currently requires reCAPTCHA. BOJ_ID/BOJ_PW-only login is blocked; sign in in a browser and set BOJ_COOKIE in .env instead.",
        "CAPTCHA_REQUIRED",
      );
    }

    const response = await this.http.post(normalizeGotPath(loginForm.action), {
      form: {
        ...loginForm.hiddenFields,
        login_user_id: this.credentials.userId,
        login_password: this.credentials.password,
      },
      headers: {
        referer: new URL(`/login?next=${encodeURIComponent(nextPath)}`, this.baseUrl).toString(),
      },
      followRedirect: false,
      throwHttpErrors: false,
    });

    const redirectLocation = response.headers.location ?? "";

    if (response.statusCode !== 302) {
      throw new AuthenticationError(
        `Unexpected response from BOJ signin endpoint: ${response.statusCode}.`,
        "UNEXPECTED_RESPONSE",
      );
    }

    if (redirectLocation.includes("/login?error=1")) {
      throw new AuthenticationError("BOJ rejected the credentials.", "INVALID_CREDENTIALS");
    }

    const username = await this.fetchCurrentUsername();

    if (!username) {
      throw new AuthenticationError(
        "BOJ did not expose a logged-in username after signin.",
        "SESSION_NOT_VERIFIED",
      );
    }

    return {
      username,
      redirectLocation: redirectLocation || nextPath,
      cookieHeader: await this.cookieJar.getCookieString(this.baseUrl),
    };
  }

  async ensureAuthenticated(): Promise<string> {
    const username = await this.fetchCurrentUsername();

    if (username) {
      return username;
    }

    const result = await this.login();
    return result.username;
  }

  async importCookieHeader(cookieHeader: string): Promise<void> {
    const pairs = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);

    if (pairs.length === 0) {
      throw new AuthenticationError("BOJ_COOKIE is empty.", "COOKIE_INVALID");
    }

    const url = new URL(this.baseUrl);

    for (const pair of pairs) {
      const cookie = Cookie.parse(pair, { loose: true });

      if (!cookie) {
        continue;
      }

      cookie.domain = url.hostname;
      cookie.path = "/";
      await this.cookieJar.setCookie(cookie, this.baseUrl);
    }
  }

  async clearCookies(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.cookieJar.removeAllCookies((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async fetchCurrentUsername(): Promise<string | null> {
    const response = await this.getWithRateLimit("");
    const $ = load(response.body);
    const username = $('meta[name="username"]').attr("content")?.trim();

    return username || null;
  }

  async fetchUserProfile(username: string): Promise<BojUserProfile> {
    const response = await this.getWithRateLimit(`user/${username}`, {
      throwHttpErrors: false,
    });

    if (response.statusCode === 404) {
      throw new Error(`BOJ user not found: ${username}`);
    }

    if (response.statusCode !== 200) {
      throw new Error(`Unexpected response from BOJ user page: ${response.statusCode}`);
    }

    const $ = load(response.body);
    const statTable = $("#statics");

    if (statTable.length === 0) {
      throw new Error(`Could not parse BOJ user profile for ${username}.`);
    }

    const title = $(".page-header h1").first().clone();
    title.find("img").remove();

    const quote = $(".page-header blockquote.no-mathjax").first().clone();
    quote.find(".tab-v2").remove();

    const stats: Record<string, string> = {};
    const statClasses: Record<string, string> = {};
    statTable.find("tr").each((_, element) => {
      const key = normalizeWhitespace($(element).find("th").first().text());
      const value = normalizeWhitespace($(element).find("td").first().text());
      const className = normalizeWhitespace(
        $(element).find("td").first().find("span").first().attr("class") ?? "",
      );

      if (!key || !value) {
        return;
      }

      stats[key] = value;

      if (className) {
        statClasses[key] = className;
      }
    });

    const problemLists: BojUserProblemLists = {
      solved: {
        label: "맞은 문제",
        count: parseNullableNumber(stats["맞은 문제"]) ?? 0,
        problemIds: parseProblemIdsByPanelTitle($, "맞은 문제"),
      },
      partialSolved: {
        label: "맞았지만 만점을 받지 못한 문제",
        count: parseNullableNumber(stats["맞았지만 만점을 받지 못한 문제"]) ?? 0,
        problemIds: parseProblemIdsByPanelTitle($, "맞았지만 만점을 받지 못한 문제"),
      },
      failed: {
        label: "시도했지만 맞지 못한 문제",
        count: parseNullableNumber(stats["시도했지만 맞지 못한 문제"]) ?? 0,
        problemIds: parseProblemIdsByPanelTitle($, "시도했지만 맞지 못한 문제"),
      },
      extraSolved: {
        label: "맞은 번외 문제",
        count: 0,
        problemIds: parseProblemIdsByPanelTitle($, "맞은 번외 문제"),
      },
    };

    problemLists.extraSolved.count = problemLists.extraSolved.problemIds.length;

    return {
      username: normalizeWhitespace(title.text()) || username,
      bio: normalizeWhitespace(quote.text()) || null,
      tierImageUrl: $(".page-header h1 img.solvedac-tier").attr("src") ?? null,
      rank: parseNullableNumber(stats["등수"]),
      solvedCount: parseNullableNumber(stats["맞은 문제"]),
      partialSolvedCount: parseNullableNumber(stats["맞았지만 만점을 받지 못한 문제"]),
      failedCount: parseNullableNumber(stats["시도했지만 맞지 못한 문제"]),
      submissionCount: parseNullableNumber(stats["제출"]),
      schoolOrCompany: stats["학교/회사"] ?? null,
      stats,
      statClasses,
      problemLists,
    };
  }

  async fetchUserLanguageStats(username: string): Promise<BojUserLanguageStats> {
    const response = await this.getWithRateLimit(`user/language/${username}`, {
      throwHttpErrors: false,
    });

    if (response.statusCode === 404) {
      throw new Error(`BOJ user language page not found: ${username}`);
    }

    if (response.statusCode !== 200) {
      throw new Error(`Unexpected response from BOJ user language page: ${response.statusCode}`);
    }

    const $ = load(response.body);
    const table = $(".table-responsive table").first();

    if (table.length === 0) {
      throw new Error(`Could not parse BOJ user language stats for ${username}.`);
    }

    const title = $(".page-header h1").first().clone();
    title.find("img").remove();

    const headers = table
      .find("thead tr")
      .first()
      .find("th")
      .map((_, element) => normalizeWhitespace($(element).text()))
      .get()
      .filter(Boolean);

    const rows: BojUserLanguageRow[] = [];
    table.find("tbody tr").each((_, rowElement) => {
      const cells = $(rowElement)
        .find("th, td")
        .map((__, cell) => normalizeWhitespace($(cell).text()))
        .get();

      if (cells.length === 0) {
        return;
      }

      const language = cells[0] ?? "";
      if (!language) {
        return;
      }

      const stats: Record<string, string> = {};
      for (let i = 1; i < headers.length; i += 1) {
        const header = headers[i];
        if (!header) {
          continue;
        }

        stats[header] = cells[i] ?? "";
      }

      rows.push({
        language,
        stats,
      });
    });

    return {
      username: normalizeWhitespace(title.text()) || username,
      headers,
      rows,
    };
  }

  async fetchUserSubmissions(
    username: string,
    options: {
      limitCount?: number | null;
      estimatedTotalCount?: number | null;
      onProgress?: (progress: BojUserSubmissionFetchProgress) => void;
      resumeFrom?: BojUserSubmissionsCheckpoint | null;
      onCheckpoint?: (checkpoint: BojUserSubmissionsCheckpoint) => Promise<void> | void;
      shouldStop?: () => boolean;
    } = {},
  ): Promise<BojUserSubmissionsSnapshot> {
    const sourceUrl = new URL(`status?user_id=${encodeURIComponent(username)}`, this.baseUrl).toString();
    const resumeFrom = options.resumeFrom ?? null;
    const startedAt = resumeFrom?.startedAt ?? new Date().toISOString();
    const requestedLimitCount = options.limitCount ?? null;
    const checkpointLimitCount = resumeFrom?.limitCount ?? null;
    if (
      resumeFrom &&
      requestedLimitCount !== null &&
      checkpointLimitCount !== requestedLimitCount
    ) {
      throw new Error(
        `Submissions checkpoint limit mismatch for ${username}: checkpoint ${checkpointLimitCount ?? "none"}, requested ${requestedLimitCount}.`,
      );
    }

    const limitCount = requestedLimitCount ?? checkpointLimitCount;
    const rows: BojUserSubmissionRow[] = resumeFrom ? [...resumeFrom.rows] : [];
    if (limitCount !== null && rows.length > limitCount) {
      rows.length = limitCount;
    }
    const seenPaths = new Set<string>(resumeFrom?.seenPaths ?? []);
    let pagesFetched = resumeFrom?.pagesFetched ?? 0;
    let nextPath: string | null =
      resumeFrom?.nextPath ?? `status?user_id=${encodeURIComponent(username)}`;
    if (limitCount !== null && rows.length >= limitCount) {
      nextPath = null;
    }
    const estimatedTotalCount =
      options.estimatedTotalCount ?? resumeFrom?.estimatedTotalCount ?? null;

    if (resumeFrom && resumeFrom.username !== username) {
      throw new Error(
        `Submissions checkpoint belongs to ${resumeFrom.username}, not ${username}.`,
      );
    }

    while (nextPath && !seenPaths.has(nextPath)) {
      throwIfStopRequested(options.shouldStop);
      seenPaths.add(nextPath);

      const response = await this.getWithRateLimit(nextPath, {
        throwHttpErrors: false,
      });

      if (response.statusCode === 404) {
        throw new Error(`BOJ user status page not found: ${username}`);
      }

      if (response.statusCode !== 200) {
        throw new Error(`Unexpected response from BOJ user status page: ${response.statusCode}`);
      }

      const $ = load(response.body);
      const table = $("#status-table");

      if (table.length === 0) {
        throw new Error(`Could not parse BOJ user status table for ${username}.`);
      }

      let lastSubmissionId: number | null = rows.length > 0 ? rows.at(-1)?.[0] ?? null : null;
      let limitReached = false;
      for (const rowElement of table.find("tbody tr").toArray()) {
        if (limitCount !== null && rows.length >= limitCount) {
          limitReached = true;
          break;
        }

        const row = parseStatusRow($, rowElement);

        if (row) {
          rows.push(row);
          lastSubmissionId = row[0];
          if (limitCount !== null && rows.length >= limitCount) {
            limitReached = true;
            break;
          }
        }
      }

      pagesFetched += 1;

      options.onProgress?.({
        username,
        limitCount,
        estimatedTotalCount,
        pagesFetched,
        rowsFetched: rows.length,
        lastSubmissionId,
        nextDelayMs: this.getRateLimitSnapshot().nextDelayMs,
        delayReason: this.getRateLimitSnapshot().delayReason,
        backoffAttempt: this.getRateLimitSnapshot().backoffAttempt,
      });

      const nextHref = $("#next_page").attr("href");
      nextPath = limitReached ? null : (nextHref ? normalizeGotPath(nextHref) : null);

      if (options.onCheckpoint) {
        await options.onCheckpoint({
          kind: "boj-user-submissions-checkpoint",
          version: 1,
          username,
          startedAt,
          updatedAt: new Date().toISOString(),
          sourceUrl,
          limitCount,
          estimatedTotalCount,
          pagesFetched,
          totalCount: rows.length,
          nextPath,
          seenPaths: [...seenPaths],
          columns: BOJ_USER_SUBMISSION_COLUMNS,
          rows,
        });
      }

      throwIfStopRequested(options.shouldStop);
    }

    return {
      username,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
      mode: "user-status",
      limitCount,
      estimatedTotalCount,
      totalCount: rows.length,
      pagesFetched,
      columns: BOJ_USER_SUBMISSION_COLUMNS,
      rows,
    };
  }

  async fetchUserSubmissionsForProblems(
    username: string,
    problemIds: number[],
    options: {
      availableProblemCount?: number | null;
      selectionSummary?: string | null;
      onProgress?: (progress: BojUserSubmissionFetchProgress) => void;
      resumeFrom?: BojUserSubmissionsCheckpoint | null;
      onCheckpoint?: (checkpoint: BojUserSubmissionsCheckpoint) => Promise<void> | void;
      shouldStop?: () => boolean;
    } = {},
  ): Promise<BojUserSubmissionsSnapshot> {
    const sourceUrl = new URL(`status?user_id=${encodeURIComponent(username)}`, this.baseUrl).toString();
    const resumeFrom = options.resumeFrom ?? null;
    const startedAt = resumeFrom?.startedAt ?? new Date().toISOString();
    const rows: BojUserSubmissionRow[] = resumeFrom ? [...resumeFrom.rows] : [];
    let pagesFetched = resumeFrom?.pagesFetched ?? 0;
    const availableProblemCount = options.availableProblemCount ?? resumeFrom?.availableProblemCount ?? problemIds.length;
    const selectionSummary = options.selectionSummary ?? resumeFrom?.selectionSummary ?? null;
    const normalizedProblemIds = [...problemIds];

    if (resumeFrom && resumeFrom.username !== username) {
      throw new Error(
        `Submissions checkpoint belongs to ${resumeFrom.username}, not ${username}.`,
      );
    }

    if (resumeFrom && Array.isArray(resumeFrom.problemIds)) {
      const checkpointProblemIds = resumeFrom.problemIds;
      const sameProblemIds =
        checkpointProblemIds.length === normalizedProblemIds.length &&
        checkpointProblemIds.every((problemId, index) => problemId === normalizedProblemIds[index]);

      if (!sameProblemIds) {
        throw new Error(`Submissions checkpoint problem selection mismatch for ${username}.`);
      }
    }

    let problemIndex = resumeFrom?.problemIndex ?? 0;

    while (problemIndex < normalizedProblemIds.length) {
      throwIfStopRequested(options.shouldStop);
      const problemId = normalizedProblemIds[problemIndex];
      let nextPath: string | null =
        problemIndex === (resumeFrom?.problemIndex ?? 0)
          ? resumeFrom?.nextPath ?? buildProblemStatusPath(username, problemId)
          : buildProblemStatusPath(username, problemId);
      const seenPaths =
        problemIndex === (resumeFrom?.problemIndex ?? 0)
          ? new Set<string>(resumeFrom?.seenPaths ?? [])
          : new Set<string>();

      while (nextPath && !seenPaths.has(nextPath)) {
        throwIfStopRequested(options.shouldStop);
        seenPaths.add(nextPath);

        const response = await this.getWithRateLimit(nextPath, {
          throwHttpErrors: false,
        });

        if (response.statusCode === 404) {
          throw new Error(`BOJ user status page not found: ${username}`);
        }

        if (response.statusCode !== 200) {
          throw new Error(`Unexpected response from BOJ user status page: ${response.statusCode}`);
        }

        const $ = load(response.body);
        const table = $("#status-table");

        if (table.length === 0) {
          throw new Error(`Could not parse BOJ user status table for ${username}.`);
        }

        let lastSubmissionId: number | null = rows.length > 0 ? rows.at(-1)?.[0] ?? null : null;
        table.find("tbody tr").each((_, rowElement) => {
          const row = parseStatusRow($, rowElement);
          if (row) {
            rows.push(row);
            lastSubmissionId = row[0];
          }
        });

        pagesFetched += 1;

        options.onProgress?.({
          username,
          limitCount: null,
          estimatedTotalCount: null,
          selectedProblemCount: normalizedProblemIds.length,
          completedProblemCount: problemIndex,
          currentProblemId: problemId,
          pagesFetched,
          rowsFetched: rows.length,
          lastSubmissionId,
          nextDelayMs: this.getRateLimitSnapshot().nextDelayMs,
          delayReason: this.getRateLimitSnapshot().delayReason,
          backoffAttempt: this.getRateLimitSnapshot().backoffAttempt,
        });

        const nextHref = $("#next_page").attr("href");
        nextPath = nextHref ? normalizeGotPath(nextHref) : null;

        if (options.onCheckpoint) {
          await options.onCheckpoint({
            kind: "boj-user-submissions-checkpoint",
            version: 1,
            username,
            startedAt,
            updatedAt: new Date().toISOString(),
            sourceUrl,
            mode: "problem-status",
            limitCount: null,
            estimatedTotalCount: null,
            problemIds: normalizedProblemIds,
            availableProblemCount,
            selectionSummary,
            problemIndex,
            currentProblemId: problemId,
            pagesFetched,
            totalCount: rows.length,
            nextPath,
            seenPaths: [...seenPaths],
            columns: BOJ_USER_SUBMISSION_COLUMNS,
            rows,
          });
        }
      }

      problemIndex += 1;

      if (options.onCheckpoint) {
        await options.onCheckpoint({
          kind: "boj-user-submissions-checkpoint",
          version: 1,
          username,
          startedAt,
          updatedAt: new Date().toISOString(),
          sourceUrl,
          mode: "problem-status",
          limitCount: null,
          estimatedTotalCount: null,
          problemIds: normalizedProblemIds,
          availableProblemCount,
          selectionSummary,
          problemIndex,
          currentProblemId: problemIndex < normalizedProblemIds.length ? normalizedProblemIds[problemIndex] : null,
          pagesFetched,
          totalCount: rows.length,
          nextPath: problemIndex < normalizedProblemIds.length
            ? buildProblemStatusPath(username, normalizedProblemIds[problemIndex])
            : null,
          seenPaths: [],
          columns: BOJ_USER_SUBMISSION_COLUMNS,
          rows,
        });
      }
    }

    rows.sort((left, right) => right[0] - left[0]);

    return {
      username,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
      mode: "problem-status",
      limitCount: null,
      estimatedTotalCount: null,
      problemIds: normalizedProblemIds,
      availableProblemCount,
      selectionSummary,
      totalCount: rows.length,
      pagesFetched,
      columns: BOJ_USER_SUBMISSION_COLUMNS,
      rows,
    };
  }

  async fetchUserSubmissionsForProblem(
    username: string,
    problemId: number,
    options: {
      availableProblemCount?: number | null;
      selectionSummary?: string | null;
      selectedProblemCount?: number | null;
      completedProblemCount?: number | null;
      onProgress?: (progress: BojUserSubmissionFetchProgress) => void;
      resumeFrom?: BojUserSubmissionsCheckpoint | null;
      onCheckpoint?: (checkpoint: BojUserSubmissionsCheckpoint) => Promise<void> | void;
      shouldStop?: () => boolean;
    } = {},
  ): Promise<BojUserSubmissionsSnapshot> {
    const sourceUrl = new URL(`status?user_id=${encodeURIComponent(username)}`, this.baseUrl).toString();
    const resumeFrom = options.resumeFrom ?? null;
    const startedAt = resumeFrom?.startedAt ?? new Date().toISOString();
    const rows: BojUserSubmissionRow[] = resumeFrom ? [...resumeFrom.rows] : [];
    let pagesFetched = resumeFrom?.pagesFetched ?? 0;
    const availableProblemCount = options.availableProblemCount ?? resumeFrom?.availableProblemCount ?? null;
    const selectionSummary = options.selectionSummary ?? resumeFrom?.selectionSummary ?? null;
    const selectedProblemCount = options.selectedProblemCount ?? 1;
    const completedProblemCount = options.completedProblemCount ?? 0;

    if (resumeFrom && resumeFrom.username !== username) {
      throw new Error(
        `Submissions checkpoint belongs to ${resumeFrom.username}, not ${username}.`,
      );
    }

    if (
      resumeFrom &&
      Array.isArray(resumeFrom.problemIds) &&
      (resumeFrom.problemIds.length !== 1 || resumeFrom.problemIds[0] !== problemId)
    ) {
      throw new Error(`Submissions checkpoint problem selection mismatch for ${username}.`);
    }

    let nextPath: string | null =
      resumeFrom?.nextPath ?? buildProblemStatusPath(username, problemId);
    const seenPaths = new Set<string>(resumeFrom?.seenPaths ?? []);

    while (nextPath && !seenPaths.has(nextPath)) {
      throwIfStopRequested(options.shouldStop);
      seenPaths.add(nextPath);

      const response = await this.getWithRateLimit(nextPath, {
        throwHttpErrors: false,
      });

      if (response.statusCode === 404) {
        throw new Error(`BOJ user status page not found: ${username}`);
      }

      if (response.statusCode !== 200) {
        throw new Error(`Unexpected response from BOJ user status page: ${response.statusCode}`);
      }

      const $ = load(response.body);
      const table = $("#status-table");

      if (table.length === 0) {
        throw new Error(`Could not parse BOJ user status table for ${username}.`);
      }

      let lastSubmissionId: number | null = rows.length > 0 ? rows.at(-1)?.[0] ?? null : null;
      table.find("tbody tr").each((_, rowElement) => {
        const row = parseStatusRow($, rowElement);
        if (row) {
          rows.push(row);
          lastSubmissionId = row[0];
        }
      });

      pagesFetched += 1;

      options.onProgress?.({
        username,
        limitCount: null,
        estimatedTotalCount: null,
        selectedProblemCount,
        completedProblemCount,
        currentProblemId: problemId,
        pagesFetched,
        rowsFetched: rows.length,
        lastSubmissionId,
        nextDelayMs: this.getRateLimitSnapshot().nextDelayMs,
        delayReason: this.getRateLimitSnapshot().delayReason,
        backoffAttempt: this.getRateLimitSnapshot().backoffAttempt,
      });

      const nextHref = $("#next_page").attr("href");
      nextPath = nextHref ? normalizeGotPath(nextHref) : null;

      if (options.onCheckpoint) {
        await options.onCheckpoint({
          kind: "boj-user-submissions-checkpoint",
          version: 1,
          username,
          startedAt,
          updatedAt: new Date().toISOString(),
          sourceUrl,
          mode: "problem-status",
          limitCount: null,
          estimatedTotalCount: null,
          problemIds: [problemId],
          availableProblemCount,
          selectionSummary,
          problemIndex: completedProblemCount,
          currentProblemId: problemId,
          pagesFetched,
          totalCount: rows.length,
          nextPath,
          seenPaths: [...seenPaths],
          columns: BOJ_USER_SUBMISSION_COLUMNS,
          rows,
        });
      }
    }

    rows.sort((left, right) => right[0] - left[0]);

    return {
      username,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
      mode: "problem-status",
      limitCount: null,
      estimatedTotalCount: null,
      problemIds: [problemId],
      availableProblemCount,
      selectionSummary,
      totalCount: rows.length,
      pagesFetched,
      columns: BOJ_USER_SUBMISSION_COLUMNS,
      rows,
    };
  }

  async fetchUserSnapshot(username: string): Promise<BojUserSnapshot> {
    const profile = await this.fetchUserProfile(username);
    const languageStats = await this.fetchUserLanguageStats(username);

    return {
      username: profile.username,
      fetchedAt: new Date().toISOString(),
      profile,
      languageStats,
    };
  }

  async fetchProblemPage(problemId: number): Promise<BojProblemPageSnapshot> {
    const sourceUrl = new URL(`problem/${problemId}`, this.baseUrl).toString();
    const response = await this.getWithRateLimit(`problem/${problemId}`, {
      throwHttpErrors: false,
    });

    if (response.statusCode === 404) {
      throw new Error(`BOJ problem not found: ${problemId}`);
    }

    if (response.statusCode !== 200) {
      throw new Error(`Unexpected response from BOJ problem page: ${response.statusCode}`);
    }

    const $ = load(response.body);
    const title =
      normalizeWhitespace($("#problem_title").first().text()) ||
      normalizeWhitespace($("title").first().text()).replace(/^\d+번:\s*/, "") ||
      null;

    return {
      problemId,
      title,
      fetchedAt: new Date().toISOString(),
      sourceUrl,
      html: injectBaseHref(sanitizeProblemHtml(response.body), sourceUrl),
    };
  }

  async fetchProblemMetadata(problemId: number): Promise<BojProblemMetadataSnapshot> {
    const response = await this.getSolvedAcWithRateLimit("problem/show", {
      searchParams: {
        problemId,
      },
    });

    if (response.statusCode === 404) {
      throw new Error(`solved.ac problem metadata not found: ${problemId}`);
    }

    if (response.statusCode !== 200) {
      throw new Error(`Unexpected response from solved.ac problem API: ${response.statusCode}`);
    }

    const payload = JSON.parse(response.body) as SolvedAcProblemShowResponse;
    const level = isNumber(payload.level) ? payload.level : null;
    const sprout = isBoolean(payload.sprout) ? payload.sprout : null;

    return {
      problemId,
      titleKo: typeof payload.titleKo === "string" ? payload.titleKo : null,
      level,
      tierLabel: formatSolvedAcTier(level, sprout),
      acceptedUserCount: isNumber(payload.acceptedUserCount) ? payload.acceptedUserCount : null,
      averageTries: isNumber(payload.averageTries) ? payload.averageTries : null,
      official: isBoolean(payload.official) ? payload.official : null,
      sprout,
      givesNoRating: isBoolean(payload.givesNoRating) ? payload.givesNoRating : null,
      isLevelLocked: isBoolean(payload.isLevelLocked) ? payload.isLevelLocked : null,
      tags: Array.isArray(payload.tags) ? payload.tags.map(normalizeSolvedAcTag) : [],
    };
  }

  async fetchSubmissionSource(submissionId: number): Promise<BojSubmissionSourceSnapshot> {
    const sourceUrl = new URL(`source/${submissionId}`, this.baseUrl).toString();
    const response = await this.getWithRateLimit(`source/${submissionId}`, {
      throwHttpErrors: false,
    });

    if (response.statusCode === 404) {
      throw new Error(`BOJ submission source not found: ${submissionId}`);
    }

    if (response.statusCode === 403) {
      throw new Error(`BOJ denied access to submission source: ${submissionId}`);
    }

    if (response.statusCode !== 200) {
      throw new Error(`Unexpected response from BOJ submission source page: ${response.statusCode}`);
    }

    const $ = load(response.body);
    const code = $("textarea").first().text();
    const row = $(".table-responsive table tbody tr").first();
    const cells = row.find("td");

    if (!code || cells.length < 10) {
      throw new Error(`Could not parse BOJ submission source page for ${submissionId}.`);
    }

    const submittedAtAnchor = cells.eq(9).find("a").first();
    const resultSpan = cells.eq(4).find("span").first();

    return {
      submissionId,
      username: normalizeWhitespace(cells.eq(1).text()) || null,
      problemId: parseProblemId(cells.eq(2).text()),
      problemTitle: normalizeWhitespace(cells.eq(3).text()) || null,
      result: normalizeWhitespace(resultSpan.text()) || normalizeWhitespace(cells.eq(4).text()),
      resultClass: parseResultClass(resultSpan.attr("class") ?? ""),
      memoryKb: parseNullableNumber(normalizeWhitespace(cells.eq(5).text())),
      timeMs: parseNullableNumber(normalizeWhitespace(cells.eq(6).text())),
      language: normalizeWhitespace(cells.eq(7).text()),
      codeLength: parseNullableNumber(normalizeWhitespace(cells.eq(8).text())),
      submittedAt: normalizeWhitespace(submittedAtAnchor.attr("title") ?? "") || null,
      submittedAtTimestamp: parseNullableNumber(submittedAtAnchor.attr("data-timestamp")),
      sourceUrl,
      fetchedAt: new Date().toISOString(),
      code,
    };
  }

  getRateLimitSnapshot(): BojRateLimitSnapshot {
    return {
      requestDelayMs: this.requestDelayMs,
      jitterMs: this.requestJitterMs,
      nextDelayMs: Math.max(this.nextRequestAt - Date.now(), 0),
      scheduledDelayMs: this.scheduledDelayMs,
      delayReason: this.delayReason,
      backoffAttempt: this.backoffAttempt,
    };
  }

  private async fetchLoginForm(nextPath: string): Promise<LoginForm> {
    const response = await this.http.get("login", {
      searchParams: {
        next: nextPath,
      },
    });

    const $ = load(response.body);
    const form = $("#login_form");

    if (form.length === 0) {
      throw new AuthenticationError("Could not find BOJ login form.", "LOGIN_FORM_NOT_FOUND");
    }

    const hiddenFields: Record<string, string> = {};
    form.find('input[type="hidden"]').each((_, element) => {
      const name = $(element).attr("name");
      if (!name) {
        return;
      }

      hiddenFields[name] = $(element).attr("value") ?? "";
    });

    return {
      action: form.attr("action") ?? "/signin",
      hiddenFields,
      requiresCaptcha:
        $("#recaptcha").length > 0 ||
        $(".g-recaptcha").length > 0 ||
        response.body.includes("grecaptcha.execute"),
    };
  }

  private async getWithRateLimit(
    pathname: string,
    options: OptionsOfTextResponseBody = {},
  ): Promise<Response<string>> {
    let backoffAttempt = 0;

    while (true) {
      await this.waitForNextRequestWindow();

      const response = await this.http.get(pathname, {
        ...options,
        throwHttpErrors: false,
      });
      const isThrottled = response.statusCode === 403 || response.statusCode === 429;

      if (isThrottled && backoffAttempt < this.backoffScheduleMs.length) {
        const delayMs = this.backoffScheduleMs[backoffAttempt] ?? this.backoffScheduleMs.at(-1) ?? 60_000;
        backoffAttempt += 1;
        this.scheduleNextRequest(delayMs, "backoff", backoffAttempt);
        continue;
      }

      this.scheduleNextRequest(this.computeRequestDelayMs(), "base", 0);
      return response;
    }
  }

  private async waitForNextRequestWindow(): Promise<void> {
    const waitMs = Math.max(this.nextRequestAt - Date.now(), 0);

    if (waitMs <= 0) {
      return;
    }

    await sleep(waitMs);
  }

  private async getSolvedAcWithRateLimit(
    pathname: string,
    options: OptionsOfTextResponseBody = {},
  ): Promise<Response<string>> {
    let backoffAttempt = 0;

    while (true) {
      const waitMs = Math.max(this.nextSolvedAcRequestAt - Date.now(), 0);
      if (waitMs > 0) {
        await sleep(waitMs);
      }

      const response = await this.solvedAcHttp.get(pathname, {
        ...options,
        throwHttpErrors: false,
      });
      const isThrottled = response.statusCode === 403 || response.statusCode === 429;

      if (isThrottled && backoffAttempt < this.backoffScheduleMs.length) {
        const delayMs = this.backoffScheduleMs[backoffAttempt] ?? this.backoffScheduleMs.at(-1) ?? 60_000;
        backoffAttempt += 1;
        this.nextSolvedAcRequestAt = Date.now() + delayMs;
        continue;
      }

      this.nextSolvedAcRequestAt = Date.now() + 1_000;
      return response;
    }
  }

  private scheduleNextRequest(
    delayMs: number,
    reason: BojRateLimitDelayReason,
    backoffAttempt: number,
  ): void {
    this.nextRequestAt = Date.now() + delayMs;
    this.scheduledDelayMs = delayMs;
    this.delayReason = reason;
    this.backoffAttempt = backoffAttempt;
  }

  private computeRequestDelayMs(): number {
    if (this.requestJitterMs <= 0) {
      return this.requestDelayMs;
    }

    const jitter = (Math.random() * 2 - 1) * this.requestJitterMs;
    return Math.max(Math.round(this.requestDelayMs + jitter), 2_000);
  }
}

function normalizeGotPath(pathname: string): string {
  return pathname.replace(/^\/+/, "");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function injectBaseHref(html: string, href: string): string {
  const baseTag = `<base href="${escapeHtmlAttribute(href)}">`;

  if (/<base\s/i.test(html)) {
    return html;
  }

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }

  return `${baseTag}${html}`;
}

function sanitizeProblemHtml(html: string): string {
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] ?? null;
  const $ = load(html);
  const adWrappers = new Set<any>();
  const wrapperSelector = "div.no-print, .google-auto-placed, .adsbygoogle-noablate";

  const markWrappers = (elements: any): void => {
    elements.each((_: number, element: any) => {
      const wrapper = $(element).closest(wrapperSelector).first();
      if (wrapper.length > 0) {
        adWrappers.add(wrapper.get(0));
      }
    });
  };

  const directAdElements = $(
    [
      'script[src*="googletagmanager.com/gtag/js"]',
      'script[src*="pagead2.googlesyndication.com"]',
      'iframe[src*="doubleclick.net"]',
      'iframe[src*="googleads"]',
      "ins.adsbygoogle",
      "[data-ad-client]",
      "[data-ad-slot]",
      ".google-auto-placed",
      ".adsbygoogle-noablate",
    ].join(", "),
  );
  markWrappers(directAdElements);
  directAdElements.remove();

  const inlineTrackingScripts = $("script").filter((_, element) => {
    const content = $(element).html() ?? "";
    return /adsbygoogle|googletagmanager|gtag\(|dataLayer|ca-pub-/i.test(content);
  });
  markWrappers(inlineTrackingScripts);
  inlineTrackingScripts.remove();

  for (const wrapper of adWrappers) {
    $(wrapper).remove();
  }

  const serialized = $.html();
  if (!doctype) {
    return serialized;
  }

  return `${doctype}\n${serialized.replace(/^\s*<!doctype[^>]*>\s*/i, "")}`;
}

function parseStatusRow($: CheerioAPI, rowElement: any): BojUserSubmissionRow | null {
  const row = $(rowElement);
  const cells = row.find("td");

  if (cells.length < 9) {
    return null;
  }

  const submissionId = parseNullableNumber(normalizeWhitespace(cells.eq(0).text()));

  if (submissionId === null) {
    return null;
  }

  const problemAnchor = cells.eq(2).find("a").first();
  const resultSpan = cells.eq(3).find("span").first();
  const submittedAtAnchor = cells.eq(8).find("a").first();

  return [
    submissionId,
    parseProblemId(problemAnchor.text()) ?? parseProblemId(problemAnchor.attr("href") ?? ""),
    normalizeWhitespace(problemAnchor.attr("title") ?? "") || null,
    normalizeWhitespace(resultSpan.text()),
    parseResultClass(resultSpan.attr("class") ?? ""),
    parseNullableNumber(normalizeWhitespace(cells.eq(4).text())),
    parseNullableNumber(normalizeWhitespace(cells.eq(5).text())),
    normalizeWhitespace(cells.eq(6).text()),
    parseNullableNumber(normalizeWhitespace(cells.eq(7).text())),
    normalizeWhitespace(submittedAtAnchor.attr("title") ?? "") || null,
    parseNullableNumber(submittedAtAnchor.attr("data-timestamp")),
  ];
}

function parseProblemIdsByPanelTitle($: CheerioAPI, title: string): number[] {
  const panel = $(".panel-title")
    .filter((_, element) => normalizeWhitespace($(element).text()) === title)
    .first()
    .closest(".panel");

  if (panel.length === 0) {
    return [];
  }

  return panel
    .find(".problem-list a")
    .map((_, element) => {
      const problemId =
        parseProblemId($(element).text()) ?? parseProblemId($(element).attr("href") ?? "");

      return problemId;
    })
    .get()
    .filter((problemId): problemId is number => problemId !== null);
}

function parseProblemId(value: string): number | null {
  const match = value.match(/\d+/);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[0], 10);
}

function buildProblemStatusPath(username: string, problemId: number): string {
  return normalizeGotPath(
    `status?user_id=${encodeURIComponent(username)}&problem_id=${encodeURIComponent(String(problemId))}`,
  );
}

function parseResultClass(value: string): string | null {
  const className = value
    .split(/\s+/)
    .map((item) => item.trim())
    .find((item) => item.startsWith("result-") && item !== "result-text");

  return className || null;
}

function parseNullableNumber(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const digits = value.replace(/[^\d]/g, "");

  if (!digits) {
    return null;
  }

  return Number.parseInt(digits, 10);
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function throwIfStopRequested(shouldStop?: (() => boolean) | undefined): void {
  if (shouldStop?.()) {
    throw new StopRequestedError();
  }
}

interface SolvedAcProblemShowResponse {
  problemId?: unknown;
  titleKo?: unknown;
  level?: unknown;
  acceptedUserCount?: unknown;
  averageTries?: unknown;
  official?: unknown;
  sprout?: unknown;
  givesNoRating?: unknown;
  isLevelLocked?: unknown;
  tags?: unknown;
}

function normalizeSolvedAcTag(value: unknown): BojProblemMetadataTag {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const displayNames = Array.isArray(source.displayNames)
    ? source.displayNames.map((displayName) => normalizeSolvedAcTagDisplayName(displayName))
    : [];
  const aliases = Array.isArray(source.aliases)
    ? source.aliases.filter((alias): alias is string => typeof alias === "string")
    : [];

  return {
    key: typeof source.key === "string" ? source.key : "",
    isMeta: isBoolean(source.isMeta) ? source.isMeta : false,
    bojTagId: isNumber(source.bojTagId) ? source.bojTagId : null,
    problemCount: isNumber(source.problemCount) ? source.problemCount : null,
    displayNames,
    aliases,
  };
}

function normalizeSolvedAcTagDisplayName(value: unknown): BojProblemMetadataTagDisplayName {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    language: typeof source.language === "string" ? source.language : "",
    name: typeof source.name === "string" ? source.name : "",
    short: typeof source.short === "string" ? source.short : null,
  };
}

function formatSolvedAcTier(level: number | null, sprout: boolean | null): string | null {
  if (sprout) {
    return "Sprout";
  }

  if (level === null || level <= 0) {
    return null;
  }

  const families = [
    "Bronze",
    "Silver",
    "Gold",
    "Platinum",
    "Diamond",
    "Ruby",
  ];
  const family = families[Math.floor((level - 1) / 5)];

  if (!family) {
    return null;
  }

  const roman = ["V", "IV", "III", "II", "I"][(level - 1) % 5];
  return `${family} ${roman}`;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
