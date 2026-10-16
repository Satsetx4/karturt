[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-f0-9]{64}$')]
  [string]$TrustedPublicKeyFingerprint
)

$ErrorActionPreference = 'Stop'

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
  if ($preflightText) { Write-Output $preflightText }
  Require-Condition ($preflightExitCode -eq 0 -and $preflightText -match ('^LOCAL_OFFLINE_PREFLIGHT_PASS source=' + $applicationSourceSha + ' .* query=' + $queryPacketSha256 + '$')) 'Offline preflight did not pass for the exact source and query; no SQL was run.'
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
  'PGCHANNELBINDING', 'PGPASSFILE', 'PGSSLROOTCERT'
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
}

$queryPacketSha256 = 'dc3c798b01de7163e26fe3aad0c574e9f1e9c248ef2555bd61ab822e116e3689'
$queryPath = Join-Path $repoRoot 'docs/codex/wave13b2-read-only-catalog-preflight.sql'
$querySnapshotPath = Join-Path $secretDir ('wave13b2-read-only-catalog-preflight-' + $queryPacketSha256 + '.sql')
$queryLock = $null
$preflightPath = Join-Path $repoRoot 'scripts/preflight-wave13b2-local.mjs'
$aclCheckerPath = Join-Path $repoRoot 'scripts/check-wave13b2-secret-acl.ps1'
$psqlExitCode = 1
$attemptStartedAt = [DateTime]::UtcNow.ToString('o')
$markerCreated = $false
$markerFinalized = $false
$previousNativeErrorPreference = $null
$hasNativeErrorPreference = $false

try {
  foreach ($name in $boundEnvironmentNames) {
    Set-Item -Path ('Env:' + $name) -Value $environmentValues[$name]
  }

  Invoke-OfflinePreflight

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

  Invoke-OfflinePreflight

  $markerText = @(
    'status=STARTED'
    'startedAtUtc=' + $attemptStartedAt
    'sourceSha=' + $applicationSourceSha
    'queryPacketSha256=' + $queryPacketSha256
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

  $preference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
  if ($null -ne $preference) {
    $previousNativeErrorPreference = $preference.Value
    $hasNativeErrorPreference = $true
    Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $false
  }

  $psqlArgs = @(
    '-X', '-w', '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1',
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
  & $psqlExecutable @psqlArgs
  $psqlExitCode = $LASTEXITCODE
  $finalStatus = if ($psqlExitCode -eq 0) { 'COMPLETED' } else { 'FAILED' }
  [IO.File]::AppendAllText($attemptMarkerPath, ('status=' + $finalStatus + "`n" + 'finishedAtUtc=' + [DateTime]::UtcNow.ToString('o') + "`n" + 'psqlExitCode=' + $psqlExitCode + "`n"), [Text.UTF8Encoding]::new($false))
  $markerFinalized = $true
  Require-Condition ($psqlExitCode -eq 0) 'The read-only query failed; preserve the new attempt marker and stop.'
} catch {
  if ($markerCreated -and -not $markerFinalized) {
    [IO.File]::AppendAllText($attemptMarkerPath, ('status=FAILED' + "`n" + 'finishedAtUtc=' + [DateTime]::UtcNow.ToString('o') + "`n" + 'psqlExitCode=' + $psqlExitCode + "`n"), [Text.UTF8Encoding]::new($false))
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
