const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;

export function isExactVercelPreviewReleaseBuild(
  environment: Readonly<Record<string, string | undefined>>,
  releaseSha: string,
) {
  if (environment.VERCEL_ENV !== "preview" || !FULL_COMMIT_SHA.test(releaseSha)) return false;

  const gitCommitSha = environment.VERCEL_GIT_COMMIT_SHA?.trim();
  if (gitCommitSha !== undefined) {
    return FULL_COMMIT_SHA.test(gitCommitSha) &&
      gitCommitSha.toLowerCase() === releaseSha.toLowerCase();
  }

  const declaredPreviewSha = environment.KARTURT_VERCEL_PREVIEW_RELEASE_SHA?.trim();
  return environment.VERCEL === "1" &&
    declaredPreviewSha !== undefined &&
    FULL_COMMIT_SHA.test(declaredPreviewSha) &&
    declaredPreviewSha.toLowerCase() === releaseSha.toLowerCase();
}
