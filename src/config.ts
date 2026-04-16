import { config as loadDotenv } from "dotenv";
import path from "node:path";

import { ConfigurationError } from "./errors.js";

export interface AppConfig {
  bojId?: string;
  bojPassword?: string;
  bojCookie?: string;
  baseUrl: string;
  userAgent: string;
  requestDelayMs: number;
  requestJitterMs: number;
  backoffScheduleMs: number[];
}

let envLoaded = false;

export function loadConfig(cwd = process.cwd()): AppConfig {
  if (!envLoaded) {
    loadDotenv({ path: path.join(cwd, ".env"), quiet: true });
    envLoaded = true;
  }

  const bojId = process.env.BOJ_ID?.trim() || undefined;
  const bojPassword = process.env.BOJ_PW?.trim() || undefined;
  const bojCookie = process.env.BOJ_COOKIE?.trim() || undefined;
  const requestDelayMs = parseOptionalPositiveInt(process.env.BOJ_DELAY_MS) ?? 3_000;

  if ((bojId && !bojPassword) || (!bojId && bojPassword)) {
    throw new ConfigurationError("BOJ_ID and BOJ_PW must both be set together.");
  }

  return {
    bojId,
    bojPassword,
    bojCookie,
    baseUrl: "https://www.acmicpc.net",
    userAgent: "boj-backup/0.1.0",
    requestDelayMs,
    requestJitterMs: 500,
    backoffScheduleMs: [10_000, 30_000, 60_000],
  };
}

function parseOptionalPositiveInt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 2_000) {
    throw new ConfigurationError(`Invalid BOJ_DELAY_MS: ${value}. Use 2000 or greater.`);
  }

  return parsed;
}
