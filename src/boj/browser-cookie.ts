import { execFile } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import initSqlJs from "sql.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

type SqlJsModule = Awaited<ReturnType<typeof initSqlJs>>;

interface BrowserProfileRoot {
  browserName: string;
  userDataDir: string;
}

export interface BrowserBojCookieCandidate {
  browserName: string;
  profileName: string;
  hostKey: string;
  cookieHeader: string;
}

export interface BrowserBojCookieScanResult {
  candidates: BrowserBojCookieCandidate[];
  lockedProfiles: string[];
}

const BOJ_COOKIE_NAME = "OnlineJudge";

let sqlJsPromise: Promise<SqlJsModule> | null = null;

export async function findBrowserBojCookieCandidates(): Promise<BrowserBojCookieCandidate[]> {
  const result = await scanBrowserBojCookies();
  return result.candidates;
}

export async function scanBrowserBojCookies(): Promise<BrowserBojCookieScanResult> {
  if (process.platform !== "win32") {
    return {
      candidates: [],
      lockedProfiles: [],
    };
  }

  const browserRoots = resolveBrowserProfileRoots();
  const candidates: BrowserBojCookieCandidate[] = [];
  const lockedProfiles: string[] = [];

  for (const root of browserRoots) {
    const rootScan = await findBrowserCookiesInRoot(root);
    lockedProfiles.push(...rootScan.lockedProfiles);
    const rootCandidates = rootScan.candidates;
    candidates.push(...rootCandidates);
  }

  return {
    candidates,
    lockedProfiles,
  };
}

async function findBrowserCookiesInRoot(root: BrowserProfileRoot): Promise<BrowserBojCookieScanResult> {
  try {
    await stat(root.userDataDir);
  } catch {
    return {
      candidates: [],
      lockedProfiles: [],
    };
  }

  const masterKey = await readChromiumMasterKey(root.userDataDir);
  if (!masterKey) {
    return {
      candidates: [],
      lockedProfiles: [],
    };
  }

  const profileNames = await listBrowserProfiles(root.userDataDir);
  const candidates: BrowserBojCookieCandidate[] = [];
  const lockedProfiles: string[] = [];

  for (const profileName of profileNames) {
    const cookiesPath = await resolveCookiesPath(root.userDataDir, profileName);
    if (!cookiesPath) {
      continue;
    }

    const extraction = await extractCookieValueFromDatabase(cookiesPath, masterKey);
    if (extraction.locked) {
      lockedProfiles.push(`${root.browserName} ${profileName}`);
    }
    const value = extraction.value;
    if (!value) {
      continue;
    }

    candidates.push({
      browserName: root.browserName,
      profileName,
      hostKey: ".acmicpc.net",
      cookieHeader: `${BOJ_COOKIE_NAME}=${value}`,
    });
  }

  return {
    candidates,
    lockedProfiles,
  };
}

function resolveBrowserProfileRoots(): BrowserProfileRoot[] {
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (!localAppData) {
    return [];
  }

  return [
    {
      browserName: "Edge",
      userDataDir: path.join(localAppData, "Microsoft", "Edge", "User Data"),
    },
    {
      browserName: "Chrome",
      userDataDir: path.join(localAppData, "Google", "Chrome", "User Data"),
    },
    {
      browserName: "Brave",
      userDataDir: path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data"),
    },
  ];
}

async function listBrowserProfiles(userDataDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(userDataDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && (entry.name === "Default" || entry.name.startsWith("Profile ")))
    .map((entry) => entry.name)
    .sort((left, right) => {
      if (left === "Default") {
        return -1;
      }
      if (right === "Default") {
        return 1;
      }
      return left.localeCompare(right);
    });
}

async function resolveCookiesPath(userDataDir: string, profileName: string): Promise<string | null> {
  const candidates = [
    path.join(userDataDir, profileName, "Network", "Cookies"),
    path.join(userDataDir, profileName, "Cookies"),
  ];

  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

async function readChromiumMasterKey(userDataDir: string): Promise<Buffer | null> {
  const localStatePath = path.join(userDataDir, "Local State");
  let raw: string;
  try {
    raw = await readFile(localStatePath, "utf8");
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      os_crypt?: {
        encrypted_key?: string;
      };
    };
    const encryptedKeyBase64 = parsed.os_crypt?.encrypted_key;
    if (!encryptedKeyBase64) {
      return null;
    }

    const encryptedKey = Buffer.from(encryptedKeyBase64, "base64");
    if (encryptedKey.length <= 5) {
      return null;
    }

    const dpapiPayload = encryptedKey.subarray(5);
    return await decryptWindowsDpapi(dpapiPayload);
  } catch {
    return null;
  }
}

async function extractCookieValueFromDatabase(
  cookiesPath: string,
  masterKey: Buffer,
): Promise<{ value: string | null; locked: boolean }> {
  try {
    const databaseBytes = await readFile(cookiesPath);
    const sqlJs = await loadSqlJs();
    const database = new sqlJs.Database(databaseBytes);
    const statement = database.prepare(`
      SELECT host_key, value, encrypted_value
      FROM cookies
      WHERE name = $cookieName
        AND (host_key = 'acmicpc.net' OR host_key = '.acmicpc.net' OR host_key = 'www.acmicpc.net' OR host_key LIKE '%.acmicpc.net')
      ORDER BY CASE WHEN host_key = '.acmicpc.net' THEN 0 ELSE 1 END, length(host_key) DESC
    `);

    statement.bind({
      $cookieName: BOJ_COOKIE_NAME,
    });

    while (statement.step()) {
      const row = statement.get();
      const plainValue = typeof row[1] === "string" ? row[1].trim() : "";
      if (plainValue) {
        return { value: plainValue, locked: false };
      }

      const encryptedValue = normalizeEncryptedValue(row[2]);
      if (!encryptedValue || encryptedValue.length === 0) {
        continue;
      }

      const decryptedValue = await decryptChromiumCookieValue(encryptedValue, masterKey);
      if (decryptedValue) {
        return { value: decryptedValue, locked: false };
      }
    }

    statement.free();
    database.close();
    return { value: null, locked: false };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    return {
      value: null,
      locked: code === "EBUSY" || code === "EPERM",
    };
  }
}

async function loadSqlJs(): Promise<SqlJsModule> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({
      locateFile: (file) => pathToFileURL(require.resolve(`sql.js/dist/${file}`)).toString(),
    });
  }

  return sqlJsPromise;
}

function normalizeEncryptedValue(value: unknown): Buffer | null {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (Array.isArray(value)) {
    return Buffer.from(value);
  }

  if (typeof value === "string") {
    return Buffer.from(value, "binary");
  }

  return null;
}

async function decryptChromiumCookieValue(encryptedValue: Buffer, masterKey: Buffer): Promise<string | null> {
  const versionPrefix = encryptedValue.subarray(0, 3).toString("utf8");

  if (versionPrefix === "v10" || versionPrefix === "v11") {
    try {
      const nonce = encryptedValue.subarray(3, 15);
      const cipherText = encryptedValue.subarray(15, encryptedValue.length - 16);
      const authTag = encryptedValue.subarray(encryptedValue.length - 16);
      const decipher = createDecipheriv("aes-256-gcm", masterKey, nonce);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }

  if (versionPrefix === "v20") {
    return null;
  }

  try {
    const decrypted = await decryptWindowsDpapi(encryptedValue);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

async function decryptWindowsDpapi(payload: Buffer): Promise<Buffer> {
  const payloadBase64 = payload.toString("base64");
  const script = [
    "Add-Type -AssemblyName System.Security",
    `$bytes = [Convert]::FromBase64String('${payloadBase64}')`,
    "$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Convert]::ToBase64String($plain)",
  ].join("; ");
  const result = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-Command",
    script,
  ], {
    encoding: "utf8",
    windowsHide: true,
  });

  const output = result.stdout.trim();
  if (!output) {
    throw new Error("Failed to decrypt DPAPI payload.");
  }

  return Buffer.from(output, "base64");
}
