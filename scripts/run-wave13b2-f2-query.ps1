[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{64}$')]
  [string]$TrustedPublicKeyFingerprint
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/wave13b2-f2-runtime.ps1')
$runtimeGateResult = Get-Wave13B2F2RuntimeGateResult
if (-not $runtimeGateResult.Supported) {
  [Console]::Error.WriteLine($runtimeGateResult.FailureCode)
  [Console]::Error.WriteLine('Required runtime: ' + $runtimeGateResult.RequiredRuntime)
  exit 78
}

Import-Module (Join-Path $PSScriptRoot 'lib/wave13b2-f2-runner.psm1') -Force

function Require-Condition([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Resolve-ApplicationPath([string]$Name) {
  $application = Get-Command -Name $Name -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $path = [string]$application.Source
  Require-Condition (-not [string]::IsNullOrWhiteSpace($path) -and [IO.Path]::IsPathRooted($path)) ('Could not resolve an absolute application path for ' + $Name + '.')
  Require-Condition ([IO.Path]::GetFileName($path) -ieq $Name -and (Test-Path -LiteralPath $path -PathType Leaf)) ('Resolved application path is invalid for ' + $Name + '.')
  return (Resolve-Path -LiteralPath $path).Path
}

function Get-Sha256Hex([byte[]]$Bytes) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha256.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Get-StreamSha256Hex([IO.Stream]$Stream) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha256.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Read-OwnerRunConfirmation([string]$SourceSha, [string]$QuerySha256) {
  Require-Condition ($Host.Name -eq 'ConsoleHost' -and -not [Console]::IsInputRedirected) 'Owner confirmation requires a direct interactive PowerShell console; automated and redirected invocation is blocked.'
  $requiredText = 'RUN WAVE13B2 F2 ' + $SourceSha.Substring(0, 12) + ' ' + $QuerySha256.Substring(0, 12)
  Write-Host ('Owner approval is bound to source ' + $SourceSha + ' and query ' + $QuerySha256 + '.')
  Write-Host ('Type exactly: ' + $requiredText)
  $typed = [Text.StringBuilder]::new()
  while ($true) {
    $key = [Console]::ReadKey($true)
    if ($key.Key -eq [ConsoleKey]::Enter) { break }
    if ($key.Key -eq [ConsoleKey]::Backspace) {
      if ($typed.Length -gt 0) { [void]$typed.Remove($typed.Length - 1, 1) }
      continue
    }
    if (-not [char]::IsControl($key.KeyChar)) { [void]$typed.Append($key.KeyChar) }
  }
  Require-Condition ([string]::Equals($typed.ToString(), $requiredText, [StringComparison]::Ordinal)) 'Owner confirmation did not match this source and query; no SQL was run.'
}

function Invoke-OfflinePreflight {
  $preflightOutput = @(& $nodeExecutable $preflightPath `
    --repo-root $repoRoot `
    --secret-dir $secretDir `
    --application-source-sha $applicationSourceSha `
    --trusted-public-key-fingerprint $TrustedPublicKeyFingerprint `
    --git-path $gitExecutable `
    --psql-path $psqlExecutable)
  $preflightExitCode = $LASTEXITCODE
  $preflightText = ($preflightOutput -join "`n").Trim()
  if ($preflightText) { Write-Host $preflightText }
  Require-Condition ($preflightExitCode -eq 0) 'Offline preflight did not pass for the exact source and query; no SQL was run.'
  return ConvertFrom-Wave13B2F2PreflightOutput `
    -Text $preflightText `
    -ExpectedSourceSha $applicationSourceSha `
    -ExpectedQuerySha256 $queryPacketSha256
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeExecutable = Resolve-ApplicationPath 'node.exe'
$psqlExecutable = Resolve-ApplicationPath 'psql.exe'
$gitExecutable = Resolve-ApplicationPath 'git.exe'
$applicationSourceSha = (& $gitExecutable -C $repoRoot rev-parse --verify 'HEAD^{commit}').Trim()
Require-Condition ($LASTEXITCODE -eq 0 -and $applicationSourceSha -match '^[a-f0-9]{40}$') 'Could not identify the reviewed source commit.'

$secretRoot = Join-Path $env:LOCALAPPDATA 'KarturtStageOperator'
$secretDir = Join-Path $secretRoot ('f2-attempt-' + $applicationSourceSha)
$attemptMarkerPath = Join-Path $secretDir ('wave13b2-f2-query-attempt-' + $applicationSourceSha + '.local.txt')
Require-Condition (-not (Test-Path -LiteralPath $attemptMarkerPath)) 'This source SHA already has an attempt marker; preserve it and stop.'

$conflictingEnvironmentNames = @(
  'PGPASSWORD', 'PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE',
  'PGSSLCERT', 'PGSSLKEY', 'PGSSLCRL', 'PGSSLCRLDIR'
)
foreach ($name in $conflictingEnvironmentNames) {
  if (Test-Path -LiteralPath ('Env:' + $name)) {
    throw 'A conflicting PostgreSQL environment override is present; clear it through the owner process and rerun the offline review.'
  }
}

$boundEnvironmentNames = @(
  'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGSSLMODE',
  'PGCHANNELBINDING', 'PGPASSFILE', 'PGSSLROOTCERT', 'PGCONNECT_TIMEOUT'
)
$previousEnvironment = @{}
foreach ($name in $boundEnvironmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

$environmentValues = @{
  PGHOST = 'ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech'
  PGPORT = '5432'
  PGDATABASE = 'neondb'
  PGUSER = 'neondb_owner'
  PGSSLMODE = 'verify-full'
  PGCHANNELBINDING = 'require'
  PGPASSFILE = (Join-Path $secretDir 'pgpass.conf')
  PGSSLROOTCERT = (Join-Path $secretDir 'cacert.pem')
  PGCONNECT_TIMEOUT = '10'
}

$queryPacketSha256 = 'bd4a9c725268dc80e3eab10d28da585da3399e6f75db676c29e9e014c5127c49'
$queryPath = Join-Path $repoRoot 'docs/codex/wave13b2-read-only-catalog-preflight.sql'
$querySnapshotPath = Join-Path $secretDir ('wave13b2-read-only-catalog-preflight-' + $queryPacketSha256 + '.sql')
$auditPath = Join-Path $secretDir ('wave13b2-f2-audit-' + $applicationSourceSha + '-' + $queryPacketSha256 + '.local.txt')
$evidencePath = Join-Path $secretDir ('wave13b2-f2-catalog-evidence-' + $applicationSourceSha + '-' + $queryPacketSha256 + '.local.txt')
$queryLock = $null
$preflightPath = Join-Path $repoRoot 'scripts/preflight-wave13b2-local.mjs'
$aclCheckerPath = Join-Path $repoRoot 'scripts/check-wave13b2-secret-acl.ps1'
$psqlExitCode = -1
$attemptStartedAt = [DateTime]::UtcNow.ToString('o')
$markerCreated = $false
$markerFinalized = $false
$runResult = $null
$classification = $null
$initialPreflight = $null
$finalPreflight = $null
$previousNativeErrorPreference = $null
$hasNativeErrorPreference = $false

try {
  foreach ($name in $boundEnvironmentNames) {
    Set-Item -Path ('Env:' + $name) -Value $environmentValues[$name]
  }

  $initialPreflight = Invoke-OfflinePreflight

  $queryBytes = [IO.File]::ReadAllBytes($queryPath)
  $sourceQueryHash = Get-Sha256Hex -Bytes $queryBytes
  Require-Condition ($sourceQueryHash -eq $queryPacketSha256) 'The repository query bytes no longer match the approved query hash; no SQL was run.'
  if (Test-Path -LiteralPath $querySnapshotPath) {
    $snapshotAclOutput = @(& $aclCheckerPath -Path $querySnapshotPath)
    Require-Condition (($snapshotAclOutput -join '').Trim() -eq 'PASS') 'The existing query snapshot ACL check failed; no SQL was run.'
  } else {
    $snapshotStream = [IO.File]::Open($querySnapshotPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
      $snapshotStream.Write($queryBytes, 0, $queryBytes.Length)
      $snapshotStream.Flush($true)
    } finally {
      $snapshotStream.Dispose()
    }
    $snapshotAclOutput = @(& $aclCheckerPath -Path $querySnapshotPath)
    Require-Condition (($snapshotAclOutput -join '').Trim() -eq 'PASS') 'The protected query snapshot ACL check failed; no SQL was run.'
  }
  $queryLock = [IO.File]::Open($querySnapshotPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $lockedQueryHash = Get-StreamSha256Hex -Stream $queryLock
  Require-Condition ($lockedQueryHash -eq $queryPacketSha256) 'The locked query snapshot does not match the approved query hash; no SQL was run.'
  $queryLock.Position = 0
  Require-Condition (-not (Test-Path -LiteralPath $auditPath)) 'Sanitized audit evidence already exists for this source and query; preserve it and stop.'
  Require-Condition (-not (Test-Path -LiteralPath $evidencePath)) 'Full owner evidence already exists for this source and query; preserve it and stop.'

  Read-OwnerRunConfirmation -SourceSha $applicationSourceSha -QuerySha256 $queryPacketSha256

  $markerText = @(
    'status=STARTED'
    'startedAtUtc=' + $attemptStartedAt
    'sourceSha=' + $applicationSourceSha
    'queryPacketSha256=' + $queryPacketSha256
    'expectedStateFile=' + $initialPreflight.ExpectedStateFile
    'expectedStateSha256=' + $initialPreflight.ExpectedStateSha256
    'expectedStateBytes=' + $initialPreflight.ExpectedStateBytes
    'targetProjectId=broad-star-40451875'
    'targetBranchId=br-orange-recipe-azed9f78'
    'targetEndpointId=ep-mute-firefly-azjcru4h'
    ''
  ) -join "`n"
  $markerBytes = [Text.UTF8Encoding]::new($false).GetBytes($markerText)
  $markerStream = [IO.File]::Open($attemptMarkerPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $markerStream.Write($markerBytes, 0, $markerBytes.Length)
  } finally {
    $markerStream.Dispose()
  }
  $markerCreated = $true

  $queryLock.Position = 0
  $lockedQueryHash = Get-StreamSha256Hex -Stream $queryLock
  Require-Condition ($lockedQueryHash -eq $queryPacketSha256) 'The locked query snapshot changed before the connection; no SQL was run.'

  $preference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
  if ($null -ne $preference) {
    $previousNativeErrorPreference = $preference.Value
    $hasNativeErrorPreference = $true
    Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $false
  }

  $psqlArgs = @(
    '-X', '-w', '-P', 'pager=off', '-P', 'format=csv', '-P', 'footer=off', '-v', 'ON_ERROR_STOP=1',
    '-h', 'ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech',
    '-p', '5432', '-d', 'neondb', '-U', 'neondb_owner',
    '-v', 'owner_signed_query_approval_verified=on',
    '-v', 'target_project_id=broad-star-40451875',
    '-v', 'target_branch_id=br-orange-recipe-azed9f78',
    '-v', 'target_endpoint_id=ep-mute-firefly-azjcru4h',
    '-v', ('approved_source_sha=' + $applicationSourceSha),
    '-v', ('query_packet_sha256=' + $queryPacketSha256),
    '-v', 'expected_database=neondb',
    '-v', 'expected_owner_role=neondb_owner',
    '-f', $querySnapshotPath
  )
  $finalPreflight = Invoke-OfflinePreflight
  [void](Assert-Wave13B2F2PreflightMetadataMatch -Initial $initialPreflight -Final $finalPreflight)

  $runResult = Invoke-Wave13B2F2Psql `
    -PsqlExecutable $psqlExecutable `
    -ArgumentList $psqlArgs `
    -EvidencePath $evidencePath `
    -AclCheckerPath $aclCheckerPath `
    -ExpectedSourceSha $applicationSourceSha `
    -ExpectedQuerySha256 $queryPacketSha256
  $runResult | Add-Member -MemberType NoteProperty -Name ExpectedStateSha256 -Value $initialPreflight.ExpectedStateSha256 -Force
  $runResult | Add-Member -MemberType NoteProperty -Name ExpectedStateBytes -Value $initialPreflight.ExpectedStateBytes -Force
  $psqlExitCode = $runResult.ExitCode
  $classification = Get-Wave13B2F2RunClassification `
    -ExitCode $runResult.ExitCode `
    -ControlMarkers $runResult.ControlMarkers `
    -StderrMarkers $runResult.StderrMarkers `
    -ExpectedSourceSha $applicationSourceSha `
    -ExpectedQuerySha256 $queryPacketSha256 `
    -EvidenceVerified $runResult.EvidenceVerified `
    -FailureCodes $runResult.FailureCodes
  $auditSha256 = Write-Wave13B2F2AuditEvidence -Path $auditPath -Content (New-Wave13B2F2AuditContent `
    -SourceSha $applicationSourceSha `
    -QuerySha256 $queryPacketSha256 `
    -RunResult $runResult `
    -Classification $classification) -AclCheckerPath $aclCheckerPath
  $auditAclOutput = @(& $aclCheckerPath -Path $auditPath -RequireProtected)
  Require-Condition (($auditAclOutput -join '').Trim() -eq 'PASS') 'The sanitized audit evidence ACL check failed; the attempt is FAILED.'
  Add-Wave13B2F2AttemptResult `
    -MarkerPath $attemptMarkerPath `
    -RunResult $runResult `
    -Classification $classification `
    -AuditFileName ([IO.Path]::GetFileName($auditPath)) `
    -AuditSha256 $auditSha256
  $markerFinalized = $true
  Write-Host ('F2 runner status=' + $classification.Status + ' psqlExitCode=' + $psqlExitCode)
  foreach ($failureCode in @($classification.FailureCodes | Where-Object { $_ -match '^F2_[A-Z0-9_]+$' })) {
    Write-Host ('F2_FAIL ' + $failureCode)
  }
  Write-Host ('Full owner evidence: ' + [IO.Path]::GetFileName($evidencePath) + ' bytes=' + $runResult.EvidenceBytes + ' sha256=' + $runResult.EvidenceSha256 + ' verified=' + $runResult.EvidenceVerified)
  Write-Host ('Sanitized audit evidence: ' + [IO.Path]::GetFileName($auditPath) + ' sha256=' + $auditSha256)
  Require-Condition ($classification.Status -eq 'COMPLETED') 'The read-only query did not satisfy the exact completion contract; preserve the attempt marker and stop.'
} catch {
  if ($markerCreated -and -not $markerFinalized) {
    $abortCode = 'F2_RUNNER_ABORTED_BEFORE_PSQL'
    if ($_.Exception.Message -ceq 'F2_EXPECTED_STATE_PREFLIGHT_INVALID' -or
      $_.Exception.Message -ceq 'F2_EXPECTED_STATE_PREFLIGHT_MISMATCH') {
      $abortCode = $_.Exception.Message
    }
    $expectedStateSha256 = 'unavailable'
    $expectedStateBytes = -1L
    if ($null -ne $initialPreflight) {
      $expectedStateSha256 = $initialPreflight.ExpectedStateSha256
      $expectedStateBytes = $initialPreflight.ExpectedStateBytes
    }
    if ($null -eq $runResult) {
      $runResult = [pscustomobject]@{
        ExitCode = -1
        PsqlStarted = $false
        ProcessId = -1
        CaptureComplete = $false
        ControlMarkers = [string[]]@()
        StderrMarkers = [string[]]@()
        DiagnosticLines = [string[]]@()
        FailureCodes = [string[]]@($abortCode)
        EvidenceVerified = $false
        EvidenceBytes = -1L
        EvidenceSha256 = 'unavailable'
        EvidencePath = $evidencePath
        StderrBytes = 0L
        StderrSha256 = 'unavailable'
        OutputFormat = 'csv'
        ExpectedStateSha256 = $expectedStateSha256
        ExpectedStateBytes = $expectedStateBytes
      }
    } elseif ($null -eq $runResult.PSObject.Properties['ExpectedStateSha256']) {
      $runResult | Add-Member -MemberType NoteProperty -Name ExpectedStateSha256 -Value $expectedStateSha256 -Force
      $runResult | Add-Member -MemberType NoteProperty -Name ExpectedStateBytes -Value $expectedStateBytes -Force
    }
    if ($null -eq $classification) {
      $classification = Get-Wave13B2F2RunClassification `
        -ExitCode -1 `
        -ControlMarkers ([string[]]@()) `
        -StderrMarkers ([string[]]@()) `
        -ExpectedSourceSha $applicationSourceSha `
        -ExpectedQuerySha256 $queryPacketSha256 `
        -EvidenceVerified $false `
        -FailureCodes ([string[]]@($abortCode))
    } else {
      $classification.Status = 'FAILED'
      $classification.FailureCodes = [string[]]@($classification.FailureCodes + 'F2_RUNNER_ABORTED' | Select-Object -Unique)
    }
    if (-not (Test-Path -LiteralPath $auditPath)) {
      try {
        $catchAuditContent = New-Wave13B2F2AuditContent `
          -SourceSha $applicationSourceSha `
          -QuerySha256 $queryPacketSha256 `
          -RunResult $runResult `
          -Classification $classification
        $catchAuditSha256 = Write-Wave13B2F2AuditEvidence -Path $auditPath -Content $catchAuditContent -AclCheckerPath $aclCheckerPath
      } catch { $catchAuditSha256 = 'unavailable' }
    } else {
      $catchAuditSha256 = 'unavailable'
    }
    Add-Wave13B2F2AttemptResult `
      -MarkerPath $attemptMarkerPath `
      -RunResult $runResult `
      -Classification $classification `
      -AuditFileName $(if (Test-Path -LiteralPath $auditPath) { [IO.Path]::GetFileName($auditPath) } else { 'unavailable' }) `
      -AuditSha256 $(if ($catchAuditSha256 -ne 'unavailable') { $catchAuditSha256 } elseif (Test-Path -LiteralPath $auditPath) { Get-Wave13B2F2QuerySha256 -Bytes ([IO.File]::ReadAllBytes($auditPath)) } else { 'unavailable' })
    $markerFinalized = $true
  }
  throw
} finally {
  if ($null -ne $queryLock) { $queryLock.Dispose() }
  foreach ($name in $boundEnvironmentNames) {
    $oldValue = $previousEnvironment[$name]
    if ($null -eq $oldValue) {
      Remove-Item -LiteralPath ('Env:' + $name) -ErrorAction SilentlyContinue
    } else {
      Set-Item -Path ('Env:' + $name) -Value $oldValue
    }
  }
  if ($hasNativeErrorPreference) {
    Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $previousNativeErrorPreference
  }
}
