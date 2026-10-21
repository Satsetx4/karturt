[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProviderEvidencePath,

  [Parameter(Mandatory = $true)]
  [string]$EvidenceOutputPath,

  [ValidateRange(5, 120)]
  [int]$TimeoutSeconds = 35
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:FailureEvidenceEnabled = $false
$script:SuccessEvidenceWritten = $false
$script:FailureEvidencePath = ''
$script:ObservedPsqlExitCode = $null
$script:ObservedPsqlVersion = $null
$script:QuerySha256 = $null
$script:ProviderPreflightStatus = 'UNKNOWN'
$script:StagingIsolationPreflightStatus = 'UNKNOWN'
$script:ProviderCaptureAuthenticationStatus = 'UNKNOWN'

function Stop-Safely([string]$Code, [int]$ExitCode = 1) {
  $safeCode = $Code
  if ($safeCode -cnotmatch '^[A-Z0-9_]{1,64}$') { $safeCode = 'UNEXPECTED_FAILURE' }

  if ($script:FailureEvidenceEnabled -and -not $script:SuccessEvidenceWritten) {
    $sourceForEvidence = $null
    $sourceVariable = Get-Variable -Name 'sourceSha' -Scope Script -ErrorAction SilentlyContinue
    if ($null -ne $sourceVariable -and [string]$sourceVariable.Value -cmatch '^[a-f0-9]{40,64}$') {
      $sourceForEvidence = [string]$sourceVariable.Value
    }
    $providerHashForEvidence = $null
    $providerHashVariable = Get-Variable -Name 'providerFileSha256' -Scope Script -ErrorAction SilentlyContinue
    if ($null -ne $providerHashVariable -and [string]$providerHashVariable.Value -cmatch '^[a-f0-9]{64}$') {
      $providerHashForEvidence = [string]$providerHashVariable.Value
    }
    $startedForEvidence = $null
    $startedVariable = Get-Variable -Name 'AttemptStartedAtUtc' -Scope Script -ErrorAction SilentlyContinue
    if ($null -ne $startedVariable -and [string]$startedVariable.Value -cmatch '^\d{4}-\d{2}-\d{2}T') {
      $startedForEvidence = [string]$startedVariable.Value
    }
    $stoppedForEvidence = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", [Globalization.CultureInfo]::InvariantCulture)
    $failureArtifact = [ordered]@{
      schemaVersion = 'staging-readiness-gate-v1/database-probe-failure/v1'
      result = 'DATABASE_PROBE_STOPPED'
      status = 'STOPPED'
      stopCode = $safeCode
      sourceSha = $sourceForEvidence
      providerEvidenceSha256 = $providerHashForEvidence
      querySha256 = $script:QuerySha256
      psqlVersion = $script:ObservedPsqlVersion
      psqlExitCode = $script:ObservedPsqlExitCode
      startedAtUtc = $startedForEvidence
      stoppedAtUtc = $stoppedForEvidence
      providerMetadata = 'NOT_INCLUDED'
      providerCaptureAuthentication = $script:ProviderCaptureAuthenticationStatus
      providerPreflight = $script:ProviderPreflightStatus
      stagingIsolation = $script:StagingIsolationPreflightStatus
      overallGate = 'NOT_EVALUATED'
      migrationAuthorization = 'NOT_GRANTED'
      databaseProbe = [ordered]@{
        status = 'STOPPED'
        stopCode = $safeCode
      }
    }
    $failureStream = $null
    try {
      $failureJson = ConvertTo-Json -InputObject $failureArtifact -Depth 6 -Compress -ErrorAction Stop
      $failureBytes = [Text.UTF8Encoding]::new($false).GetBytes($failureJson + [Environment]::NewLine)
      if ($failureBytes.Length -gt 16384) { throw 'FAILURE_EVIDENCE_INVALID' }
      $failurePath = $script:FailureEvidencePath
      for ($attempt = 0; $attempt -lt 2; $attempt++) {
        try {
          $failureStream = [IO.File]::Open($failurePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
          $failureStream.Write($failureBytes, 0, $failureBytes.Length)
          $failureStream.Flush($true)
          break
        } catch {
          if ($null -ne $failureStream) { $failureStream.Dispose(); $failureStream = $null }
          if ($attempt -eq 1) { throw }
          $directory = [IO.Path]::GetDirectoryName($script:FailureEvidencePath)
          $basename = [IO.Path]::GetFileNameWithoutExtension($script:FailureEvidencePath)
          $failurePath = [IO.Path]::Combine($directory, $basename + '.failure.' + [Guid]::NewGuid().ToString('N') + '.json')
        } finally {
          if ($null -ne $failureStream) { $failureStream.Dispose(); $failureStream = $null }
        }
      }
    } catch {
      # Preserve the stable stop code; never surface filesystem or runtime details.
    }
  }

  [Console]::Error.WriteLine('Staging Readiness Gate V1 stopped: ' + $safeCode)
  exit $ExitCode
}

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Stop-Safely 'POWERSHELL_7_REQUIRED' 78
}

$script:ExpectedTarget = [ordered]@{
  OrganizationId = 'org-ancient-boat-57106549'
  ProjectId = 'broad-star-40451875'
  BranchId = 'br-orange-recipe-azed9f78'
  EndpointId = 'ep-mute-firefly-azjcru4h'
  DirectHostname = 'ep-mute-firefly-azjcru4h.c-3.ap-southeast-1.aws.neon.tech'
  Port = '5432'
  Database = 'neondb'
  Role = 'neondb_owner'
  PostgresMajor = 18
  ApplicationName = 'karturt-staging-readiness-gate-v1'
}

function Get-RequiredFilePath([string]$EnvironmentName) {
  $value = [Environment]::GetEnvironmentVariable($EnvironmentName, 'Process')
  if ([string]::IsNullOrWhiteSpace($value) -or -not [IO.Path]::IsPathRooted($value)) {
    throw 'REQUIRED_TLS_FILE_MISSING'
  }

  $fullPath = [IO.Path]::GetFullPath($value)
  if (-not [IO.File]::Exists($fullPath)) {
    throw 'REQUIRED_TLS_FILE_MISSING'
  }

  $attributes = [IO.File]::GetAttributes($fullPath)
  if (($attributes -band [IO.FileAttributes]::Directory) -ne 0 -or
      ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'REQUIRED_TLS_FILE_UNSAFE'
  }

  return $fullPath
}

function Get-JsonPropertyValue($Object, [string]$Name) {
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { throw 'UNEXPECTED_RESULT_SHAPE' }
  return $property.Value
}

function Assert-ExactProperties($Object, [string[]]$Names) {
  $actualNames = @($Object.PSObject.Properties.Name | Sort-Object)
  $expectedNames = @($Names | Sort-Object)
  if ($actualNames.Count -ne $expectedNames.Count) { throw 'UNEXPECTED_RESULT_SHAPE' }
  for ($index = 0; $index -lt $expectedNames.Count; $index++) {
    if ($actualNames[$index] -cne $expectedNames[$index]) { throw 'UNEXPECTED_RESULT_SHAPE' }
  }
}

function Assert-NonNegativeInteger($Value) {
  if ($null -eq $Value -or $Value -is [bool]) { throw 'UNEXPECTED_RESULT_SHAPE' }
  try {
    $number = [long]$Value
  } catch {
    throw 'UNEXPECTED_RESULT_SHAPE'
  }
  if ($number -lt 0) { throw 'UNEXPECTED_RESULT_SHAPE' }
  return $number
}

function Get-JsonField($Object, [string]$Name, [string]$MissingCode = 'PROVIDER_EVIDENCE_INCOMPLETE') {
  if ($null -eq $Object) { throw $MissingCode }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { throw $MissingCode }
  return $property.Value
}

function Assert-Reference([string]$Value, [string]$Code = 'PROVIDER_EVIDENCE_INCOMPLETE') {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt 1024 -or
      $Value -ne $Value.Trim() -or $Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]{0,1023}$' -or
      $Value -match '(^|/)\.{1,2}(/|$)' -or $Value -match '[\x00-\x1F\x7F]') {
    throw $Code
  }
  return $Value
}

function Assert-SafeText([string]$Value, [string]$Code = 'PROVIDER_EVIDENCE_INCOMPLETE') {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt 1024 -or
      $Value -ne $Value.Trim() -or $Value -match '[\x00-\x1F\x7F]') {
    throw $Code
  }
  return $Value
}

function Assert-Sha256([string]$Value, [string]$Code = 'PROVIDER_EVIDENCE_INCOMPLETE') {
  if ($Value -cnotmatch '^[a-f0-9]{64}$') { throw $Code }
  return $Value
}

function Assert-TrueBoolean($Value, [string]$Code = 'PROVIDER_EVIDENCE_INCOMPLETE') {
  if ($Value -isnot [bool] -or -not $Value) { throw $Code }
}

function Assert-ExactNumber($Value, [double]$Expected, [string]$Code = 'PROVIDER_EVIDENCE_INCOMPLETE') {
  if ($null -eq $Value -or $Value -isnot [ValueType] -or $Value -is [bool]) { throw $Code }
  try { $actual = [double]$Value } catch { throw $Code }
  if ([double]::IsNaN($actual) -or [double]::IsInfinity($actual) -or $actual -ne $Expected) { throw $Code }
}

function ConvertTo-UtcTimestamp([string]$Value, [string]$Code) {
  if ([string]::IsNullOrWhiteSpace($Value) -or
      $Value -cnotmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$') {
    throw $Code
  }
  try {
    return [DateTimeOffset]::Parse(
      $Value,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::AssumeUniversal
    ).ToUniversalTime()
  } catch {
    throw $Code
  }
}

function Assert-FreshTimestamp([string]$Value, [string]$Code) {
  $observedAt = ConvertTo-UtcTimestamp -Value $Value -Code $Code
  $age = [DateTimeOffset]::UtcNow - $observedAt
  if ($age.TotalMilliseconds -lt 0 -or $age.TotalSeconds -gt 120) { throw $Code }
  return $observedAt
}

function Read-SanitizedJsonEvidence([string]$Path, [string]$Code) {
  $stream = $null
  try {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if ($stream.Length -lt 2 -or $stream.Length -gt 131072) { throw $Code }
    $bytes = [byte[]]::new([int]$stream.Length)
    $read = 0
    while ($read -lt $bytes.Length) {
      $chunk = $stream.Read($bytes, $read, $bytes.Length - $read)
      if ($chunk -le 0) { throw $Code }
      $read += $chunk
    }
  } catch {
    if ($_.Exception.Message -ceq $Code) { throw }
    throw $Code
  } finally {
    if ($null -ne $stream) { $stream.Dispose() }
  }

  try {
    $encoding = [Text.UTF8Encoding]::new($false, $true)
    $text = $encoding.GetString($bytes)
    $value = ConvertFrom-Json -InputObject $text -ErrorAction Stop
    if ($null -eq $value -or $value -is [array]) { throw $Code }
  } catch {
    throw $Code
  }

  $hasher = [Security.Cryptography.SHA256]::Create()
  try { $sha = ([BitConverter]::ToString($hasher.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
  finally { $hasher.Dispose() }
  return [pscustomobject]@{ Value = $value; Sha256 = $sha }
}

function Read-VerifiedEvidenceArtifact(
  [string]$EvidenceRoot,
  [string]$Reference,
  [string]$ExpectedSha256,
  [string]$ExpectedArtifactType,
  [string]$SourceSha,
  [string]$Code = 'PROVIDER_REFERENCED_ARTIFACT_INVALID'
) {
  [void](Assert-Reference -Value $Reference -Code $Code)
  [void](Assert-Sha256 -Value $ExpectedSha256 -Code $Code)
  $rootPath = [IO.Path]::GetFullPath($EvidenceRoot).TrimEnd([char[]]@('\', '/'))
  if (-not [IO.Directory]::Exists($rootPath)) { throw $Code }
  $rootAttributes = [IO.File]::GetAttributes($rootPath)
  if (($rootAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw $Code }
  $artifactPath = [IO.Path]::GetFullPath((Join-Path $rootPath $Reference))
  $rootPrefix = $rootPath + [IO.Path]::DirectorySeparatorChar
  if (-not $artifactPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw $Code }

  $currentPath = $artifactPath
  while ($currentPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    if (-not [IO.File]::Exists($currentPath) -and -not [IO.Directory]::Exists($currentPath)) { throw $Code }
    $attributes = [IO.File]::GetAttributes($currentPath)
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw $Code }
    if ([string]::Equals($currentPath, $rootPath, [StringComparison]::OrdinalIgnoreCase)) { break }
    $currentPath = [IO.Path]::GetDirectoryName($currentPath)
  }
  if (-not [IO.File]::Exists($artifactPath) -or [IO.Directory]::Exists($artifactPath)) { throw $Code }

  $document = Read-SanitizedJsonEvidence -Path $artifactPath -Code $Code
  if ($document.Sha256 -cne $ExpectedSha256) { throw 'PROVIDER_REFERENCED_ARTIFACT_HASH_MISMATCH' }
  $artifact = $document.Value
  if ((Get-JsonField -Object $artifact -Name 'schemaVersion' -MissingCode $Code) -cne 'staging-readiness-gate-v1/evidence-artifact/v1' -or
      (Get-JsonField -Object $artifact -Name 'artifactType' -MissingCode $Code) -cne $ExpectedArtifactType -or
      (Get-JsonField -Object $artifact -Name 'sourceSha' -MissingCode $Code) -cne $SourceSha) {
    throw $Code
  }
  return $artifact
}

function Assert-ArtifactTarget($Artifact, [string]$ProjectId, [string]$BranchId, [string]$Code) {
  if ((Get-JsonField -Object $Artifact -Name 'targetProjectId' -MissingCode $Code) -cne $ProjectId -or
      (Get-JsonField -Object $Artifact -Name 'targetBranchId' -MissingCode $Code) -cne $BranchId) {
    throw $Code
  }
}

function Assert-EvidenceArrayContainsAll($Value, [string[]]$Expected, [string]$Code) {
  if ($Value -isnot [array]) { throw $Code }
  foreach ($item in $Expected) {
    if ($Value -cnotcontains $item) { throw $Code }
  }
}

function Get-FileSha256([string]$Path) {
  $stream = $null
  $hasher = $null
  try {
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    $hasher = [Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } catch {
    throw 'QUERY_HASH_UNAVAILABLE'
  } finally {
    if ($null -ne $hasher) { $hasher.Dispose() }
    if ($null -ne $stream) { $stream.Dispose() }
  }
}

function Invoke-LocalCapture([string]$Executable, [string[]]$Arguments, [int]$TimeoutMilliseconds) {
  $child = [Diagnostics.Process]::new()
  try {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $info.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    foreach ($argument in $Arguments) { [void]$info.ArgumentList.Add([string]$argument) }
    foreach ($name in @($info.Environment.Keys | Where-Object { [string]$_ -match '^(PG|GIT_)' })) {
      [void]$info.Environment.Remove([string]$name)
    }
    $info.Environment['GIT_OPTIONAL_LOCKS'] = '0'
    $info.Environment['GIT_TERMINAL_PROMPT'] = '0'

    $child.StartInfo = $info
    if (-not $child.Start()) { throw 'LOCAL_CAPTURE_START_FAILED' }
    $stdoutTask = $child.StandardOutput.ReadToEndAsync()
    $stderrTask = $child.StandardError.ReadToEndAsync()
    if (-not $child.WaitForExit($TimeoutMilliseconds)) {
      try { $child.Kill($true) } catch { }
      [void]$child.WaitForExit(5000)
      throw 'LOCAL_CAPTURE_TIMEOUT'
    }
    $captured = [Threading.Tasks.Task]::WaitAll(
      [Threading.Tasks.Task[]]@($stdoutTask, $stderrTask),
      5000
    )
    if (-not $captured -or -not $stdoutTask.IsCompletedSuccessfully -or -not $stderrTask.IsCompletedSuccessfully) {
      throw 'LOCAL_CAPTURE_INCOMPLETE'
    }
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($stdout.Length -gt 4096 -or $stderr.Length -gt 4096) { throw 'LOCAL_CAPTURE_INVALID' }
    return [pscustomobject]@{ ExitCode = $child.ExitCode; Stdout = $stdout.Trim(); Stderr = $stderr.Trim() }
  } finally {
    try { if (-not $child.HasExited) { $child.Kill($true) } } catch { }
    $child.Dispose()
  }
}

function Get-PsqlVersion([string]$Executable) {
  $capture = Invoke-LocalCapture -Executable $Executable -Arguments @('--version') -TimeoutMilliseconds 5000
  if ($capture.ExitCode -ne 0 -or $capture.Stderr.Length -gt 0) { throw 'PSQL_VERSION_UNAVAILABLE' }
  $version = [regex]::Match($capture.Stdout, '^psql \(PostgreSQL\) (?<version>\d+(?:\.\d+){1,2}(?:[-+][A-Za-z0-9.]+)?)$')
  if (-not $version.Success -or $version.Groups['version'].Value.Split('.')[0] -cne '18') {
    throw 'PSQL_VERSION_UNEXPECTED'
  }
  return 'psql (PostgreSQL) ' + $version.Groups['version'].Value
}

function Get-ValidatedSourceSha([string]$Root, [string]$GitExecutable) {
  $rootResult = Invoke-LocalCapture -Executable $GitExecutable -Arguments @('-C', $Root, 'rev-parse', '--show-toplevel') -TimeoutMilliseconds 5000
  if ($rootResult.ExitCode -ne 0 -or $rootResult.Stderr.Length -gt 0) { throw 'SOURCE_GIT_VALIDATION_FAILED' }
  $reportedRoot = [IO.Path]::GetFullPath($rootResult.Stdout).TrimEnd([char[]]@('\', '/'))
  $expectedRoot = [IO.Path]::GetFullPath($Root).TrimEnd([char[]]@('\', '/'))
  if (-not [string]::Equals($reportedRoot, $expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'SOURCE_GIT_ROOT_MISMATCH'
  }

  $shaResult = Invoke-LocalCapture -Executable $GitExecutable -Arguments @('-C', $Root, 'rev-parse', '--verify', 'HEAD^{commit}') -TimeoutMilliseconds 5000
  if ($shaResult.ExitCode -ne 0 -or $shaResult.Stderr.Length -gt 0 -or
      $shaResult.Stdout -cnotmatch '^[a-f0-9]{40,64}$') {
    throw 'SOURCE_SHA_UNAVAILABLE'
  }

  foreach ($relativePath in @('scripts/staging-readiness-gate-v1.ps1', 'docs/codex/staging-readiness-gate-v1.sql')) {
    $tracked = Invoke-LocalCapture -Executable $GitExecutable -Arguments @('-C', $Root, 'ls-files', '--error-unmatch', '--', $relativePath) -TimeoutMilliseconds 5000
    if ($tracked.ExitCode -ne 0 -or $tracked.Stdout -cne $relativePath -or $tracked.Stderr.Length -gt 0) {
      throw 'SOURCE_NOT_TRACKED_AT_HEAD'
    }
  }
  $diff = Invoke-LocalCapture -Executable $GitExecutable -Arguments @('-C', $Root, 'diff', '--quiet', 'HEAD', '--', 'scripts/staging-readiness-gate-v1.ps1', 'docs/codex/staging-readiness-gate-v1.sql') -TimeoutMilliseconds 5000
  if ($diff.ExitCode -ne 0 -or $diff.Stdout.Length -gt 0 -or $diff.Stderr.Length -gt 0) {
    throw 'SOURCE_NOT_EXACT_HEAD'
  }
  return $shaResult.Stdout
}

function Assert-ProviderEvidence($Evidence, [string]$SourceSha, [string]$ProviderPath, [string]$ProviderSha256) {
  if ((Get-JsonField -Object $Evidence -Name 'schemaVersion') -cne 'staging-readiness-gate-v1/evidence-artifact/v1' -or
      (Get-JsonField -Object $Evidence -Name 'artifactType') -cne 'provider-metadata' -or
      (Get-JsonField -Object $Evidence -Name 'sourceSha') -cne $SourceSha) {
    throw 'PROVIDER_EVIDENCE_INVALID'
  }
  $provider = Get-JsonField -Object $Evidence -Name 'provider'
  $isolation = Get-JsonField -Object $Evidence -Name 'stagingIsolation'
  $lineage = Get-JsonField -Object $isolation -Name 'lineage'
  $syntheticOnly = Get-JsonField -Object $isolation -Name 'syntheticOnly'
  $branch = Get-JsonField -Object $provider -Name 'branch'

  if ((Get-JsonField -Object $Evidence -Name 'sourceSha') -cne $SourceSha -or
      (Get-JsonField -Object $syntheticOnly -Name 'sourceSha') -cne $SourceSha) {
    throw 'PROVIDER_SOURCE_SHA_MISMATCH'
  }
  [void](Assert-FreshTimestamp -Value (Get-JsonField -Object $provider -Name 'observedAtUtc') -Code 'PROVIDER_EVIDENCE_STALE')
  [void](Assert-FreshTimestamp -Value (Get-JsonField -Object $isolation -Name 'observedAtUtc') -Code 'PROVIDER_EVIDENCE_STALE')

  foreach ($field in @(
    @{ Name = 'provider'; Expected = 'neon' },
    @{ Name = 'organizationId'; Expected = $script:ExpectedTarget.OrganizationId },
    @{ Name = 'projectId'; Expected = $script:ExpectedTarget.ProjectId },
    @{ Name = 'branchId'; Expected = $script:ExpectedTarget.BranchId },
    @{ Name = 'endpointId'; Expected = $script:ExpectedTarget.EndpointId }
  )) {
    if ((Get-JsonField -Object $provider -Name $field.Name) -cne $field.Expected) {
      throw 'PROVIDER_TARGET_MISMATCH'
    }
  }
  $evidenceRoot = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ProviderPath))
  $providerReference = Assert-Reference -Value (Get-JsonField -Object $provider -Name 'evidenceReference')
  $providerReferencedPath = [IO.Path]::GetFullPath((Join-Path $evidenceRoot $providerReference))
  if (-not [string]::Equals($providerReferencedPath, [IO.Path]::GetFullPath($ProviderPath), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'PROVIDER_EVIDENCE_REFERENCE_MISMATCH'
  }
  [void](Read-VerifiedEvidenceArtifact -EvidenceRoot $evidenceRoot -Reference $providerReference `
    -ExpectedSha256 $ProviderSha256 -ExpectedArtifactType 'provider-metadata' -SourceSha $SourceSha)
  if ((Get-JsonField -Object $provider -Name 'plan') -cne 'free') { throw 'PROVIDER_PLAN_NOT_FREE' }
  Assert-ExactNumber -Value (Get-JsonField -Object $provider -Name 'postgresMajor') -Expected 18 -Code 'PROVIDER_POSTGRES_MAJOR_MISMATCH'
  Assert-ExactNumber -Value (Get-JsonField -Object $provider -Name 'computeMinCU') -Expected 0.25 -Code 'PROVIDER_COMPUTE_SCOPE_MISMATCH'
  Assert-ExactNumber -Value (Get-JsonField -Object $provider -Name 'computeMaxCU') -Expected 0.25 -Code 'PROVIDER_COMPUTE_SCOPE_MISMATCH'

  if ((Get-JsonField -Object $branch -Name 'state') -cne 'ready') { throw 'PROVIDER_BRANCH_NOT_READY' }
  Assert-TrueBoolean -Value (Get-JsonField -Object $branch -Name 'primary') -Code 'PROVIDER_BRANCH_ROLE_MISMATCH'
  Assert-TrueBoolean -Value (Get-JsonField -Object $branch -Name 'default') -Code 'PROVIDER_BRANCH_ROLE_MISMATCH'
  $branchParentId = $branch.PSObject.Properties['parent_id']
  if ($null -eq $branchParentId) { throw 'PROVIDER_PARENT_ID_UNKNOWN' }
  if ($null -ne $branchParentId.Value) { throw 'PROVIDER_PARENT_ID_NOT_NULL' }
  $providerInitSource = Get-JsonField -Object $branch -Name 'init_source' -MissingCode 'PROVIDER_INIT_SOURCE_UNKNOWN'

  foreach ($field in @(
    @{ Name = 'targetProjectId'; Expected = $script:ExpectedTarget.ProjectId },
    @{ Name = 'targetBranchId'; Expected = $script:ExpectedTarget.BranchId }
  )) {
    if ((Get-JsonField -Object $isolation -Name $field.Name) -cne $field.Expected) {
      throw 'PROVIDER_LINEAGE_TARGET_MISMATCH'
    }
  }
  if ((Get-JsonField -Object $lineage -Name 'sourceSha') -cne $SourceSha -or
      (Get-JsonField -Object $lineage -Name 'verificationSource') -cne 'provider-api-create-request-and-readback' -or
      (Get-JsonField -Object $lineage -Name 'verificationStatus') -cne 'VERIFIED' -or
      (Get-JsonField -Object $lineage -Name 'createRequestMethod') -cne 'POST' -or
      (Get-JsonField -Object $lineage -Name 'createRequestOperation') -cne 'create-project') {
    throw 'PROVIDER_LINEAGE_UNVERIFIED'
  }
  $evidenceRoot = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ProviderPath))
  $createRequestArtifact = Read-VerifiedEvidenceArtifact -EvidenceRoot $evidenceRoot `
    -Reference (Get-JsonField -Object $lineage -Name 'createRequestReference') `
    -ExpectedSha256 (Get-JsonField -Object $lineage -Name 'createRequestSha256') `
    -ExpectedArtifactType 'lineage-create-request' -SourceSha $SourceSha -Code 'PROVIDER_LINEAGE_ARTIFACT_INVALID'
  $providerReadbackArtifact = Read-VerifiedEvidenceArtifact -EvidenceRoot $evidenceRoot `
    -Reference (Get-JsonField -Object $lineage -Name 'providerReadbackReference') `
    -ExpectedSha256 (Get-JsonField -Object $lineage -Name 'providerReadbackSha256') `
    -ExpectedArtifactType 'provider-lineage-readback' -SourceSha $SourceSha -Code 'PROVIDER_LINEAGE_ARTIFACT_INVALID'
  Assert-ArtifactTarget -Artifact $createRequestArtifact -ProjectId $script:ExpectedTarget.ProjectId `
    -BranchId $script:ExpectedTarget.BranchId -Code 'PROVIDER_LINEAGE_ARTIFACT_MISMATCH'
  Assert-ArtifactTarget -Artifact $providerReadbackArtifact -ProjectId $script:ExpectedTarget.ProjectId `
    -BranchId $script:ExpectedTarget.BranchId -Code 'PROVIDER_LINEAGE_ARTIFACT_MISMATCH'
  if ((Get-JsonField -Object $createRequestArtifact -Name 'method') -cne 'POST' -or
      (Get-JsonField -Object $createRequestArtifact -Name 'operation') -cne 'create-project' -or
      (Get-JsonField -Object $createRequestArtifact -Name 'method') -cne (Get-JsonField -Object $lineage -Name 'createRequestMethod') -or
      (Get-JsonField -Object $createRequestArtifact -Name 'operation') -cne (Get-JsonField -Object $lineage -Name 'createRequestOperation')) {
    throw 'PROVIDER_LINEAGE_ARTIFACT_MISMATCH'
  }
  $omittedSourceFields = @(Get-JsonField -Object $lineage -Name 'sourceFieldsOmitted')
  foreach ($requiredField in @('parent_id', 'parent_project_id', 'source_project_id', 'clone', 'import', 'restore')) {
    if ($omittedSourceFields -cnotcontains $requiredField) { throw 'PROVIDER_LINEAGE_UNVERIFIED' }
  }
  $requestOmittedFields = Get-JsonField -Object $createRequestArtifact -Name 'sourceFieldsOmitted' -MissingCode 'PROVIDER_LINEAGE_ARTIFACT_INVALID'
  Assert-EvidenceArrayContainsAll -Value $requestOmittedFields `
    -Expected @('parent_id', 'parent_project_id', 'source_project_id', 'clone', 'import', 'restore') `
    -Code 'PROVIDER_LINEAGE_ARTIFACT_MISMATCH'
  foreach ($field in @(
    @{ Observed = 'projectParentIdFieldObserved'; Value = 'projectParentId' },
    @{ Observed = 'sourceProjectIdFieldObserved'; Value = 'sourceProjectId' },
    @{ Observed = 'branchParentIdFieldObserved'; Value = 'branchParentId' }
  )) {
    Assert-TrueBoolean -Value (Get-JsonField -Object $lineage -Name $field.Observed) -Code 'PROVIDER_LINEAGE_PARENT_UNKNOWN'
    if ($null -ne (Get-JsonField -Object $lineage -Name $field.Value)) { throw 'PROVIDER_LINEAGE_PARENT_NOT_NULL' }
    if ((Get-JsonField -Object $providerReadbackArtifact -Name $field.Observed -MissingCode 'PROVIDER_LINEAGE_ARTIFACT_INVALID') -cne $true -or
        $null -ne (Get-JsonField -Object $providerReadbackArtifact -Name $field.Value -MissingCode 'PROVIDER_LINEAGE_ARTIFACT_INVALID')) {
      throw 'PROVIDER_LINEAGE_ARTIFACT_MISMATCH'
    }
  }
  if ((Get-JsonField -Object $providerReadbackArtifact -Name 'init_source' -MissingCode 'PROVIDER_LINEAGE_ARTIFACT_INVALID') -cne $providerInitSource) {
    throw 'PROVIDER_LINEAGE_ARTIFACT_MISMATCH'
  }

  if ($providerInitSource -ceq 'parent-data') {
    $resolution = Get-JsonField -Object $lineage -Name 'parentDataResolution' -MissingCode 'PROVIDER_INIT_SOURCE_UNRESOLVED'
    if ((Get-JsonField -Object $resolution -Name 'sourceSha') -cne $SourceSha -or
        (Get-JsonField -Object $resolution -Name 'verificationStatus') -cne 'VERIFIED') {
      throw 'PROVIDER_INIT_SOURCE_UNRESOLVED'
    }
    $resolvesToNewRoot = Get-JsonField -Object $resolution -Name 'resolvesToNewRoot'
    if ($resolvesToNewRoot -isnot [bool]) { throw 'PROVIDER_INIT_SOURCE_UNRESOLVED' }
    if (-not $resolvesToNewRoot) { throw 'PROVIDER_INIT_SOURCE_NOT_ROOT' }
    [void](Assert-SafeText -Value (Get-JsonField -Object $resolution -Name 'explanation'))
    $resolutionArtifact = Read-VerifiedEvidenceArtifact -EvidenceRoot $evidenceRoot `
      -Reference (Get-JsonField -Object $resolution -Name 'evidenceReference') `
      -ExpectedSha256 (Get-JsonField -Object $resolution -Name 'evidenceSha256') `
      -ExpectedArtifactType 'parent-data-resolution' -SourceSha $SourceSha -Code 'PROVIDER_LINEAGE_ARTIFACT_INVALID'
    Assert-ArtifactTarget -Artifact $resolutionArtifact -ProjectId $script:ExpectedTarget.ProjectId `
      -BranchId $script:ExpectedTarget.BranchId -Code 'PROVIDER_LINEAGE_ARTIFACT_MISMATCH'
    if ((Get-JsonField -Object $resolutionArtifact -Name 'verificationStatus') -cne 'VERIFIED' -or
        (Get-JsonField -Object $resolutionArtifact -Name 'resolvesToNewRoot') -isnot [bool] -or
        -not (Get-JsonField -Object $resolutionArtifact -Name 'resolvesToNewRoot')) {
      throw 'PROVIDER_INIT_SOURCE_UNRESOLVED'
    }
  } elseif ($providerInitSource -cne 'blank') {
    throw 'PROVIDER_INIT_SOURCE_UNKNOWN'
  }

  if ((Get-JsonField -Object $syntheticOnly -Name 'classification') -cne 'SYNTHETIC_ONLY') {
    throw 'SYNTHETIC_PROVENANCE_UNKNOWN'
  }
  $datasetManifestArtifact = Read-VerifiedEvidenceArtifact -EvidenceRoot $evidenceRoot `
    -Reference (Get-JsonField -Object $syntheticOnly -Name 'datasetManifestReference') `
    -ExpectedSha256 (Get-JsonField -Object $syntheticOnly -Name 'datasetManifestSha256') `
    -ExpectedArtifactType 'synthetic-dataset-manifest' -SourceSha $SourceSha -Code 'SYNTHETIC_ARTIFACT_INVALID'
  $attestationArtifact = Read-VerifiedEvidenceArtifact -EvidenceRoot $evidenceRoot `
    -Reference (Get-JsonField -Object $syntheticOnly -Name 'attestationReference') `
    -ExpectedSha256 (Get-JsonField -Object $syntheticOnly -Name 'attestationSha256') `
    -ExpectedArtifactType 'synthetic-only-attestation' -SourceSha $SourceSha -Code 'SYNTHETIC_ARTIFACT_INVALID'
  foreach ($artifact in @($datasetManifestArtifact, $attestationArtifact)) {
    Assert-ArtifactTarget -Artifact $artifact -ProjectId $script:ExpectedTarget.ProjectId `
      -BranchId $script:ExpectedTarget.BranchId -Code 'SYNTHETIC_ARTIFACT_MISMATCH'
    if ((Get-JsonField -Object $artifact -Name 'classification') -cne 'SYNTHETIC_ONLY' -or
        (Get-JsonField -Object $artifact -Name 'noProductionData') -isnot [bool] -or
        -not (Get-JsonField -Object $artifact -Name 'noProductionData')) {
      throw 'SYNTHETIC_ARTIFACT_MISMATCH'
    }
  }
  Assert-TrueBoolean -Value (Get-JsonField -Object $syntheticOnly -Name 'noProductionData') -Code 'SYNTHETIC_PROVENANCE_UNKNOWN'

  return [pscustomobject]@{
    Provider = $provider
    Isolation = $isolation
    Lineage = $lineage
    SyntheticOnly = $syntheticOnly
    InitSource = $providerInitSource
  }
}

$script:AttemptStartedAtUtc = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", [Globalization.CultureInfo]::InvariantCulture)
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$queryPath = [IO.Path]::GetFullPath((Join-Path $projectRoot 'docs/codex/staging-readiness-gate-v1.sql'))
$psqlPath = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$providerPath = ''
$evidencePath = ''
$sourceSha = ''
$providerFileSha256 = ''
$providerEvidenceState = $null

try {
  if ([string]::IsNullOrWhiteSpace($EvidenceOutputPath) -or -not [IO.Path]::IsPathRooted($EvidenceOutputPath)) {
    Stop-Safely 'EVIDENCE_OUTPUT_PATH_INVALID'
  }
  $evidencePath = [IO.Path]::GetFullPath($EvidenceOutputPath)
  if ([IO.Path]::GetExtension($evidencePath) -cne '.json' -or
      [IO.File]::Exists($evidencePath) -or [IO.Directory]::Exists($evidencePath)) {
    Stop-Safely 'EVIDENCE_OUTPUT_PATH_EXISTS_OR_INVALID'
  }
  $evidenceDirectory = [IO.Path]::GetDirectoryName($evidencePath)
  if ([string]::IsNullOrWhiteSpace($evidenceDirectory) -or -not [IO.Directory]::Exists($evidenceDirectory)) {
    Stop-Safely 'EVIDENCE_OUTPUT_DIRECTORY_MISSING'
  }
  $evidenceDirectoryAttributes = [IO.File]::GetAttributes($evidenceDirectory)
  if (($evidenceDirectoryAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Stop-Safely 'EVIDENCE_OUTPUT_DIRECTORY_UNSAFE'
  }
  $script:FailureEvidencePath = $evidencePath
  $script:FailureEvidenceEnabled = $true

  if ([string]::IsNullOrWhiteSpace($ProviderEvidencePath) -or -not [IO.Path]::IsPathRooted($ProviderEvidencePath)) {
    Stop-Safely 'PROVIDER_EVIDENCE_PATH_INVALID'
  }
  $providerPath = [IO.Path]::GetFullPath($ProviderEvidencePath)
  if (-not [IO.File]::Exists($providerPath)) { Stop-Safely 'PROVIDER_EVIDENCE_MISSING' }
  if (-not [string]::Equals(
      [IO.Path]::GetDirectoryName($providerPath),
      [IO.Path]::GetDirectoryName($evidencePath),
      [StringComparison]::OrdinalIgnoreCase
    )) {
    Stop-Safely 'EVIDENCE_DIRECTORY_MISMATCH'
  }
  $providerAttributes = [IO.File]::GetAttributes($providerPath)
  if (($providerAttributes -band [IO.FileAttributes]::Directory) -ne 0 -or
      ($providerAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    Stop-Safely 'PROVIDER_EVIDENCE_PATH_UNSAFE'
  }

  try {
    $gitCommand = Get-Command 'git.exe' -CommandType Application -ErrorAction Stop
    $gitExecutable = $gitCommand.Source
  } catch {
    Stop-Safely 'SOURCE_GIT_UNAVAILABLE'
  }
  try {
    $sourceSha = Get-ValidatedSourceSha -Root $projectRoot -GitExecutable $gitExecutable
  } catch {
    $message = [string]$_.Exception.Message
    if ($message -match '^(SOURCE_GIT_VALIDATION_FAILED|SOURCE_GIT_ROOT_MISMATCH|SOURCE_SHA_UNAVAILABLE|SOURCE_NOT_TRACKED_AT_HEAD|SOURCE_NOT_EXACT_HEAD)$') {
      Stop-Safely $message
    }
    Stop-Safely 'SOURCE_GIT_VALIDATION_FAILED'
  }

  try {
    $providerEvidenceDocument = Read-SanitizedJsonEvidence -Path $providerPath -Code 'PROVIDER_EVIDENCE_INVALID'
    $providerFileSha256 = $providerEvidenceDocument.Sha256
    $script:ProviderPreflightStatus = 'UNKNOWN'
    $script:StagingIsolationPreflightStatus = 'UNKNOWN'
    $script:ProviderCaptureAuthenticationStatus = 'UNKNOWN'
    Stop-Safely 'PROVIDER_CAPTURE_UNAUTHENTICATED'
    $providerEvidenceState = Assert-ProviderEvidence -Evidence $providerEvidenceDocument.Value -SourceSha $sourceSha `
      -ProviderPath $providerPath -ProviderSha256 $providerFileSha256
    $script:ProviderPreflightStatus = 'PASS'
    $script:StagingIsolationPreflightStatus = 'PREFLIGHT_PASS'
    $providerField = $providerEvidenceDocument.Value.PSObject.Properties['provider']
    $providerField.Value | Add-Member -NotePropertyName 'evidenceSha256' -NotePropertyValue $providerFileSha256 -Force
  } catch {
    $message = [string]$_.Exception.Message
    if ($message -match '^(PROVIDER_[A-Z0-9_]+|SYNTHETIC_[A-Z0-9_]+)$') { Stop-Safely $message }
    Stop-Safely 'PROVIDER_EVIDENCE_INVALID'
  }
} catch {
  $message = [string]$_.Exception.Message
  if ($message -match '^Staging Readiness Gate V1 stopped:') { throw }
  Stop-Safely 'PREFLIGHT_RUNTIME_ERROR'
}

$script:ExpectedTarget.ApplicationName = 'srgv1-' + [Guid]::NewGuid().ToString('N')

try {
  $passFilePath = Get-RequiredFilePath -EnvironmentName 'PGPASSFILE'
  $rootCertificatePath = Get-RequiredFilePath -EnvironmentName 'PGSSLROOTCERT'
} catch {
  $message = [string]$_.Exception.Message
  if ($message -ceq 'REQUIRED_TLS_FILE_UNSAFE') {
    Stop-Safely 'TLS_FILE_UNSAFE'
  }
  Stop-Safely 'TLS_FILE_MISSING'
}

if (-not [IO.File]::Exists($queryPath)) { Stop-Safely 'QUERY_FILE_MISSING' }
if (-not [IO.File]::Exists($psqlPath)) { Stop-Safely 'POSTGRESQL_18_PSQL_MISSING' }
try { $script:QuerySha256 = Get-FileSha256 -Path $queryPath }
catch { Stop-Safely 'QUERY_HASH_UNAVAILABLE' }

try {
  $psqlVersion = Get-PsqlVersion -Executable $psqlPath
  $script:ObservedPsqlVersion = $psqlVersion
} catch {
  $message = [string]$_.Exception.Message
  if ($message -match '^PSQL_VERSION_(UNAVAILABLE|UNEXPECTED)$') { Stop-Safely $message }
  Stop-Safely 'PSQL_VERSION_UNAVAILABLE'
}

try {
  $sourceShaBeforeConnect = Get-ValidatedSourceSha -Root $projectRoot -GitExecutable $gitExecutable
  if ($sourceShaBeforeConnect -cne $sourceSha) { Stop-Safely 'SOURCE_SHA_CHANGED' }
  if ((Get-FileSha256 -Path $queryPath) -cne $script:QuerySha256) { Stop-Safely 'QUERY_CHANGED' }
  $providerEvidenceDocument = Read-SanitizedJsonEvidence -Path $providerPath -Code 'PROVIDER_EVIDENCE_INVALID'
  if ($providerEvidenceDocument.Sha256 -cne $providerFileSha256) { Stop-Safely 'PROVIDER_EVIDENCE_CHANGED' }
  $script:ProviderPreflightStatus = 'UNKNOWN'
  $script:StagingIsolationPreflightStatus = 'UNKNOWN'
  $providerEvidenceState = Assert-ProviderEvidence -Evidence $providerEvidenceDocument.Value -SourceSha $sourceSha `
    -ProviderPath $providerPath -ProviderSha256 $providerFileSha256
  $script:ProviderPreflightStatus = 'PASS'
  $script:StagingIsolationPreflightStatus = 'PREFLIGHT_PASS'
  $providerField = $providerEvidenceDocument.Value.PSObject.Properties['provider']
  $providerField.Value | Add-Member -NotePropertyName 'evidenceSha256' -NotePropertyValue $providerFileSha256 -Force
} catch {
  $message = [string]$_.Exception.Message
  if ($message -match '^(SOURCE_[A-Z0-9_]+|PROVIDER_[A-Z0-9_]+|SYNTHETIC_[A-Z0-9_]+)$') { Stop-Safely $message }
  Stop-Safely 'PREFLIGHT_RUNTIME_ERROR'
}

$process = [Diagnostics.Process]::new()
$processStarted = $false
$timedOut = $false
$captureComplete = $false
$standardOutput = ''
$standardError = ''

try {
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $psqlPath
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
  $startInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)

  $arguments = @(
    '-X',
    '-w',
    '-q',
    '-A',
    '-t',
    '-v', 'ON_ERROR_STOP=1',
    '-h', $script:ExpectedTarget.DirectHostname,
    '-p', $script:ExpectedTarget.Port,
    '-U', $script:ExpectedTarget.Role,
    '-d', $script:ExpectedTarget.Database,
    '-f', $queryPath
  )
  foreach ($argument in $arguments) {
    [void]$startInfo.ArgumentList.Add([string]$argument)
  }

  $inheritedPostgresVariables = @($startInfo.Environment.Keys | Where-Object { [string]$_ -match '^PG' })
  foreach ($name in $inheritedPostgresVariables) {
    [void]$startInfo.Environment.Remove([string]$name)
  }

  $systemRoot = [Environment]::GetEnvironmentVariable('SystemRoot', 'Process')
  if ([string]::IsNullOrWhiteSpace($systemRoot)) { Stop-Safely 'SYSTEM_RUNTIME_UNAVAILABLE' }
  $startInfo.Environment['PATH'] = (Split-Path -Parent $psqlPath) + [IO.Path]::PathSeparator + (Join-Path $systemRoot 'System32')
  $startInfo.Environment['LC_ALL'] = 'C'
  $startInfo.Environment['LANG'] = 'C'
  $startInfo.Environment['PGAPPNAME'] = $script:ExpectedTarget.ApplicationName
  $startInfo.Environment['PGCHANNELBINDING'] = 'require'
  $startInfo.Environment['PGCLIENTENCODING'] = 'UTF8'
  $startInfo.Environment['PGCONNECT_TIMEOUT'] = '10'
  $startInfo.Environment['PGPASSFILE'] = $passFilePath
  $startInfo.Environment['PGSSLROOTCERT'] = $rootCertificatePath
  $startInfo.Environment['PGSSLMODE'] = 'verify-full'
  $startInfo.Environment['PGOPTIONS'] = '-c statement_timeout=10000 -c lock_timeout=1000 -c idle_in_transaction_session_timeout=15000'

  $process.StartInfo = $startInfo
  if (-not $process.Start()) { Stop-Safely 'PSQL_START_FAILED' }
  $processStarted = $true

  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $timedOut = $true
    try { $process.Kill($true) } catch { }
    [void]$process.WaitForExit(5000)
  }

  if ($timedOut) { Stop-Safely 'PSQL_TIMEOUT' 3 }

  $captureComplete = [Threading.Tasks.Task]::WaitAll(
    [Threading.Tasks.Task[]]@($stdoutTask, $stderrTask),
    5000
  )
  if ($stdoutTask.IsCompletedSuccessfully) {
    $standardOutput = $stdoutTask.GetAwaiter().GetResult()
  }
  if ($stderrTask.IsCompletedSuccessfully) {
    $standardError = $stderrTask.GetAwaiter().GetResult()
  }

  if (-not $captureComplete -or $standardOutput.Length -gt 65536 -or $standardError.Length -gt 65536) {
    Stop-Safely 'PSQL_OUTPUT_INVALID'
  }
  if ($process.ExitCode -ne 0) {
    $script:ObservedPsqlExitCode = [int]$process.ExitCode
    Stop-Safely 'PSQL_EXIT_NONZERO'
  }
} catch {
  $message = [string]$_.Exception.Message
  if ($message -match '^Staging Readiness Gate V1 stopped:') { throw }
  Stop-Safely 'PSQL_RUNTIME_ERROR'
} finally {
  if ($processStarted) {
    try {
      if (-not $process.HasExited) { $process.Kill($true) }
    } catch { }
  }
  $process.Dispose()
}

$lines = @([regex]::Split($standardOutput, '\r?\n') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$jsonStart = -1
for ($index = 0; $index -lt $lines.Count; $index++) {
  if ($lines[$index].TrimStart().StartsWith('{', [StringComparison]::Ordinal)) {
    $jsonStart = $index
    break
  }
}
if ($jsonStart -lt 1 -or $lines.Count -ne ($jsonStart + 2)) { Stop-Safely 'PSQL_OUTPUT_INVALID' }

$connectionInfo = $lines[0..($jsonStart - 1)] -join "`n"
$connectionFields = @{
  Database = [regex]::Match($connectionInfo, '(?im)\bdatabase\s+"(?<value>[^"]+)"')
  Role = [regex]::Match($connectionInfo, '(?im)\bas\s+user\s+"(?<value>[^"]+)"')
  Host = [regex]::Match($connectionInfo, '(?im)\bon\s+host\s+"(?<value>[^"]+)"')
  Port = [regex]::Match($connectionInfo, '(?im)\bat\s+port\s+"?(?<value>\d+)"?')
}
foreach ($field in $connectionFields.Values) {
  if (-not $field.Success) { Stop-Safely 'CONNECTION_IDENTITY_UNVERIFIED' }
}
if ($connectionFields.Database.Groups['value'].Value -cne $script:ExpectedTarget.Database -or
    $connectionFields.Role.Groups['value'].Value -cne $script:ExpectedTarget.Role -or
    $connectionFields.Host.Groups['value'].Value -cne $script:ExpectedTarget.DirectHostname -or
    $connectionFields.Port.Groups['value'].Value -cne $script:ExpectedTarget.Port) {
  Stop-Safely 'CONNECTION_IDENTITY_MISMATCH'
}

$protocolMatch = [regex]::Match($connectionInfo, '(?im)\bprotocol\b[^\r\n|:]{0,24}[:|]\s*(?<protocol>TLSv1\.(?:2|3))\b')
$cipherMatch = [regex]::Match($connectionInfo, '(?im)\bcipher\b[^\r\n|:]{0,24}[:|]\s*(?<cipher>[A-Za-z0-9][A-Za-z0-9_.-]*)\b')
if (-not $protocolMatch.Success -or -not $cipherMatch.Success) {
  Stop-Safely 'LIBPQ_TLS_PROOF_MISSING'
}

try {
  $identity = ConvertFrom-Json -InputObject $lines[$jsonStart] -ErrorAction Stop
  $catalog = ConvertFrom-Json -InputObject $lines[$jsonStart + 1] -ErrorAction Stop
  Assert-ExactProperties -Object $identity -Names @(
    'kind', 'session_id', 'backend_pid', 'database', 'current_user', 'session_user', 'server_version_num',
    'transaction_read_only', 'application_name'
  )
  Assert-ExactProperties -Object $catalog -Names @(
    'kind', 'session_id', 'backend_pid', 'non_system_schema_count', 'application_relation_count',
    'non_system_schema_names',
    'application_owned_relation_count', 'standalone_application_type_count',
    'drizzle_journal_count', 'non_system_routine_count', 'extension_count',
    'extension_names',
    'role_membership_count', 'default_acl_count', 'pg_stat_ssl_diagnostic'
  )

  if ((Get-JsonPropertyValue -Object $identity -Name 'kind') -cne 'identity' -or
      (Get-JsonPropertyValue -Object $catalog -Name 'kind') -cne 'catalog_counts') {
    throw 'UNEXPECTED_RESULT_SHAPE'
  }
  if ((Get-JsonPropertyValue -Object $identity -Name 'database') -cne $script:ExpectedTarget.Database -or
      (Get-JsonPropertyValue -Object $identity -Name 'current_user') -cne $script:ExpectedTarget.Role -or
      (Get-JsonPropertyValue -Object $identity -Name 'session_user') -cne $script:ExpectedTarget.Role -or
      (Get-JsonPropertyValue -Object $identity -Name 'transaction_read_only') -cne 'on' -or
      (Get-JsonPropertyValue -Object $identity -Name 'application_name') -cne $script:ExpectedTarget.ApplicationName -or
      (Get-JsonPropertyValue -Object $identity -Name 'session_id') -cne $script:ExpectedTarget.ApplicationName -or
      (Get-JsonPropertyValue -Object $catalog -Name 'session_id') -cne $script:ExpectedTarget.ApplicationName) {
    throw 'DATABASE_IDENTITY_MISMATCH'
  }

  $identityBackendPid = Assert-NonNegativeInteger (Get-JsonPropertyValue -Object $identity -Name 'backend_pid')
  $catalogBackendPid = Assert-NonNegativeInteger (Get-JsonPropertyValue -Object $catalog -Name 'backend_pid')
  if ($identityBackendPid -le 0 -or $identityBackendPid -ne $catalogBackendPid) {
    throw 'DATABASE_SESSION_MISMATCH'
  }

  $serverVersionNumber = Assert-NonNegativeInteger (Get-JsonPropertyValue -Object $identity -Name 'server_version_num')
  if ([Math]::Floor($serverVersionNumber / 10000) -ne $script:ExpectedTarget.PostgresMajor) {
    throw 'POSTGRES_MAJOR_MISMATCH'
  }

  $catalogCounts = [ordered]@{}
  foreach ($name in @(
    'non_system_schema_count', 'application_relation_count',
    'application_owned_relation_count', 'standalone_application_type_count',
    'drizzle_journal_count', 'non_system_routine_count', 'extension_count',
    'role_membership_count', 'default_acl_count'
  )) {
    $catalogCounts[$name] = Assert-NonNegativeInteger (Get-JsonPropertyValue -Object $catalog -Name $name)
  }

  foreach ($name in @(
    'application_relation_count', 'application_owned_relation_count',
    'standalone_application_type_count', 'drizzle_journal_count'
  )) {
    if ($catalogCounts[$name] -ne 0) { throw 'CATALOG_BASELINE_UNEXPECTED' }
  }
  $allowedCatalogCounts = @{
    non_system_schema_count = 1L
    non_system_routine_count = 0L
    extension_count = 1L
    role_membership_count = 0L
    default_acl_count = 0L
  }
  foreach ($name in $allowedCatalogCounts.Keys) {
    if ($catalogCounts[$name] -ne $allowedCatalogCounts[$name]) { throw 'CATALOG_BASELINE_UNEXPECTED' }
  }
  foreach ($arrayCheck in @(
    @{ Name = 'non_system_schema_names'; Expected = @('public') },
    @{ Name = 'extension_names'; Expected = @('plpgsql') }
  )) {
    $actualNames = @(Get-JsonPropertyValue -Object $catalog -Name $arrayCheck.Name)
    if ($actualNames.Count -ne $arrayCheck.Expected.Count) { throw 'CATALOG_BASELINE_UNEXPECTED' }
    for ($arrayIndex = 0; $arrayIndex -lt $arrayCheck.Expected.Count; $arrayIndex++) {
      if ($actualNames[$arrayIndex] -isnot [string] -or $actualNames[$arrayIndex] -cne $arrayCheck.Expected[$arrayIndex]) {
        throw 'CATALOG_BASELINE_UNEXPECTED'
      }
    }
  }

  $sslDiagnostic = Get-JsonPropertyValue -Object $catalog -Name 'pg_stat_ssl_diagnostic'
  $sslDiagnosticState = 'unknown'
  if ($null -ne $sslDiagnostic) {
    if ($null -eq $sslDiagnostic.PSObject.Properties['ssl']) { throw 'UNEXPECTED_RESULT_SHAPE' }
    if ($sslDiagnostic.ssl -is [bool]) {
      $sslDiagnosticState = if ($sslDiagnostic.ssl) { 'reported-true' } else { 'reported-false' }
    }
  }
} catch {
  $message = [string]$_.Exception.Message
  if ($message -match '^(DATABASE_IDENTITY_MISMATCH|POSTGRES_MAJOR_MISMATCH|CATALOG_BASELINE_UNEXPECTED|UNEXPECTED_RESULT_SHAPE)$') {
    Stop-Safely $message
  }
  if ($message -ceq 'DATABASE_SESSION_MISMATCH') { Stop-Safely $message }
  Stop-Safely 'PSQL_RESULT_INVALID'
}

try {
  $sourceShaAfterProbe = Get-ValidatedSourceSha -Root $projectRoot -GitExecutable $gitExecutable
  if ($sourceShaAfterProbe -cne $sourceSha) { Stop-Safely 'SOURCE_SHA_CHANGED' }
  if ((Get-FileSha256 -Path $queryPath) -cne $script:QuerySha256) { Stop-Safely 'QUERY_CHANGED' }
  $providerEvidenceDocument = Read-SanitizedJsonEvidence -Path $providerPath -Code 'PROVIDER_EVIDENCE_INVALID'
  if ($providerEvidenceDocument.Sha256 -cne $providerFileSha256) { Stop-Safely 'PROVIDER_EVIDENCE_CHANGED' }
  $script:ProviderPreflightStatus = 'UNKNOWN'
  $script:StagingIsolationPreflightStatus = 'UNKNOWN'
  $providerEvidenceState = Assert-ProviderEvidence -Evidence $providerEvidenceDocument.Value -SourceSha $sourceSha `
    -ProviderPath $providerPath -ProviderSha256 $providerFileSha256
  $script:ProviderPreflightStatus = 'PASS'
  $script:StagingIsolationPreflightStatus = 'PREFLIGHT_PASS'
  $providerField = $providerEvidenceDocument.Value.PSObject.Properties['provider']
  $providerField.Value | Add-Member -NotePropertyName 'evidenceSha256' -NotePropertyValue $providerFileSha256 -Force
} catch {
  $message = [string]$_.Exception.Message
  if ($message -match '^Staging Readiness Gate V1 stopped:') { throw }
  if ($message -match '^(SOURCE_[A-Z0-9_]+|PROVIDER_[A-Z0-9_]+|SYNTHETIC_[A-Z0-9_]+)$') { Stop-Safely $message }
  Stop-Safely 'POST_PROBE_VALIDATION_FAILED'
}

$providerInput = $providerEvidenceDocument.Value.provider
$branchInput = $providerInput.branch
$isolationInput = $providerEvidenceDocument.Value.stagingIsolation
$lineageInput = $isolationInput.lineage
$syntheticInput = $isolationInput.syntheticOnly
$initSource = [string]$branchInput.init_source
$evidenceEndedAtUtc = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", [Globalization.CultureInfo]::InvariantCulture)
$sameSessionId = $script:ExpectedTarget.ApplicationName
$pgStatSslValue = $null
if ($null -ne $sslDiagnostic -and $sslDiagnostic.ssl -is [bool]) { $pgStatSslValue = [bool]$sslDiagnostic.ssl }

$normalizedProvider = [ordered]@{
  observedAtUtc = [string]$providerInput.observedAtUtc
  provider = [string]$providerInput.provider
  organizationId = [string]$providerInput.organizationId
  projectId = [string]$providerInput.projectId
  branchId = [string]$providerInput.branchId
  endpointId = [string]$providerInput.endpointId
  plan = [string]$providerInput.plan
  computeMinCU = [double]$providerInput.computeMinCU
  computeMaxCU = [double]$providerInput.computeMaxCU
  postgresMajor = [int]$providerInput.postgresMajor
  evidenceReference = [string]$providerInput.evidenceReference
  evidenceSha256 = $providerFileSha256
  branch = [ordered]@{
    state = [string]$branchInput.state
    primary = [bool]$branchInput.primary
    default = [bool]$branchInput.default
    parent_id = $null
    init_source = $initSource
  }
}

$normalizedLineage = [ordered]@{
  sourceSha = [string]$lineageInput.sourceSha
  verificationSource = [string]$lineageInput.verificationSource
  verificationStatus = [string]$lineageInput.verificationStatus
  createRequestMethod = [string]$lineageInput.createRequestMethod
  createRequestOperation = [string]$lineageInput.createRequestOperation
  createRequestReference = [string]$lineageInput.createRequestReference
  createRequestSha256 = [string]$lineageInput.createRequestSha256
  sourceFieldsOmitted = @($lineageInput.sourceFieldsOmitted)
  providerReadbackReference = [string]$lineageInput.providerReadbackReference
  providerReadbackSha256 = [string]$lineageInput.providerReadbackSha256
  projectParentIdFieldObserved = [bool]$lineageInput.projectParentIdFieldObserved
  projectParentId = $null
  sourceProjectIdFieldObserved = [bool]$lineageInput.sourceProjectIdFieldObserved
  sourceProjectId = $null
  branchParentIdFieldObserved = [bool]$lineageInput.branchParentIdFieldObserved
  branchParentId = $null
}
if ($initSource -ceq 'parent-data') {
  $resolutionInput = $lineageInput.parentDataResolution
  $normalizedLineage.parentDataResolution = [ordered]@{
    sourceSha = [string]$resolutionInput.sourceSha
    verificationStatus = [string]$resolutionInput.verificationStatus
    resolvesToNewRoot = [bool]$resolutionInput.resolvesToNewRoot
    explanation = [string]$resolutionInput.explanation
    evidenceReference = [string]$resolutionInput.evidenceReference
    evidenceSha256 = [string]$resolutionInput.evidenceSha256
  }
}

$normalizedSyntheticOnly = [ordered]@{
  classification = [string]$syntheticInput.classification
  sourceSha = [string]$syntheticInput.sourceSha
  datasetManifestReference = [string]$syntheticInput.datasetManifestReference
  datasetManifestSha256 = [string]$syntheticInput.datasetManifestSha256
  attestationReference = [string]$syntheticInput.attestationReference
  attestationSha256 = [string]$syntheticInput.attestationSha256
  noProductionData = [bool]$syntheticInput.noProductionData
}

$evaluatorEvidence = [ordered]@{
  nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  sourceSha = $sourceSha
  provider = $normalizedProvider
  stagingIsolation = [ordered]@{
    observedAtUtc = [string]$isolationInput.observedAtUtc
    targetProjectId = [string]$isolationInput.targetProjectId
    targetBranchId = [string]$isolationInput.targetBranchId
    lineage = $normalizedLineage
    syntheticOnly = $normalizedSyntheticOnly
  }
  connection = [ordered]@{
    sessionId = $sameSessionId
    target = [ordered]@{
      endpointId = $script:ExpectedTarget.EndpointId
      hostname = $script:ExpectedTarget.DirectHostname
      port = [int]$script:ExpectedTarget.Port
      databaseName = $script:ExpectedTarget.Database
      roleName = $script:ExpectedTarget.Role
      pooled = $false
    }
    libpq = [ordered]@{
      sessionId = $sameSessionId
      connectionSucceeded = $true
      sslmode = 'verify-full'
      channelBinding = 'require'
      sslInUse = $true
      sslProtocol = $protocolMatch.Groups['protocol'].Value
      sslCipher = $cipherMatch.Groups['cipher'].Value
    }
    server = [ordered]@{
      sessionId = $sameSessionId
      databaseName = [string]$identity.database
      roleName = [string]$identity.current_user
      postgresMajor = $script:ExpectedTarget.PostgresMajor
      transactionReadOnly = $true
      backendPid = [long]$identityBackendPid
    }
    catalog = [ordered]@{
      sessionId = $sameSessionId
      nonSystemSchemaCount = [long]$catalogCounts['non_system_schema_count']
      nonSystemSchemaNames = @((Get-JsonPropertyValue -Object $catalog -Name 'non_system_schema_names'))
      applicationRelationCount = [long]$catalogCounts['application_relation_count']
      applicationOwnedRelationCount = [long]$catalogCounts['application_owned_relation_count']
      standaloneApplicationTypeCount = [long]$catalogCounts['standalone_application_type_count']
      drizzleJournalPresent = ([long]$catalogCounts['drizzle_journal_count'] -gt 0)
      nonSystemRoutineCount = [long]$catalogCounts['non_system_routine_count']
      extensionNames = @((Get-JsonPropertyValue -Object $catalog -Name 'extension_names'))
      roleMembershipCount = [long]$catalogCounts['role_membership_count']
      defaultAclCount = [long]$catalogCounts['default_acl_count']
      counts = $catalogCounts
      backendPid = [long]$catalogBackendPid
    }
    pgStatSsl = [ordered]@{
      sessionId = $sameSessionId
      ssl = $pgStatSslValue
    }
  }
}

$artifact = [ordered]@{
  schemaVersion = 'staging-readiness-gate-v1/database-probe-evidence/v1'
  result = 'DATABASE_PROBE_PASS'
  sourceSha = $sourceSha
  startedAtUtc = $script:AttemptStartedAtUtc
  completedAtUtc = $evidenceEndedAtUtc
  psqlVersion = $psqlVersion
  querySha256 = $script:QuerySha256
  target = [ordered]@{
    organizationId = $script:ExpectedTarget.OrganizationId
    projectId = $script:ExpectedTarget.ProjectId
    branchId = $script:ExpectedTarget.BranchId
    endpointId = $script:ExpectedTarget.EndpointId
    directHostname = $script:ExpectedTarget.DirectHostname
    port = [int]$script:ExpectedTarget.Port
    database = $script:ExpectedTarget.Database
    role = $script:ExpectedTarget.Role
  }
  providerMetadata = 'NOT_INCLUDED'
  providerEvidence = [ordered]@{
    evidenceReference = [string]$providerInput.evidenceReference
    evidenceSha256 = $providerFileSha256
    preconnectionValidation = 'PASS'
  }
  stagingIsolation = 'UNKNOWN'
  overallGate = 'NOT_EVALUATED'
  migrationAuthorization = 'NOT_GRANTED'
  databaseProbe = [ordered]@{
    status = 'DATABASE_PROBE_PASS'
    psqlExitCode = 0
    sessionId = $sameSessionId
    backendPid = [long]$identityBackendPid
    libpq = [ordered]@{
      sslmode = 'verify-full'
      channelBinding = 'require'
      tlsProtocol = $protocolMatch.Groups['protocol'].Value
      tlsCipher = $cipherMatch.Groups['cipher'].Value
      directHostIdentityVerified = $script:ExpectedTarget.DirectHostname
    }
    transactionReadOnly = 'on'
    catalogCounts = $catalogCounts
    pgStatSslDiagnostic = $sslDiagnosticState
  }
  evidence = $evaluatorEvidence
}

try {
  if ([IO.File]::Exists($evidencePath) -or [IO.Directory]::Exists($evidencePath)) {
    Stop-Safely 'EVIDENCE_OUTPUT_PATH_EXISTS_OR_INVALID'
  }
  $json = ConvertTo-Json -InputObject $artifact -Depth 12 -Compress -ErrorAction Stop
  $jsonBytes = [Text.UTF8Encoding]::new($false).GetBytes($json + "`n")
  if ($jsonBytes.Length -gt 131072) { Stop-Safely 'EVIDENCE_OUTPUT_INVALID' }
  $outputStream = $null
  try {
    $outputStream = [IO.File]::Open($evidencePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $outputStream.Write($jsonBytes, 0, $jsonBytes.Length)
    $outputStream.Flush($true)
  } finally {
    if ($null -ne $outputStream) { $outputStream.Dispose() }
  }
  $script:SuccessEvidenceWritten = $true
} catch {
  $message = [string]$_.Exception.Message
  if ($message -match '^Staging Readiness Gate V1 stopped:') { throw }
  Stop-Safely 'EVIDENCE_WRITE_FAILED'
}

$artifactHasher = [Security.Cryptography.SHA256]::Create()
try { $artifactSha256 = ([BitConverter]::ToString($artifactHasher.ComputeHash($jsonBytes))).Replace('-', '').ToLowerInvariant() }
finally { $artifactHasher.Dispose() }
[Console]::Out.WriteLine('Staging Readiness Gate V1: DATABASE_PROBE_PASS')
[Console]::Out.WriteLine('overallGate=NOT_EVALUATED')
[Console]::Out.WriteLine('providerMetadata=NOT_INCLUDED (evidence digest recorded)')
[Console]::Out.WriteLine('providerPreflight=PASS')
[Console]::Out.WriteLine('stagingIsolation=PREFLIGHT_PASS')
[Console]::Out.WriteLine('sourceSha=' + $sourceSha)
[Console]::Out.WriteLine('psqlVersion=' + $psqlVersion)
[Console]::Out.WriteLine('tls_protocol=' + $protocolMatch.Groups['protocol'].Value)
[Console]::Out.WriteLine('tls_cipher=' + $cipherMatch.Groups['cipher'].Value)
[Console]::Out.WriteLine('transaction_read_only=on')
[Console]::Out.WriteLine('evidence_file=' + $evidencePath)
[Console]::Out.WriteLine('evidence_sha256=' + $artifactSha256)
