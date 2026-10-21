$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$conninfoModulePath = Join-Path $PSScriptRoot 'lib/staging-readiness-conninfo-v1.psm1'
Import-Module -Name $conninfoModulePath -Force -ErrorAction Stop

function Assert-ConninfoRejects([string]$Text, [string]$ExpectedCode) {
  $rejectedAsExpected = $false
  try {
    $null = ConvertFrom-Psql18ConninfoV1 -Text $Text
  } catch {
    if ([string]$_.Exception.Message -ceq $ExpectedCode) {
      $rejectedAsExpected = $true
    } else {
      throw
    }
  }
  if (-not $rejectedAsExpected) { throw ('TEST_CONNINFO_ACCEPTED_INVALID_INPUT:' + $ExpectedCode) }
}

$psql18OutputFixture = @'
Database|neondb
Client User|neondb_owner
Host|ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech
Host Address|192.0.2.41
Server Port|5432
Options|
Protocol Version|3.0
Password Used|true
GSSAPI Authenticated|false
Backend PID|12345
SSL Connection|true
SSL Library|OpenSSL
SSL Protocol|TLSv1.3
SSL Key Bits|256
SSL Cipher|TLS_AES_256_GCM_SHA384
SSL Compression|false
ALPN|none
Superuser|false
Hot Standby|false
{"kind":"identity"}
{"kind":"catalog_counts"}
'@
$fixtureLines = @([regex]::Split($psql18OutputFixture, '\r?\n') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$fixtureJsonStart = -1
for ($index = 0; $index -lt $fixtureLines.Count; $index++) {
  if ($fixtureLines[$index].TrimStart().StartsWith('{', [StringComparison]::Ordinal)) {
    $fixtureJsonStart = $index
    break
  }
}
if ($fixtureJsonStart -lt 1 -or $fixtureLines.Count -ne ($fixtureJsonStart + 2)) {
  throw 'TEST_PG18_CONNINFO_FIXTURE_SHAPE_INVALID'
}
$fixtureConninfo = $fixtureLines[0..($fixtureJsonStart - 1)] -join "`n"
$parsedConninfo = ConvertFrom-Psql18ConninfoV1 -Text $fixtureConninfo
if ($parsedConninfo.Database -cne 'neondb' -or
    $parsedConninfo.Role -cne 'neondb_owner' -or
    $parsedConninfo.Host -cne 'ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech' -or
    $parsedConninfo.Port -cne '5432' -or
    $parsedConninfo.Protocol -cne 'TLSv1.3' -or
    $parsedConninfo.Cipher -cne 'TLS_AES_256_GCM_SHA384') {
  throw 'TEST_PG18_CONNINFO_FIELDS_MISMATCH'
}

$withoutHostAddress = $fixtureConninfo -replace '(?m)^Host Address\|[^\r\n]*\r?\n', ''
$parsedWithoutHostAddress = ConvertFrom-Psql18ConninfoV1 -Text $withoutHostAddress
if ($parsedWithoutHostAddress.Host -cne $parsedConninfo.Host) {
  throw 'TEST_OPTIONAL_HOST_ADDRESS_CHANGED_HOST_IDENTITY'
}

Assert-ConninfoRejects -Text ($fixtureConninfo + "`nDatabase|neondb") -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace '(?m)^Backend PID\|[^\r\n]*\r?\n', '') -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo + "`nUnexpected|value") -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'Database\|neondb', 'Database neondb') -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text 'You are connected to database "neondb" as user "neondb_owner" on host "host" at port "5432".' -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'Database\|neondb', 'Datenbank|neondb') -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'SSL Connection\|true', 'SSL Connection|false') -ExpectedCode 'LIBPQ_TLS_PROOF_MISSING'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'SSL Protocol\|TLSv1.3', 'SSL Protocol|TLSv1.1') -ExpectedCode 'LIBPQ_TLS_PROOF_MISSING'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'SSL Cipher\|TLS_AES_256_GCM_SHA384', 'SSL Cipher|unknown') -ExpectedCode 'LIBPQ_TLS_PROOF_MISSING'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'SSL Compression\|false', 'SSL Compression|true') -ExpectedCode 'LIBPQ_TLS_PROOF_MISSING'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'SSL Protocol\|TLSv1.3\r?\n', '') -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'Options\|', 'Options|one|two') -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'Host Address\|192.0.2.41', 'Host Address|not-an-ip') -ExpectedCode 'CONNECTION_INFO_INVALID'

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

  Write-Output 'Staging Readiness Gate V1 PostgreSQL 18 conninfo, early-stop, and self-assertion regressions: PASS'
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
