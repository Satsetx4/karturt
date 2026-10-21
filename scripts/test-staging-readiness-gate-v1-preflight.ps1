$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$conninfoModulePath = Join-Path $PSScriptRoot 'lib/staging-readiness-conninfo-v1.psm1'
Import-Module -Name $conninfoModulePath -Force -ErrorAction Stop
$captureFilesModulePath = Join-Path $PSScriptRoot 'lib/staging-readiness-capture-files-v1.psm1'
Import-Module -Name $captureFilesModulePath -Force -ErrorAction Stop
$systemRoot = [Environment]::GetEnvironmentVariable('SystemRoot', 'Process')
$icaclsPath = Join-Path $systemRoot 'System32/icacls.exe'
if (-not [IO.File]::Exists($icaclsPath)) { throw 'TEST_ICACLS_UNAVAILABLE' }

function Add-UntrustedWriteAce([string]$Path) {
  & $icaclsPath $Path '/grant' '*S-1-5-32-545:(OI)(CI)M' '/q' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'TEST_ACL_UNTRUSTED_WRITE_ADD_FAILED' }
}

function Remove-UntrustedWriteAce([string]$Path) {
  & $icaclsPath $Path '/remove:g' '*S-1-5-32-545' '/q' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'TEST_ACL_UNTRUSTED_WRITE_REMOVE_FAILED' }
}

function Add-UntrustedReadAce([string]$Path) {
  & $icaclsPath $Path '/grant' '*S-1-5-32-545:(OI)(CI)RX' '/q' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'TEST_ACL_UNTRUSTED_READ_ADD_FAILED' }
}

function Add-ForeignLogonReadAce([string]$Path) {
  & $icaclsPath $Path '/grant' '*S-1-5-5-123-456:(OI)(CI)RX' '/q' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'TEST_ACL_FOREIGN_LOGON_READ_ADD_FAILED' }
}

function Remove-ForeignLogonReadAce([string]$Path) {
  & $icaclsPath $Path '/remove:g' '*S-1-5-5-123-456' '/q' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'TEST_ACL_FOREIGN_LOGON_READ_REMOVE_FAILED' }
}

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
Database|karturt
Client User|karturt_owner
Host|ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech
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
if ($parsedConninfo.Database -cne 'karturt' -or
    $parsedConninfo.Role -cne 'karturt_owner' -or
    $parsedConninfo.Host -cne 'ep-silent-haze-b3pcaa3t.c-4.ap-southeast-1.aws.neon.tech' -or
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

Assert-ConninfoRejects -Text ($fixtureConninfo + "`nDatabase|karturt") -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace '(?m)^Backend PID\|[^\r\n]*\r?\n', '') -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo + "`nUnexpected|value") -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'Database\|karturt', 'Database karturt') -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text 'You are connected to database "karturt" as user "karturt_owner" on host "host" at port "5432".' -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'Database\|karturt', 'Datenbank|karturt') -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'SSL Connection\|true', 'SSL Connection|false') -ExpectedCode 'LIBPQ_TLS_PROOF_MISSING'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'SSL Protocol\|TLSv1.3', 'SSL Protocol|TLSv1.1') -ExpectedCode 'LIBPQ_TLS_PROOF_MISSING'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'SSL Cipher\|TLS_AES_256_GCM_SHA384', 'SSL Cipher|unknown') -ExpectedCode 'LIBPQ_TLS_PROOF_MISSING'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'SSL Compression\|false', 'SSL Compression|true') -ExpectedCode 'LIBPQ_TLS_PROOF_MISSING'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'SSL Protocol\|TLSv1.3\r?\n', '') -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'Options\|', 'Options|one|two') -ExpectedCode 'CONNECTION_INFO_INVALID'
Assert-ConninfoRejects -Text ($fixtureConninfo -replace 'Host Address\|192.0.2.41', 'Host Address|not-an-ip') -ExpectedCode 'CONNECTION_INFO_INVALID'

$runnerPath = Join-Path $PSScriptRoot 'staging-readiness-gate-v1.ps1'
$tempRoot = [Environment]::GetEnvironmentVariable('LOCALAPPDATA', 'Process')
if ([string]::IsNullOrWhiteSpace($tempRoot) -or -not [IO.Directory]::Exists($tempRoot)) {
  throw 'TEST_PRIVATE_TEMP_ROOT_UNAVAILABLE'
}
$caseDirectory = Join-Path $tempRoot ('karturt-gate-v1-preflight-' + [Guid]::NewGuid().ToString('N'))
if ([IO.Directory]::Exists($caseDirectory) -or [IO.File]::Exists($caseDirectory)) {
  throw 'TEST_TEMP_PATH_COLLISION'
}
[void][IO.Directory]::CreateDirectory($caseDirectory)

try {
  $previousRunnerTemp = [Environment]::GetEnvironmentVariable('RUNNER_TEMP', 'Process')
  $previousRunId = [Environment]::GetEnvironmentVariable('GITHUB_RUN_ID', 'Process')
  $previousRunAttempt = [Environment]::GetEnvironmentVariable('GITHUB_RUN_ATTEMPT', 'Process')
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $adminsSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $runnerTempAcl = Get-Acl -LiteralPath $caseDirectory
  $runnerTempAcl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($currentSid, $systemSid, $adminsSid)) {
    $runnerTempAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
  }
  Set-Acl -LiteralPath $caseDirectory -AclObject $runnerTempAcl
  [Environment]::SetEnvironmentVariable('RUNNER_TEMP', $caseDirectory, 'Process')
  [Environment]::SetEnvironmentVariable('GITHUB_RUN_ID', '1234567890', 'Process')
  [Environment]::SetEnvironmentVariable('GITHUB_RUN_ATTEMPT', '1', 'Process')
  $captureRunDirectory = Join-Path (Join-Path $caseDirectory 'karturt-staging-readiness') '1234567890-1'
  [void][IO.Directory]::CreateDirectory($captureRunDirectory)
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $adminsSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  foreach ($directoryPath in @((Join-Path $caseDirectory 'karturt-staging-readiness'), $captureRunDirectory)) {
    $directoryAcl = Get-Acl -LiteralPath $directoryPath
    $directoryAcl.SetAccessRuleProtection($true, $false)
  $directoryInheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
  $directoryAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($currentSid, [Security.AccessControl.FileSystemRights]::FullControl, $directoryInheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  $directoryAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, [Security.AccessControl.FileSystemRights]::FullControl, $directoryInheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  $directoryAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($adminsSid, [Security.AccessControl.FileSystemRights]::FullControl, $directoryInheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    Set-Acl -LiteralPath $directoryPath -AclObject $directoryAcl
  }
  $captureFilePath = Join-Path $captureRunDirectory 'synthetic-ca.pem'
  [IO.File]::WriteAllText($captureFilePath, 'synthetic public CA test bytes', [Text.UTF8Encoding]::new($false))
  $captureAcl = Get-Acl -LiteralPath $captureFilePath
  $captureAcl.SetAccessRuleProtection($true, $false)
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $adminsSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $captureAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($currentSid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
  $captureAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
  $captureAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($adminsSid, [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
  Set-Acl -LiteralPath $captureFilePath -AclObject $captureAcl
  $captureFileSha256 = (Get-FileHash -LiteralPath $captureFilePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $validatedCaptureFile = Assert-StagingCaptureFile -Path $captureFilePath -ExpectedSha256 $captureFileSha256
  if ($validatedCaptureFile -cne [IO.Path]::GetFullPath($captureFilePath)) { throw 'TEST_CAPTURE_FILE_PATH_MISMATCH' }

  Add-UntrustedWriteAce -Path $caseDirectory
  $untrustedRunnerTempWriteRejected = $false
  try {
    $null = Assert-StagingCaptureFile -Path $captureFilePath
  } catch {
    if ([string]$_.Exception.Message -ceq 'TLS_FILE_ACL_UNSAFE') { $untrustedRunnerTempWriteRejected = $true } else { throw }
  } finally {
    Remove-UntrustedWriteAce -Path $caseDirectory
  }
  if (-not $untrustedRunnerTempWriteRejected) { throw 'TEST_RUNNER_TEMP_UNTRUSTED_WRITE_ACCEPTED' }

  $captureParentPath = Join-Path $caseDirectory 'karturt-staging-readiness'
  Add-UntrustedWriteAce -Path $captureParentPath
  $untrustedDirectoryWriteRejected = $false
  try {
    $null = Assert-StagingCaptureFile -Path $captureFilePath
  } catch {
    if ([string]$_.Exception.Message -ceq 'TLS_FILE_ACL_UNSAFE') { $untrustedDirectoryWriteRejected = $true } else { throw }
  } finally {
    Remove-UntrustedWriteAce -Path $captureParentPath
  }
  if (-not $untrustedDirectoryWriteRejected) { throw 'TEST_CAPTURE_PARENT_UNTRUSTED_WRITE_ACCEPTED' }

  Add-UntrustedReadAce -Path $captureParentPath
  $untrustedDirectoryReadRejected = $false
  try {
    $null = Assert-StagingCaptureFile -Path $captureFilePath
  } catch {
    if ([string]$_.Exception.Message -ceq 'TLS_FILE_ACL_UNSAFE') { $untrustedDirectoryReadRejected = $true } else { throw }
  } finally {
    Remove-UntrustedWriteAce -Path $captureParentPath
  }
  if (-not $untrustedDirectoryReadRejected) { throw 'TEST_CAPTURE_PARENT_UNTRUSTED_READ_ACCEPTED' }

  Add-ForeignLogonReadAce -Path $captureParentPath
  $foreignLogonDirectoryReadRejected = $false
  try {
    $null = Assert-StagingCaptureFile -Path $captureFilePath
  } catch {
    if ([string]$_.Exception.Message -ceq 'TLS_FILE_ACL_UNSAFE') { $foreignLogonDirectoryReadRejected = $true } else { throw }
  } finally {
    Remove-ForeignLogonReadAce -Path $captureParentPath
  }
  if (-not $foreignLogonDirectoryReadRejected) { throw 'TEST_FOREIGN_LOGON_SESSION_READ_ACCEPTED' }

  $readGuard = [IO.File]::Open($captureFilePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $concurrentWriteRejected = $false
  try {
    $writer = $null
    try {
      $writer = [IO.File]::Open($captureFilePath, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None)
    } catch [IO.IOException] {
      $concurrentWriteRejected = $true
    } finally {
      if ($null -ne $writer) { $writer.Dispose() }
    }
  } finally {
    $readGuard.Dispose()
  }
  if (-not $concurrentWriteRejected) { throw 'TEST_CAPTURE_READ_GUARD_DID_NOT_BLOCK_WRITE' }

  $wrongPinRejected = $false
  try {
    $null = Assert-StagingCaptureFile -Path $captureFilePath -ExpectedSha256 ('0' * 64)
  } catch {
    if ([string]$_.Exception.Message -ceq 'TLS_ROOT_CA_PIN_MISMATCH') { $wrongPinRejected = $true } else { throw }
  }
  if (-not $wrongPinRejected) { throw 'TEST_CAPTURE_FILE_WRONG_PIN_ACCEPTED' }

  $outsideTempRejected = $false
  try {
    $null = Assert-StagingCaptureFile -Path $captureFilesModulePath
  } catch {
    if ([string]$_.Exception.Message -ceq 'TLS_FILE_UNSAFE') { $outsideTempRejected = $true } else { throw }
  }
  if (-not $outsideTempRejected) { throw 'TEST_CAPTURE_FILE_OUTSIDE_RUNNER_TEMP_ACCEPTED' }
  [Environment]::SetEnvironmentVariable('RUNNER_TEMP', $previousRunnerTemp, 'Process')
  [Environment]::SetEnvironmentVariable('GITHUB_RUN_ID', $previousRunId, 'Process')
  [Environment]::SetEnvironmentVariable('GITHUB_RUN_ATTEMPT', $previousRunAttempt, 'Process')

  $missingProviderPath = Join-Path $caseDirectory 'missing-provider.json'
  $failureEvidencePath = Join-Path $caseDirectory 'stop.json'
  $pwshExecutable = (Get-Process -Id $PID -ErrorAction Stop).Path
  if ([string]::IsNullOrWhiteSpace($pwshExecutable) -or -not [IO.File]::Exists($pwshExecutable)) {
    throw 'TEST_POWERSHELL_EXECUTABLE_UNAVAILABLE'
  }
  $projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $gitExecutable = (Get-Command 'git.exe' -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  if ([string]::IsNullOrWhiteSpace($gitExecutable) -or -not [IO.File]::Exists($gitExecutable)) {
    throw 'TEST_GIT_EXECUTABLE_UNAVAILABLE'
  }
  $emptyGitConfigPath = Join-Path $caseDirectory 'empty-git-config'
  [IO.File]::WriteAllText($emptyGitConfigPath, '', [Text.UTF8Encoding]::new($false))

  function Invoke-IsolatedReadinessRunner([string]$ProviderPath, [string]$OutputPath) {
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $pwshExecutable
    $startInfo.WorkingDirectory = $projectRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in @(
        '-NoProfile', '-NonInteractive', '-File', $runnerPath,
        '-ProviderEvidencePath', $ProviderPath,
        '-EvidenceOutputPath', $OutputPath
      )) {
      [void]$startInfo.ArgumentList.Add([string]$argument)
    }
    $startInfo.Environment.Clear()
    $startInfo.Environment['SystemRoot'] = $systemRoot
    $startInfo.Environment['WINDIR'] = $systemRoot
    $startInfo.Environment['PATH'] = @(
      [IO.Path]::GetDirectoryName($pwshExecutable),
      [IO.Path]::GetDirectoryName($gitExecutable),
      (Join-Path $systemRoot 'System32')
    ) -join [IO.Path]::PathSeparator
    $startInfo.Environment['TEMP'] = $tempRoot
    $startInfo.Environment['TMP'] = $tempRoot
    $startInfo.Environment['RUNNER_TEMP'] = $tempRoot
    $startInfo.Environment['GITHUB_RUN_ID'] = '1234567890'
    $startInfo.Environment['GITHUB_RUN_ATTEMPT'] = '1'
    $startInfo.Environment['GIT_CONFIG_GLOBAL'] = $emptyGitConfigPath
    $startInfo.Environment['GIT_CONFIG_NOSYSTEM'] = '1'
    $startInfo.Environment['GIT_CONFIG_COUNT'] = '1'
    $startInfo.Environment['GIT_CONFIG_KEY_0'] = 'core.autocrlf'
    $startInfo.Environment['GIT_CONFIG_VALUE_0'] = 'true'

    $process = [Diagnostics.Process]::new()
    try {
      $process.StartInfo = $startInfo
      if (-not $process.Start()) { throw 'TEST_RUNNER_PROCESS_START_FAILED' }
      $stdoutTask = $process.StandardOutput.ReadToEndAsync()
      $stderrTask = $process.StandardError.ReadToEndAsync()
      if (-not $process.WaitForExit(30000)) {
        try { $process.Kill($true) } catch { }
        throw 'TEST_RUNNER_PROCESS_TIMEOUT'
      }
      $process.WaitForExit()
      $null = $stdoutTask.GetAwaiter().GetResult()
      $null = $stderrTask.GetAwaiter().GetResult()
      return $process.ExitCode
    } finally {
      $process.Dispose()
    }
  }

  $runnerExitCode = Invoke-IsolatedReadinessRunner -ProviderPath $missingProviderPath -OutputPath $failureEvidencePath
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
      projectId = 'wild-darkness-00489132'
      branchId = 'br-spring-shadow-b37rykzl'
      claimedCaptureAuthentication = 'VERIFIED'
    }
    stagingIsolation = [ordered]@{ verificationStatus = 'VERIFIED'; classification = 'SYNTHETIC_ONLY' }
  }
  $selfAssertedJson = ConvertTo-Json -InputObject $selfAssertedProvider -Depth 6 -Compress
  [IO.File]::WriteAllText($selfAssertedProviderPath, $selfAssertedJson, [Text.UTF8Encoding]::new($false))
  $runnerExitCode = Invoke-IsolatedReadinessRunner -ProviderPath $selfAssertedProviderPath -OutputPath $selfAssertedOutputPath
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
  if ($null -ne $selfAssertedArtifact.psqlSha256) { $failedSelfAssertedChecks.Add('psqlSha256') }
  if ($null -ne $selfAssertedArtifact.psqlExpectedSha256) { $failedSelfAssertedChecks.Add('psqlExpectedSha256') }
  if ($null -ne $selfAssertedArtifact.psqlPinSource) { $failedSelfAssertedChecks.Add('psqlPinSource') }
  if ($selfAssertedArtifact.databaseProbe.status -cne 'STOPPED') { $failedSelfAssertedChecks.Add('databaseProbe.status') }
  if ($selfAssertedArtifact.migrationAuthorization -cne 'NOT_GRANTED') { $failedSelfAssertedChecks.Add('migrationAuthorization') }
  if ($failedSelfAssertedChecks.Count -gt 0) {
    throw ('TEST_SELF_ASSERTED_PROVIDER_FALSE_PASS:' + ($failedSelfAssertedChecks -join ','))
  }

  function Write-ForgedProviderArtifact([string]$Path, [string]$ArtifactType, [string]$SourceSha, $Fields) {
    $artifact = [ordered]@{
      schemaVersion = 'staging-readiness-gate-v1/evidence-artifact/v1'
      artifactType = $ArtifactType
      sourceSha = $SourceSha
    }
    foreach ($fieldName in $Fields.Keys) { $artifact[$fieldName] = $Fields[$fieldName] }
    $json = ConvertTo-Json -InputObject $artifact -Depth 12 -Compress
    [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{
      Reference = [IO.Path]::GetFileName($Path)
      Sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
    }
  }

  $gitHead = & $gitExecutable -C $projectRoot rev-parse --verify 'HEAD^{commit}'
  if ($LASTEXITCODE -ne 0 -or [string]$gitHead -cnotmatch '^[a-f0-9]{40,64}$') {
    throw 'TEST_SOURCE_SHA_UNAVAILABLE'
  }
  $sourceSha = ([string]$gitHead).Trim()
  $syntheticObservedAtUtc = [DateTimeOffset]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fffffff'Z'", [Globalization.CultureInfo]::InvariantCulture)
  $expectedProjectId = 'wild-darkness-00489132'
  $expectedBranchId = 'br-spring-shadow-b37rykzl'
  $requiredOmittedSourceFields = @('parent_id', 'parent_project_id', 'source_project_id', 'clone', 'import', 'restore')

  $createRequestArtifact = Write-ForgedProviderArtifact -Path (Join-Path $caseDirectory 'forged-create-request.json') `
    -ArtifactType 'lineage-create-request' -SourceSha $sourceSha -Fields ([ordered]@{
      targetProjectId = $expectedProjectId
      targetBranchId = $expectedBranchId
      method = 'POST'
      operation = 'create-project'
      sourceFieldsOmitted = $requiredOmittedSourceFields
    })
  $providerReadbackArtifact = Write-ForgedProviderArtifact -Path (Join-Path $caseDirectory 'forged-provider-readback.json') `
    -ArtifactType 'provider-lineage-readback' -SourceSha $sourceSha -Fields ([ordered]@{
      targetProjectId = $expectedProjectId
      targetBranchId = $expectedBranchId
      projectParentIdFieldObserved = $false
      projectParentId = $null
      sourceProjectIdFieldObserved = $false
      sourceProjectId = $null
      branchParentIdFieldObserved = $false
      branchParentId = $null
      init_source = 'parent-data'
    })
  $rootResolutionArtifact = Write-ForgedProviderArtifact -Path (Join-Path $caseDirectory 'forged-root-resolution.json') `
    -ArtifactType 'root-branch-resolution' -SourceSha $sourceSha -Fields ([ordered]@{
      targetProjectId = $expectedProjectId
      targetBranchId = $expectedBranchId
      verificationStatus = 'VERIFIED'
      resolvesToNewRoot = $true
      contractReference = 'https://neon.com/docs/manage/branches'
      explanation = 'Synthetic preflight fixture only.'
    })
  $datasetManifestArtifact = Write-ForgedProviderArtifact -Path (Join-Path $caseDirectory 'forged-dataset-manifest.json') `
    -ArtifactType 'synthetic-dataset-manifest' -SourceSha $sourceSha -Fields ([ordered]@{
      targetProjectId = $expectedProjectId
      targetBranchId = $expectedBranchId
      classification = 'SYNTHETIC_ONLY'
      noProductionData = $true
    })
  $syntheticAttestationArtifact = Write-ForgedProviderArtifact -Path (Join-Path $caseDirectory 'forged-synthetic-attestation.json') `
    -ArtifactType 'synthetic-only-attestation' -SourceSha $sourceSha -Fields ([ordered]@{
      targetProjectId = $expectedProjectId
      targetBranchId = $expectedBranchId
      classification = 'SYNTHETIC_ONLY'
      noProductionData = $true
    })

  $forgedProviderPath = Join-Path $caseDirectory 'fully-forged-provider.json'
  $forgedProviderOutputPath = Join-Path $caseDirectory 'fully-forged-stop.json'
  $forgedProvider = [ordered]@{
    schemaVersion = 'staging-readiness-gate-v1/evidence-artifact/v1'
    artifactType = 'provider-metadata'
    sourceSha = $sourceSha
    provider = [ordered]@{
      provider = 'neon'
      organizationId = 'org-ancient-boat-57106549'
      projectId = $expectedProjectId
      branchId = $expectedBranchId
      endpointId = 'ep-silent-haze-b3pcaa3t'
      endpointBranchId = $expectedBranchId
      evidenceReference = 'fully-forged-provider.json'
      observedAtUtc = $syntheticObservedAtUtc
      plan = 'free'
      postgresMajor = 18
      computeMinCU = 0.25
      computeMaxCU = 0.25
      branch = [ordered]@{ state = 'ready'; primary = $true; default = $true; init_source = 'parent-data' }
    }
    stagingIsolation = [ordered]@{
      sourceSha = $sourceSha
      observedAtUtc = $syntheticObservedAtUtc
      targetProjectId = $expectedProjectId
      targetBranchId = $expectedBranchId
      lineage = [ordered]@{
        sourceSha = $sourceSha
        verificationSource = 'provider-api-create-request-and-readback'
        verificationStatus = 'VERIFIED'
        createRequestMethod = 'POST'
        createRequestOperation = 'create-project'
        createRequestReference = $createRequestArtifact.Reference
        createRequestSha256 = $createRequestArtifact.Sha256
        providerReadbackReference = $providerReadbackArtifact.Reference
        providerReadbackSha256 = $providerReadbackArtifact.Sha256
        sourceFieldsOmitted = $requiredOmittedSourceFields
        projectParentIdFieldObserved = $false
        projectParentId = $null
        sourceProjectIdFieldObserved = $false
        sourceProjectId = $null
        branchParentIdFieldObserved = $false
        branchParentId = $null
        rootStructureResolution = [ordered]@{
          sourceSha = $sourceSha
          verificationStatus = 'VERIFIED'
          contractReference = 'https://neon.com/docs/manage/branches'
          resolvesToNewRoot = $true
          explanation = 'Synthetic preflight fixture only.'
          evidenceReference = $rootResolutionArtifact.Reference
          evidenceSha256 = $rootResolutionArtifact.Sha256
        }
      }
      syntheticOnly = [ordered]@{
        sourceSha = $sourceSha
        classification = 'SYNTHETIC_ONLY'
        datasetManifestReference = $datasetManifestArtifact.Reference
        datasetManifestSha256 = $datasetManifestArtifact.Sha256
        attestationReference = $syntheticAttestationArtifact.Reference
        attestationSha256 = $syntheticAttestationArtifact.Sha256
        noProductionData = $true
      }
    }
  }
  $fullyForgedJson = ConvertTo-Json -InputObject $forgedProvider -Depth 16 -Compress
  [IO.File]::WriteAllText($forgedProviderPath, $fullyForgedJson, [Text.UTF8Encoding]::new($false))
  $fullyForgedProviderSha256 = (Get-FileHash -LiteralPath $forgedProviderPath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
  $runnerExitCode = Invoke-IsolatedReadinessRunner -ProviderPath $forgedProviderPath -OutputPath $forgedProviderOutputPath
  if ($runnerExitCode -eq 0) { throw 'TEST_FULLY_FORGED_PROVIDER_WAS_ACCEPTED' }
  if (-not [IO.File]::Exists($forgedProviderOutputPath)) { throw 'TEST_FULLY_FORGED_STOP_EVIDENCE_MISSING' }
  $fullyForgedArtifact = Get-Content -LiteralPath $forgedProviderOutputPath -Raw | ConvertFrom-Json -ErrorAction Stop
  $fullyForgedFailure = [Collections.Generic.List[string]]::new()
  if ($fullyForgedArtifact.result -cne 'DATABASE_PROBE_STOPPED') { $fullyForgedFailure.Add('result') }
  if ($fullyForgedArtifact.stopCode -cne 'PROVIDER_CAPTURE_UNAUTHENTICATED') { $fullyForgedFailure.Add('stopCode=' + [string]$fullyForgedArtifact.stopCode) }
  if ($fullyForgedArtifact.providerEvidenceSha256 -cne $fullyForgedProviderSha256) { $fullyForgedFailure.Add('providerEvidenceSha256') }
  if ($fullyForgedArtifact.providerCaptureAuthentication -cne 'UNKNOWN') { $fullyForgedFailure.Add('providerCaptureAuthentication') }
  if ($fullyForgedArtifact.providerPreflight -cne 'UNKNOWN') { $fullyForgedFailure.Add('providerPreflight') }
  if ($fullyForgedArtifact.stagingIsolation -cne 'UNKNOWN') { $fullyForgedFailure.Add('stagingIsolation') }
  if ($fullyForgedArtifact.overallGate -cne 'NOT_EVALUATED') { $fullyForgedFailure.Add('overallGate') }
  if ($null -ne $fullyForgedArtifact.psqlVersion) { $fullyForgedFailure.Add('psqlVersion') }
  if ($null -ne $fullyForgedArtifact.psqlSha256) { $fullyForgedFailure.Add('psqlSha256') }
  if ($null -ne $fullyForgedArtifact.psqlExitCode) { $fullyForgedFailure.Add('psqlExitCode') }
  if ($fullyForgedArtifact.migrationAuthorization -cne 'NOT_GRANTED') { $fullyForgedFailure.Add('migrationAuthorization') }
  if ($fullyForgedFailure.Count -gt 0) {
    throw ('TEST_FULLY_FORGED_PROVIDER_FALSE_PASS:' + ($fullyForgedFailure -join ','))
  }

  $runnerSource = [IO.File]::ReadAllText($runnerPath)
  foreach ($requiredRunnerFragment in @(
      "`$startInfo.Environment['PGGSSENCMODE'] = 'disable'",
      "`$startInfo.Environment['PGSSLMODE'] = 'verify-full'",
      "`$startInfo.Environment['PGCHANNELBINDING'] = 'require'",
      '$passFileGuard = [IO.File]::Open($passFilePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)',
      'Get-StreamSha256 -Stream $rootCertificateGuard',
      "`$expectedPsqlSha256 = [Environment]::GetEnvironmentVariable('KARTURT_STAGING_PSQL_SHA256', 'Process')",
      '$psqlBinaryGuard = [IO.File]::Open($psqlPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)',
      '$script:ObservedPsqlSha256 = Get-StreamSha256 -Stream $psqlBinaryGuard',
      "Stop-Safely 'POSTGRESQL_18_PSQL_PIN_MISMATCH'",
      'psqlSha256 = $script:ObservedPsqlSha256',
      '$info.Environment.Clear()',
      '$startInfo.Environment.Clear()',
      "rootCertificateSource = 'protected-environment-variable:KARTURT_STAGING_CA_SHA256'",
      'rootCertificateSha256 = $script:RootCertificateSha256',
      "@{ Name = 'endpointBranchId'; Expected = `$script:ExpectedTarget.BranchId }",
      "-ExpectedArtifactType 'root-branch-resolution'"
    )) {
    if (-not $runnerSource.Contains($requiredRunnerFragment)) {
      throw 'TEST_STAGING_CAPTURE_GUARD_FRAGMENT_MISSING'
    }
  }

  $captureFilesSource = [IO.File]::ReadAllText($captureFilesModulePath)
  foreach ($requiredCaptureFilesFragment in @(
      '$directoryInfo = [IO.DirectoryInfo]::new($runRoot)',
      'FileAttributes]::ReparsePoint',
      'GetOwner([Security.Principal.SecurityIdentifier])',
      '$unsafeWriteRights',
      '[Karturt.Security.TokenInfo]::GetLogonSid($currentIdentity.Token)',
      '$sid -ceq $currentLogonSessionSid',
      'GetTokenInformation(tokenHandle, 28',
      'TLS_FILE_ACL_UNSAFE'
    )) {
    if (-not $captureFilesSource.Contains($requiredCaptureFilesFragment)) {
      throw 'TEST_STAGING_CAPTURE_PATH_GUARD_FRAGMENT_MISSING'
    }
  }

  Write-Output 'Staging Readiness Gate V1 PostgreSQL 18 conninfo, path/ACL/owner guards, current-logon-SID binding, locked TLS files, missing/partial/full-forged provider early-stop, and self-assertion regressions: PASS'
} finally {
  [Environment]::SetEnvironmentVariable('RUNNER_TEMP', $previousRunnerTemp, 'Process')
  [Environment]::SetEnvironmentVariable('GITHUB_RUN_ID', $previousRunId, 'Process')
  [Environment]::SetEnvironmentVariable('GITHUB_RUN_ATTEMPT', $previousRunAttempt, 'Process')
  if ([IO.Directory]::Exists($caseDirectory)) {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot).TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
    $resolvedCase = [IO.Path]::GetFullPath($caseDirectory)
    if (-not $resolvedCase.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'TEST_TEMP_PATH_OUTSIDE_TEMP_ROOT'
    }
    Remove-Item -LiteralPath $resolvedCase -Recurse -Force
  }
}
