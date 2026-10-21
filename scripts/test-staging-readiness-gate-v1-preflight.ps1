$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$runnerPath = Join-Path $PSScriptRoot 'staging-readiness-gate-v1.ps1'
$tempRoot = [IO.Path]::GetTempPath()
$caseDirectory = Join-Path $tempRoot ('karturt-gate-v1-preflight-' + [Guid]::NewGuid().ToString('N'))
if ([IO.Directory]::Exists($caseDirectory) -or [IO.File]::Exists($caseDirectory)) {
  throw 'TEST_TEMP_PATH_COLLISION'
}
[void][IO.Directory]::CreateDirectory($caseDirectory)

try {
  $missingProviderPath = Join-Path $caseDirectory 'missing-provider.json'
  $failureEvidencePath = Join-Path $caseDirectory 'stop.json'
  $pwshExecutable = (Get-Process -Id $PID -ErrorAction Stop).Path
  if ([string]::IsNullOrWhiteSpace($pwshExecutable) -or -not [IO.File]::Exists($pwshExecutable)) {
    throw 'TEST_POWERSHELL_EXECUTABLE_UNAVAILABLE'
  }
  & $pwshExecutable -NoProfile -File $runnerPath `
    -ProviderEvidencePath $missingProviderPath `
    -EvidenceOutputPath $failureEvidencePath 1>$null 2>$null
  $runnerExitCode = $LASTEXITCODE
  if ($runnerExitCode -eq 0) { throw 'TEST_EXPECTED_PREFLIGHT_STOP' }
  if (-not [IO.File]::Exists($failureEvidencePath)) { throw 'TEST_FAILURE_ARTIFACT_MISSING' }

  $artifact = Get-Content -LiteralPath $failureEvidencePath -Raw | ConvertFrom-Json -ErrorAction Stop
  if ($artifact.result -cne 'DATABASE_PROBE_STOPPED' -or
      $artifact.stopCode -cne 'PROVIDER_EVIDENCE_MISSING' -or
      $artifact.providerPreflight -cne 'UNKNOWN' -or
      $artifact.stagingIsolation -cne 'UNKNOWN' -or
      $artifact.providerCaptureAuthentication -cne 'UNKNOWN' -or
      $artifact.overallGate -cne 'NOT_EVALUATED' -or
      $artifact.migrationAuthorization -cne 'NOT_GRANTED') {
    throw 'TEST_PREFLIGHT_EVIDENCE_FALSE_PASS'
  }

  $selfAssertedProviderPath = Join-Path $caseDirectory 'self-asserted-provider.json'
  $selfAssertedOutputPath = Join-Path $caseDirectory 'self-asserted-stop.json'
  $selfAssertedProvider = [ordered]@{
    schemaVersion = 'staging-readiness-gate-v1/evidence-artifact/v1'
    artifactType = 'provider-metadata'
    sourceSha = 'a' * 40
    provider = [ordered]@{
      provider = 'neon'
      projectId = 'broad-star-40451875'
      branchId = 'br-orange-recipe-azed9f78'
      claimedCaptureAuthentication = 'VERIFIED'
    }
    stagingIsolation = [ordered]@{ verificationStatus = 'VERIFIED'; classification = 'SYNTHETIC_ONLY' }
  }
  $selfAssertedJson = ConvertTo-Json -InputObject $selfAssertedProvider -Depth 6 -Compress
  [IO.File]::WriteAllText($selfAssertedProviderPath, $selfAssertedJson, [Text.UTF8Encoding]::new($false))
  & $pwshExecutable -NoProfile -File $runnerPath `
    -ProviderEvidencePath $selfAssertedProviderPath `
    -EvidenceOutputPath $selfAssertedOutputPath 1>$null 2>$null
  $runnerExitCode = $LASTEXITCODE
  if ($runnerExitCode -eq 0) { throw 'TEST_SELF_ASSERTED_PROVIDER_WAS_ACCEPTED' }
  if (-not [IO.File]::Exists($selfAssertedOutputPath)) { throw 'TEST_SELF_ASSERTED_STOP_EVIDENCE_MISSING' }
  $selfAssertedArtifact = Get-Content -LiteralPath $selfAssertedOutputPath -Raw | ConvertFrom-Json -ErrorAction Stop
  $failedSelfAssertedChecks = [Collections.Generic.List[string]]::new()
  if ($selfAssertedArtifact.result -cne 'DATABASE_PROBE_STOPPED') { $failedSelfAssertedChecks.Add('result') }
  if ($selfAssertedArtifact.stopCode -cne 'PROVIDER_CAPTURE_UNAUTHENTICATED') { $failedSelfAssertedChecks.Add('stopCode=' + [string]$selfAssertedArtifact.stopCode) }
  if ($selfAssertedArtifact.providerCaptureAuthentication -cne 'UNKNOWN') { $failedSelfAssertedChecks.Add('providerCaptureAuthentication') }
  if ($selfAssertedArtifact.providerPreflight -cne 'UNKNOWN') { $failedSelfAssertedChecks.Add('providerPreflight') }
  if ($selfAssertedArtifact.stagingIsolation -cne 'UNKNOWN') { $failedSelfAssertedChecks.Add('stagingIsolation') }
  if ($selfAssertedArtifact.overallGate -cne 'NOT_EVALUATED') { $failedSelfAssertedChecks.Add('overallGate') }
  if ($null -ne $selfAssertedArtifact.psqlVersion) { $failedSelfAssertedChecks.Add('psqlVersion') }
  if ($selfAssertedArtifact.databaseProbe.status -cne 'STOPPED') { $failedSelfAssertedChecks.Add('databaseProbe.status') }
  if ($selfAssertedArtifact.migrationAuthorization -cne 'NOT_GRANTED') { $failedSelfAssertedChecks.Add('migrationAuthorization') }
  if ($failedSelfAssertedChecks.Count -gt 0) {
    throw ('TEST_SELF_ASSERTED_PROVIDER_FALSE_PASS:' + ($failedSelfAssertedChecks -join ','))
  }

  Write-Output 'Staging Readiness Gate V1 early-stop and self-assertion regressions: PASS'
} finally {
  if ([IO.Directory]::Exists($caseDirectory)) {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
    $resolvedCase = [IO.Path]::GetFullPath($caseDirectory)
    if (-not $resolvedCase.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'TEST_TEMP_PATH_OUTSIDE_TEMP_ROOT'
    }
    Remove-Item -LiteralPath $resolvedCase -Recurse -Force
  }
}
