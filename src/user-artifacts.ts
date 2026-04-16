import path from "node:path";

export interface UserArtifactPaths {
  rootDir: string;
  userDir: string;
  profilePath: string;
  submissionsPath: string;
  problemsDir: string;
}

export function sanitizeArtifactUsername(username: string): string {
  return username.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
}

export function resolveUserArtifactPaths(username: string, rootDir = "data"): UserArtifactPaths {
  const absoluteRootDir = path.resolve(rootDir);
  const safeUsername = sanitizeArtifactUsername(username);
  const userDir = path.join(absoluteRootDir, safeUsername);

  return {
    rootDir: absoluteRootDir,
    userDir,
    profilePath: path.join(userDir, "profile.json"),
    submissionsPath: path.join(userDir, "submissions.json"),
    problemsDir: path.join(userDir, "problems"),
  };
}
