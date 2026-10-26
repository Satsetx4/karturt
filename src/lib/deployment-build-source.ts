const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function isExactVercelPreviewGitBuild(
  environment: Readonly<Record<string, string | undefined>>,
  releaseSha: string,
) {
  const gitCommitSha = environment.VERCEL_GIT_COMMIT_SHA?.trim();
  return environment.VERCEL_ENV === "preview" &&
    FULL_COMMIT_SHA.test(releaseSha) &&
    gitCommitSha !== undefined &&
    FULL_COMMIT_SHA.test(gitCommitSha) &&
    gitCommitSha.toLowerCase() === releaseSha.toLowerCase();
}
