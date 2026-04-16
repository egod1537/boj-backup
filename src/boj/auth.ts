import type { AppConfig } from "../config.js";
import { AuthenticationError } from "../errors.js";
import { scanBrowserBojCookies } from "./browser-cookie.js";
import type { BojSessionClient } from "./session.js";

export interface AuthenticatedBojSession {
  username: string;
  source: "env-cookie" | "browser-cookie" | "credentials";
  detail: string;
  redirectLocation?: string;
}

export async function authenticateBojClient(
  client: BojSessionClient,
  config: AppConfig,
  options: { nextPath?: string } = {},
): Promise<AuthenticatedBojSession> {
  if (config.bojCookie) {
    const username = await tryAuthenticateWithCookieHeader(client, config.bojCookie);
    if (username) {
      return {
        username,
        source: "env-cookie",
        detail: "BOJ_COOKIE",
      };
    }
  }

  const browserScan = await scanBrowserBojCookies();
  for (const candidate of browserScan.candidates) {
    const username = await tryAuthenticateWithCookieHeader(client, candidate.cookieHeader);
    if (username) {
      return {
        username,
        source: "browser-cookie",
        detail: `${candidate.browserName} ${candidate.profileName}`,
      };
    }
  }

  if (config.bojId && config.bojPassword) {
    try {
      const result = await client.login({ nextPath: options.nextPath });
      return {
        username: result.username,
        source: "credentials",
        detail: "BOJ_ID/BOJ_PW",
        redirectLocation: result.redirectLocation,
      };
    } catch (error) {
      if (
        error instanceof AuthenticationError &&
        error.code === "CAPTCHA_REQUIRED" &&
        browserScan.lockedProfiles.length > 0
      ) {
        throw new AuthenticationError(
          `Detected BOJ browser sessions, but the Chromium cookie DB is locked by a running browser (${browserScan.lockedProfiles.join(", ")}). Close those browser windows or set BOJ_COOKIE in .env, then retry.`,
          "CAPTCHA_REQUIRED",
        );
      }

      throw error;
    }
  }

  if (browserScan.lockedProfiles.length > 0) {
    throw new AuthenticationError(
      `Detected BOJ browser session storage, but the Chromium cookie DB is locked by a running browser (${browserScan.lockedProfiles.join(", ")}). Close those browser windows or set BOJ_COOKIE in .env, then retry.`,
      "COOKIE_INVALID",
    );
  }

  throw new AuthenticationError(
    "No usable BOJ session found. Set BOJ_COOKIE, keep BOJ logged in in Chrome/Edge on this Windows account, or set BOJ_ID/BOJ_PW.",
    "COOKIE_INVALID",
  );
}

async function tryAuthenticateWithCookieHeader(
  client: BojSessionClient,
  cookieHeader: string,
): Promise<string | null> {
  await client.clearCookies();
  await client.importCookieHeader(cookieHeader);
  return client.fetchCurrentUsername();
}
