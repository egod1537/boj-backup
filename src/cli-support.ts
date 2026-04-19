import { rename, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { authenticateBojClient } from "./boj/auth.js";
import { BojSessionClient } from "./boj/session.js";
import type { AppConfig } from "./config.js";

export async function authenticateClient(
  client: BojSessionClient,
  config: AppConfig,
): Promise<string> {
  const auth = await authenticateBojClient(client, config);
  return auth.username;
}

export function createClient(
  config: AppConfig,
  delaySeconds?: number,
): BojSessionClient {
  return new BojSessionClient({
    baseUrl: config.baseUrl,
    credentials: {
      userId: config.bojId ?? "",
      password: config.bojPassword ?? "",
    },
    userAgent: config.userAgent,
    requestDelayMs: delaySeconds ? Math.round(delaySeconds * 1000) : config.requestDelayMs,
    requestJitterMs: config.requestJitterMs,
    backoffScheduleMs: config.backoffScheduleMs,
    requestTimeoutMs: config.requestTimeoutMs,
    maxRequestTimeoutMs: config.maxRequestTimeoutMs,
  });
}

export async function writeJsonFile(outputPath: string, value: unknown): Promise<void> {
  const absolutePath = path.resolve(outputPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.tmp-${process.pid}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rm(absolutePath, { force: true });
  await rename(tempPath, absolutePath);
}

export function createInterruptController(message: string): {
  shouldStop: () => boolean;
  close: () => void;
} {
  let stopRequested = false;

  const handler = () => {
    if (stopRequested) {
      return;
    }

    stopRequested = true;
    process.stderr.write(`[interrupt] ${message}\n`);
  };

  process.on("SIGINT", handler);

  return {
    shouldStop: () => stopRequested,
    close: () => {
      process.off("SIGINT", handler);
    },
  };
}

export function formatDisplayPath(filePath: string): string {
  const relativePath = path.relative(process.cwd(), filePath);
  return relativePath && !relativePath.startsWith("..") ? relativePath : filePath;
}
