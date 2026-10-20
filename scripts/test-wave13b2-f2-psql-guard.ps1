[CmdletBinding()]
param(
  [string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin',
  [string]$RunnerModulePath = (Join-Path $PSScriptRoot 'lib/wave13b2-f2-runner.psm1')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Import-Module $RunnerModulePath -Force

function Require-TestCondition([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-TestSha256Hex([byte[]]$Bytes) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha256.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Get-TestSourceSha([string]$Name, [string]$BaseSourceSha) {
  $material = [Text.UTF8Encoding]::new($false).GetBytes($BaseSourceSha + ':' + $Name)
  return (Get-TestSha256Hex -Bytes $material).Substring(0, 40)
}

function Set-TestOwnerOnlyDirectory([string]$Path) {
  [void][IO.Directory]::CreateDirectory($Path)
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $directorySecurity = [Security.AccessControl.DirectorySecurity]::new()
  $directorySecurity.SetOwner($currentSid)
  $directorySecurity.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($currentSid, $systemSid)) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit,
      [Security.AccessControl.PropagationFlags]::None,
      [Security.AccessControl.AccessControlType]::Allow
    )
    [void]$directorySecurity.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $Path -AclObject $directorySecurity
}

function Set-TestOwnerOnlyFile([string]$Path) {
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $fileSecurity = [Security.AccessControl.FileSecurity]::new()
  $fileSecurity.SetOwner($currentSid)
  $fileSecurity.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($currentSid, $systemSid)) {
    [void]$fileSecurity.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.AccessControlType]::Allow
    ))
  }
  Set-Acl -LiteralPath $Path -AclObject $fileSecurity
}

function Get-TestAttemptDirectory([string]$BasePath, [string]$SourceSha) {
  $path = Join-Path $BasePath ('f2-attempt-' + $SourceSha)
  [void][IO.Directory]::CreateDirectory($path)
  Set-TestOwnerOnlyDirectory -Path $path
  return $path
}

function Invoke-CheckedProcess([string]$Executable, [string[]]$ArgumentList, [string]$Label) {
  $process = [Diagnostics.Process]::new()
  try {
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $Executable
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $ArgumentList) { [void]$startInfo.ArgumentList.Add([string]$argument) }
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw ($Label + ' process did not start.') }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(60000)) {
      try { $process.Kill($true) } catch { }
      throw ($Label + ' timed out after 60 seconds.')
    }
    $captureComplete = [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($stdoutTask, $stderrTask), 1000)
    $stdout = if ($stdoutTask.IsCompletedSuccessfully) { $stdoutTask.GetAwaiter().GetResult() } else { '' }
    $stderr = if ($stderrTask.IsCompletedSuccessfully) { $stderrTask.GetAwaiter().GetResult() } else { '' }
    $output = @([regex]::Split(($stdout + "`n" + $stderr), '\r?\n') | Where-Object { $_.Length -gt 0 })
    if (-not $captureComplete) { $output += '[setup process output pipe remained open after process exit]' }
    if ($process.ExitCode -ne 0) {
      throw ($Label + ' failed with exit code ' + $process.ExitCode + ': ' + ($output -join ' | '))
    }
    return [string[]]$output
  } finally {
    $process.Dispose()
  }
}

function Write-TestStage([string]$Stage) {
  Write-Host ('[PG18] stage=' + $Stage)
}

function Write-TestPem([string]$Path, [string]$Label, [byte[]]$Bytes) {
  $base64 = [Convert]::ToBase64String($Bytes)
  $wrapped = [regex]::Replace($base64, '.{1,64}', '$&' + "`n")
  $text = '-----BEGIN ' + $Label + "-----`n" + $wrapped + '-----END ' + $Label + "-----`n"
  [IO.File]::WriteAllText($Path, $text, [Text.UTF8Encoding]::new($false))
}

function New-TestTlsCertificate([string]$CertificatePath, [string]$PrivateKeyPath) {
  $rsa = [Security.Cryptography.RSA]::Create(2048)
  $certificate = $null
  $privateKeyBytes = $null
  try {
    $request = [Security.Cryptography.X509Certificates.CertificateRequest]::new(
      'CN=localhost',
      $rsa,
      [Security.Cryptography.HashAlgorithmName]::SHA256,
      [Security.Cryptography.RSASignaturePadding]::Pkcs1
    )
    $subjectAlternativeNames = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
    $subjectAlternativeNames.AddDnsName('localhost')
    $subjectAlternativeNames.AddIpAddress([Net.IPAddress]::Loopback)
    $request.CertificateExtensions.Add($subjectAlternativeNames.Build())
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-2), [DateTimeOffset]::UtcNow.AddDays(1))
    $certificateBytes = $certificate.Export([Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $privateKeyBytes = $rsa.ExportPkcs8PrivateKey()
    Write-TestPem -Path $CertificatePath -Label 'CERTIFICATE' -Bytes $certificateBytes
    Write-TestPem -Path $PrivateKeyPath -Label 'PRIVATE KEY' -Bytes $privateKeyBytes
    [Array]::Clear($certificateBytes, 0, $certificateBytes.Length)
  } finally {
    if ($null -ne $certificate) { $certificate.Dispose() }
    if ($null -ne $privateKeyBytes) { [Array]::Clear($privateKeyBytes, 0, $privateKeyBytes.Length) }
    $rsa.Dispose()
  }
}

function Get-TestLoopbackPort([Net.IPAddress]$Address = [Net.IPAddress]::Loopback) {
  $listener = [Net.Sockets.TcpListener]::new($Address, 0)
  try {
    $listener.Start()
    return ([Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Get-TestMarkerStatus([string]$Path) {
  $matches = [regex]::Matches([IO.File]::ReadAllText($Path), '(?m)^status=(COMPLETED|FAILED)$')
  if ($matches.Count -eq 0) { return $null }
  return $matches[$matches.Count - 1].Groups[1].Value
}

function Assert-TestMarkerStatus([string]$Path, [string]$ExpectedStatus, [string]$Label) {
  $status = Get-TestMarkerStatus -Path $Path
  Require-TestCondition ($status -ceq $ExpectedStatus) ($Label + ' marker status was ' + $status + '; expected ' + $ExpectedStatus + '.')
}

function Assert-TestF2Classification(
  [string]$Label,
  [int]$ExitCode,
  [string[]]$DiagnosticLines,
  [string]$ExpectedSourceSha,
  [string]$ExpectedQuerySha,
  [bool]$EvidenceVerified,
  [string[]]$FailureCodes,
  [string]$ExpectedStatus
) {
  $classification = Get-Wave13B2F2RunClassification `
    -ExitCode $ExitCode `
    -ControlMarkers $DiagnosticLines `
    -StderrMarkers @() `
    -ExpectedSourceSha $ExpectedSourceSha `
    -ExpectedQuerySha256 $ExpectedQuerySha `
    -EvidenceVerified $EvidenceVerified `
    -FailureCodes $FailureCodes
  Require-TestCondition ($classification.Status -ceq $ExpectedStatus) ($Label + ' status was ' + $classification.Status + '; expected ' + $ExpectedStatus + '.')
  return $classification
}

function Invoke-TestPsqlCase(
  [string]$Name,
  [string]$HostAddress,
  [int]$Port,
  [string]$InputFile,
  [string]$TargetBranchId = 'br-orange-recipe-azed9f78',
  [string]$ExpectedStatus,
  [string]$ExpectedFailureCode,
  [string]$ExpectedSourceSha,
  [string]$ExpectedQuerySha,
  [string]$TestRoot,
  [string]$EvidenceRoot,
  [string]$AclCheckerPath,
  [string]$PsqlPath,
  [int]$TimeoutSeconds = 0
) {
  $caseSourceSha = Get-TestSourceSha -Name $Name -BaseSourceSha $ExpectedSourceSha
  $inputBytes = [IO.File]::ReadAllBytes($InputFile)
  $caseQuerySha = Get-TestSha256Hex -Bytes $inputBytes
  $attemptRoot = Get-TestAttemptDirectory -BasePath $EvidenceRoot -SourceSha $caseSourceSha
  $markerPath = Join-Path $attemptRoot ('wave13b2-f2-query-attempt-' + $caseSourceSha + '.local.txt')
  $auditPath = Join-Path $attemptRoot ('wave13b2-f2-audit-' + $caseSourceSha + '-' + $caseQuerySha + '.local.txt')
  $evidenceFileName = 'wave13b2-f2-catalog-evidence-' + $caseSourceSha + '-' + $caseQuerySha + '.local.txt'
  $evidencePath = Join-Path $attemptRoot $evidenceFileName
  $markerStream = [IO.File]::Open($markerPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $approvalDigest = Get-TestSha256Hex -Bytes ([Text.UTF8Encoding]::new($false).GetBytes('synthetic-approval:' + $caseSourceSha + ':' + $caseQuerySha))
    $markerBytes = [Text.UTF8Encoding]::new($false).GetBytes("status=STARTED`nsourceSha=$caseSourceSha`nqueryPacketSha256=$caseQuerySha`nsignedApprovalDigest=$approvalDigest`n")
    $markerStream.Write($markerBytes, 0, $markerBytes.Length)
    $markerStream.Flush($true)
  } finally {
    $markerStream.Dispose()
  }
  Set-TestOwnerOnlyFile -Path $markerPath
  $arguments = @(
    '-X', '-w', '-P', 'pager=off', '-P', 'format=csv', '-P', 'footer=off', '-v', 'ON_ERROR_STOP=1',
    '-h', $HostAddress, '-p', [string]$Port, '-d', 'neondb', '-U', 'neondb_owner',
    '-v', 'owner_signed_query_approval_verified=on',
    '-v', 'target_project_id=broad-star-40451875',
    '-v', ('target_branch_id=' + $TargetBranchId),
    '-v', 'target_endpoint_id=ep-mute-firefly-azjcru4h',
    '-v', ('approved_source_sha=' + $caseSourceSha),
    '-v', ('query_packet_sha256=' + $caseQuerySha),
    '-v', 'expected_database=neondb',
    '-v', 'expected_owner_role=neondb_owner',
    '-f', $InputFile
  )
  $invokeArguments = @{
    PsqlExecutable = $PsqlPath
    ArgumentList = $arguments
    EvidencePath = $evidencePath
    AclCheckerPath = $AclCheckerPath
    ExpectedSourceSha = $caseSourceSha
    ExpectedQuerySha256 = $caseQuerySha
  }
  if ($TimeoutSeconds -gt 0) { $invokeArguments.TimeoutSeconds = $TimeoutSeconds }
  $runResult = Invoke-Wave13B2F2Psql @invokeArguments
  $classification = Get-Wave13B2F2RunClassification `
    -ExitCode $runResult.ExitCode `
    -ControlMarkers $runResult.ControlMarkers `
    -StderrMarkers $runResult.StderrMarkers `
    -ExpectedSourceSha $caseSourceSha `
    -ExpectedQuerySha256 $caseQuerySha `
    -EvidenceVerified $runResult.EvidenceVerified `
    -FailureCodes $runResult.FailureCodes
  $auditContent = New-Wave13B2F2AuditContent `
    -SourceSha $caseSourceSha `
    -QuerySha256 $caseQuerySha `
    -RunResult $runResult `
    -Classification $classification
  $auditSha = Write-Wave13B2F2AuditEvidence -Path $auditPath -Content $auditContent -AclCheckerPath $AclCheckerPath
  Add-Wave13B2F2AttemptResult `
    -MarkerPath $markerPath `
    -RunResult $runResult `
    -Classification $classification `
    -AuditFileName ([IO.Path]::GetFileName($auditPath)) `
    -AuditSha256 $auditSha

  $safeFailureCodes = @($classification.FailureCodes | ForEach-Object { [string]$_ } | Sort-Object -Unique) -join ','
  $safeMarkerKinds = @($runResult.ControlMarkers + $runResult.StderrMarkers | ForEach-Object {
    if ([string]$_ -match '^(F2_DONE|F2_FAIL|F2_STOP|F2_CHECK|F2_CATALOG_READ)\b') { $Matches[1] }
  } | Sort-Object -Unique) -join ','
  $safeSummary = 'status=' + $classification.Status + ' exit=' + $runResult.ExitCode + ' started=' + $runResult.PsqlStarted + ' evidenceVerified=' + $runResult.EvidenceVerified + ' evidenceBytes=' + $runResult.EvidenceBytes + ' failureCodes=' + $safeFailureCodes + ' markerKinds=' + $safeMarkerKinds
  Assert-TestMarkerStatus -Path $markerPath -ExpectedStatus $ExpectedStatus -Label ($Name + ' ' + $safeSummary)
  Require-TestCondition ($classification.Status -ceq $ExpectedStatus) ($Name + ' classification did not match its expected result: ' + $safeSummary)
  if ($ExpectedFailureCode) {
    Require-TestCondition (@($classification.FailureCodes | Where-Object { $_ -match [regex]::Escape($ExpectedFailureCode) }).Count -gt 0) ($Name + ' lost its expected failure code.')
    Require-TestCondition ([IO.File]::ReadAllText($auditPath).Contains($ExpectedFailureCode)) ($Name + ' audit evidence lost the failure code.')
  }
  Require-TestCondition ($runResult.PsqlStarted -or $Name -eq 'tampered-query-denial') ($Name + ' unexpectedly skipped its psql path.')
  Require-TestCondition ([IO.File]::ReadAllText($markerPath).Contains('sourceSha=' + $caseSourceSha)) ($Name + ' marker lost its source pin.')
  Require-TestCondition ([IO.File]::ReadAllText($markerPath).Contains('queryPacketSha256=' + $caseQuerySha)) ($Name + ' marker lost its query pin.')
  return [pscustomobject]@{
    Name = $Name
    ExitCode = $runResult.ExitCode
    Status = $classification.Status
    FailureCodes = [string[]]$classification.FailureCodes
    DiagnosticLines = [string[]]$runResult.DiagnosticLines
    SourceSha = $caseSourceSha
    QuerySha256 = $caseQuerySha
    AuditPath = $auditPath
    MarkerPath = $markerPath
    EvidencePath = $evidencePath
    EvidenceBytes = $runResult.EvidenceBytes
    EvidenceSha256 = $runResult.EvidenceSha256
    EvidenceVerified = $runResult.EvidenceVerified
    RunResult = $runResult
    Classification = $classification
  }
}

$postgresBinResolved = (Resolve-Path -LiteralPath $PostgresBin).Path
$initdbPath = Join-Path $postgresBinResolved 'initdb.exe'
$pgCtlPath = Join-Path $postgresBinResolved 'pg_ctl.exe'
$psqlPath = Join-Path $postgresBinResolved 'psql.exe'
foreach ($application in @($initdbPath, $pgCtlPath, $psqlPath)) {
  Require-TestCondition (Test-Path -LiteralPath $application -PathType Leaf) ('Required PostgreSQL 18 application is missing: ' + [IO.Path]::GetFileName($application))
}
$versionText = (& $psqlPath --version | Out-String).Trim()
Require-TestCondition ($versionText -match '^psql \(PostgreSQL\) 18(?:\.\d+)+$') ('Expected PostgreSQL 18 psql; found ' + $versionText)

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$queryPath = Join-Path $repoRoot 'docs/codex/wave13b2-read-only-catalog-preflight.sql'
$queryBytes = [IO.File]::ReadAllBytes($queryPath)
$querySha = Get-Wave13B2F2QuerySha256 -Bytes $queryBytes
$sourceSha = 'a' * 40
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('karturt-wave13b2-f2-pg18-' + [guid]::NewGuid().ToString('N'))
$evidenceRoot = Join-Path $testRoot 'owner-evidence'
$aclCheckerPath = Join-Path $PSScriptRoot 'check-wave13b2-secret-acl.ps1'
$testRootCreated = $false
$serverStarted = $false
$dataDir = Join-Path $testRoot 'data'
$serverLogPath = Join-Path $testRoot 'postgres.log'
$testEnvironment = [System.Collections.Generic.Dictionary[string, string]]::new([StringComparer]::OrdinalIgnoreCase)

try {
  [void][IO.Directory]::CreateDirectory($testRoot)
  Set-TestOwnerOnlyDirectory -Path $testRoot
  Set-TestOwnerOnlyDirectory -Path $evidenceRoot
  $testRootCreated = $true
  $tempRootResolved = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $testRootResolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $testRoot).Path)
  Require-TestCondition ($testRootResolved.StartsWith($tempRootResolved + '\', [StringComparison]::OrdinalIgnoreCase)) 'The test temp root resolved outside the Windows temporary directory.'
  Write-Host ('[PG18] tempRoot=' + $testRootResolved)

  Write-TestStage 'expected-state-preflight-pin-validation'
  $preflightSourceSha = '6' * 40
  $preflightQuerySha = '7' * 64
  $expectedStateSha = '8' * 64
  $expectedStateBytes = 123
  $validPreflightText = 'LOCAL_OFFLINE_PREFLIGHT_PASS source=' + $preflightSourceSha + ' migrations=0 expectedStateSha256=' + $expectedStateSha + ' expectedStateBytes=' + $expectedStateBytes + ' query=' + $preflightQuerySha
  $initialPreflight = ConvertFrom-Wave13B2F2PreflightOutput -Text $validPreflightText -ExpectedSourceSha $preflightSourceSha -ExpectedQuerySha256 $preflightQuerySha
  Require-TestCondition ($initialPreflight.ExpectedStateSha256 -ceq $expectedStateSha -and $initialPreflight.ExpectedStateBytes -eq [long]$expectedStateBytes) 'Valid expected-state preflight metadata did not parse.'
  Require-TestCondition ($initialPreflight.ExpectedStateFile -ceq 'wave13b2-staging-expected-state.local.json') 'Preflight did not bind the expected-state filename.'
  Require-TestCondition (Assert-Wave13B2F2PreflightMetadataMatch -Initial $initialPreflight -Final $initialPreflight) 'Matching expected-state preflight records were rejected.'
  $invalidPreflightTexts = @(
    $validPreflightText.Replace(' expectedStateSha256=' + $expectedStateSha + ' expectedStateBytes=' + $expectedStateBytes, '')
    $validPreflightText.Replace($expectedStateSha, ('A' * 64))
    $validPreflightText.Replace('expectedStateBytes=' + $expectedStateBytes, 'expectedStateBytes=0')
  )
  foreach ($invalidPreflightText in $invalidPreflightTexts) {
    $invalidPreflightRejected = $false
    try {
      [void](ConvertFrom-Wave13B2F2PreflightOutput -Text $invalidPreflightText -ExpectedSourceSha $preflightSourceSha -ExpectedQuerySha256 $preflightQuerySha)
    } catch {
      $invalidPreflightRejected = $_.Exception.Message -ceq 'F2_EXPECTED_STATE_PREFLIGHT_INVALID'
    }
    Require-TestCondition $invalidPreflightRejected 'Missing or malformed expected-state preflight metadata was accepted.'
  }
  foreach ($mismatchedPreflightText in @(
    $validPreflightText.Replace($expectedStateSha, ('9' * 64))
    $validPreflightText.Replace('expectedStateBytes=' + $expectedStateBytes, 'expectedStateBytes=124')
  )) {
    $finalPreflight = ConvertFrom-Wave13B2F2PreflightOutput -Text $mismatchedPreflightText -ExpectedSourceSha $preflightSourceSha -ExpectedQuerySha256 $preflightQuerySha
    $preflightMismatchRejected = $false
    try {
      [void](Assert-Wave13B2F2PreflightMetadataMatch -Initial $initialPreflight -Final $finalPreflight)
    } catch {
      $preflightMismatchRejected = $_.Exception.Message -ceq 'F2_EXPECTED_STATE_PREFLIGHT_MISMATCH'
    }
    Require-TestCondition $preflightMismatchRejected 'Changed expected-state preflight metadata passed the initial/final comparison.'
  }
  Write-Host 'expectedStatePreflight=PASS missing=REJECTED malformed=REJECTED mismatchedSha=REJECTED mismatchedBytes=REJECTED'

  foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
    if ([string]$entry.Key -match '^PG') {
      $testEnvironment[[string]$entry.Key] = [string]$entry.Value
      [Environment]::SetEnvironmentVariable([string]$entry.Key, $null, 'Process')
    }
  }

  [Environment]::SetEnvironmentVariable('PGSSLMODE', 'require', 'Process')
  [Environment]::SetEnvironmentVariable('PGCONNECT_TIMEOUT', '5', 'Process')

  $port = Get-TestLoopbackPort
  $certificatePath = Join-Path $testRoot 'server.crt'
  $privateKeyPath = Join-Path $testRoot 'server.key'
  Write-TestStage 'create-test-only-tls-certificate'
  New-TestTlsCertificate -CertificatePath $certificatePath -PrivateKeyPath $privateKeyPath

  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $aclOutput = @(& icacls.exe $privateKeyPath /inheritance:r /grant:r ('*' + $currentSid + ':(F)'))
  Require-TestCondition ($LASTEXITCODE -eq 0) 'Could not set test-only TLS key ACL.'

  $initdbArguments = @(
    '-D', $dataDir,
    '-U', 'postgres',
    '--no-locale', '--encoding=UTF8',
    '--auth-local=trust', '--auth-host=trust'
  )
  Write-TestStage 'initdb-isolated-cluster'
  [void](Invoke-CheckedProcess -Executable $initdbPath -ArgumentList $initdbArguments -Label 'isolated PostgreSQL 18 initdb')

  $certificateConfigPath = $certificatePath.Replace('\', '/')
  $privateKeyConfigPath = $privateKeyPath.Replace('\', '/')
  $autoConfigPath = Join-Path $dataDir 'postgresql.auto.conf'
  $autoConfig = @(
    "listen_addresses = '127.0.0.1'"
    ('port = ' + $port)
    'ssl = on'
    ("ssl_cert_file = '" + $certificateConfigPath + "'")
    ("ssl_key_file = '" + $privateKeyConfigPath + "'")
    ''
  ) -join "`n"
  [IO.File]::WriteAllText($autoConfigPath, $autoConfig, [Text.UTF8Encoding]::new($false))
  Write-TestStage 'start-isolated-pg18-tls'
  [void](Invoke-CheckedProcess -Executable $pgCtlPath -ArgumentList @('-D', $dataDir, '-l', $serverLogPath, '-w', '-t', '30', 'start') -Label 'isolated PostgreSQL 18 TLS startup')
  $serverStarted = $true

  $adminArguments = @('-X', '-w', '-h', '127.0.0.1', '-p', [string]$port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE ROLE neondb_owner SUPERUSER LOGIN')
  Write-TestStage 'create-isolated-test-role'
  [void](Invoke-CheckedProcess -Executable $psqlPath -ArgumentList $adminArguments -Label 'isolated test role setup')
  $adminArguments = @('-X', '-w', '-h', '127.0.0.1', '-p', [string]$port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE DATABASE neondb OWNER neondb_owner')
  Write-TestStage 'create-isolated-test-database'
  [void](Invoke-CheckedProcess -Executable $psqlPath -ArgumentList $adminArguments -Label 'isolated test database setup')

  Write-TestStage 'passing-connection-and-catalog-guards'
  $terminalTranscriptPath = Join-Path $testRoot 'passing-run.terminal.txt'
  Start-Transcript -LiteralPath $terminalTranscriptPath -Force | Out-Null
  try {
  $pass = Invoke-TestPsqlCase `
    -Name 'passing-guard' `
    -HostAddress '127.0.0.1' `
    -Port $port `
    -InputFile $queryPath `
    -ExpectedStatus 'COMPLETED' `
    -ExpectedFailureCode '' `
    -ExpectedSourceSha $sourceSha `
    -TestRoot $testRoot `
    -EvidenceRoot $evidenceRoot `
    -AclCheckerPath $aclCheckerPath `
    -PsqlPath $psqlPath
  Require-TestCondition ($pass.ExitCode -eq 0) 'The passing guard path did not exit zero.'
  Require-TestCondition ($pass.DiagnosticLines -contains ('F2_DONE PASS source=' + $pass.SourceSha + ' query=' + $pass.QuerySha256)) 'The passing guard path did not reach its exact F2_DONE marker.'
  Require-TestCondition ($pass.DiagnosticLines -contains 'F2_CHECK TLS_ACTIVE PASS') 'The passing guard path did not verify local TLS.'
  } finally {
    Stop-Transcript | Out-Null
  }

  $passEvidence = [IO.File]::ReadAllBytes($pass.EvidencePath)
  $passEvidenceText = [Text.Encoding]::UTF8.GetString($passEvidence)
  $passAuditText = [IO.File]::ReadAllText($pass.AuditPath)
  $terminalText = [IO.File]::ReadAllText($terminalTranscriptPath)
  $passEvidenceSha256 = Get-TestSha256Hex -Bytes $passEvidence
  Require-TestCondition ($pass.EvidenceVerified -and $pass.RunResult.EvidenceVerified) 'The full catalog evidence was not verified after psql completed.'
  Require-TestCondition ($pass.EvidenceBytes -eq $passEvidence.LongLength) 'The owner evidence length does not match the complete saved file.'
  Require-TestCondition ($pass.EvidenceSha256 -ceq $passEvidenceSha256) 'The owner evidence digest does not match the complete saved file.'
  Require-TestCondition ($passEvidenceText.Contains('observed_database_name,expected_database_name,database_name_matches,observed_role') -and $passEvidenceText.Contains('F2_CATALOG_READ SCHEMA_INVENTORY') -and $passEvidenceText.Contains('schema_name,schema_owner,explicit_acl') -and $passEvidenceText.Contains('F2_CATALOG_READ DEFAULT_ACL_INVENTORY')) 'The complete catalog evidence is missing expected preamble or catalog sections.'
  Require-TestCondition ($passEvidenceText.Contains('F2_DONE PASS source=' + $pass.SourceSha + ' query=' + $pass.QuerySha256)) 'The complete owner evidence file is missing the exact F2_DONE line.'
  Require-TestCondition ($pass.EvidencePath.Contains($pass.SourceSha) -and $pass.EvidencePath.Contains($pass.QuerySha256)) 'The owner evidence filename is not bound to the source and query hashes.'
  Require-TestCondition ((@(& $aclCheckerPath -Path $pass.EvidencePath -RequireProtected) -join '').Trim() -eq 'PASS') 'The owner evidence file did not retain its protected ACL.'
  Require-TestCondition ($passAuditText.Contains('evidenceSha256=' + $passEvidenceSha256)) 'The sanitized audit is missing the raw evidence SHA-256.'
  Require-TestCondition (-not $passAuditText.Contains('observed_database_name,expected_database_name,database_name_matches,observed_role') -and -not $passAuditText.Contains('schema_name,schema_owner,explicit_acl')) 'The sanitized audit retained raw catalog CSV headers.'
  Require-TestCondition (-not $terminalText.Contains('observed_database_name,expected_database_name,database_name_matches,observed_role') -and -not $terminalText.Contains('schema_name,schema_owner,explicit_acl')) 'Raw catalog output reached the terminal transcript.'
  Require-TestCondition ('OutputLines' -notin $pass.RunResult.PSObject.Properties.Name) 'The runner result exposed a raw output-lines property.'

  Write-TestStage 'quoted-csv-control-like-field-is-not-a-marker'
  $catalogCanaryBase = 'synthetic_catalog_field_' + [guid]::NewGuid().ToString('N')
  $catalogCanaryDone = 'F2_DONE PASS source=' + ('b' * 40) + ' query=' + ('c' * 64)
  $catalogCanaryFail = 'F2_FAIL SYNTHETIC_CSV_FIELD'
  $catalogCanaryStop = 'F2_STOP SYNTHETIC_CSV_FIELD'
  $catalogCanary = $catalogCanaryBase + "`n" + $catalogCanaryDone + "`n" + $catalogCanaryFail + "`n" + $catalogCanaryStop
  $canarySqlPath = Join-Path $testRoot 'synthetic-multiline-csv-canary.sql'
  $canarySql = @(
    '\set ON_ERROR_STOP on'
    'SELECT $f2_canary$'
    $catalogCanary
    '$f2_canary$ AS synthetic_catalog_field;'
    '\echo F2_DONE PASS source=:approved_source_sha query=:query_packet_sha256'
    ''
  ) -join "`n"
  [IO.File]::WriteAllText($canarySqlPath, $canarySql, [Text.UTF8Encoding]::new($false))
  $canaryTranscriptPath = Join-Path $testRoot 'csv-canary.terminal.txt'
  Start-Transcript -LiteralPath $canaryTranscriptPath -Force | Out-Null
  try {
    $canaryRun = Invoke-TestPsqlCase `
      -Name 'quoted-csv-control-like-field' `
      -HostAddress '127.0.0.1' `
      -Port $port `
      -InputFile $canarySqlPath `
      -ExpectedStatus 'COMPLETED' `
      -ExpectedFailureCode '' `
      -ExpectedSourceSha $sourceSha `
      -TestRoot $testRoot `
      -EvidenceRoot $evidenceRoot `
      -AclCheckerPath $aclCheckerPath `
      -PsqlPath $psqlPath
  } finally {
    Stop-Transcript | Out-Null
  }
  $canaryEvidenceText = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($canaryRun.EvidencePath))
  $canaryAuditText = [IO.File]::ReadAllText($canaryRun.AuditPath)
  $canaryTerminalText = [IO.File]::ReadAllText($canaryTranscriptPath)
  $canaryNormalizedEvidenceText = $canaryEvidenceText.Replace("`r`n", "`n")
  $canaryContainsBase = $canaryNormalizedEvidenceText.Contains($catalogCanaryBase)
  $canaryContainsDone = $canaryNormalizedEvidenceText.Contains($catalogCanaryDone)
  $canaryContainsFail = $canaryNormalizedEvidenceText.Contains($catalogCanaryFail)
  $canaryContainsStop = $canaryNormalizedEvidenceText.Contains($catalogCanaryStop)
  $canaryControlMarkers = @($canaryRun.RunResult.ControlMarkers)
  Require-TestCondition ($canaryRun.EvidenceVerified) 'The quoted multiline CSV evidence did not verify.'
  Require-TestCondition ($canaryContainsBase -and $canaryContainsDone -and $canaryContainsFail -and $canaryContainsStop) ('The full multiline CSV canary field is missing from owner evidence: base=' + $canaryContainsBase + ' done=' + $canaryContainsDone + ' fail=' + $canaryContainsFail + ' stop=' + $canaryContainsStop + ' bytes=' + $canaryRun.EvidenceBytes + ' markers=' + $canaryControlMarkers.Count)
  Require-TestCondition ($canaryControlMarkers.Count -eq 1 -and $canaryControlMarkers[0] -ceq ('F2_DONE PASS source=' + $canaryRun.SourceSha + ' query=' + $canaryRun.QuerySha256)) 'Quoted multiline CSV content was counted as a control marker.'
  Require-TestCondition ($canaryControlMarkers -notcontains $catalogCanaryDone -and $canaryControlMarkers -notcontains $catalogCanaryFail -and $canaryControlMarkers -notcontains $catalogCanaryStop) 'A control-like string inside a quoted CSV field was treated as a control marker.'
  Require-TestCondition (-not $canaryAuditText.Contains($catalogCanary) -and -not $canaryAuditText.Contains($catalogCanaryFail) -and -not $canaryAuditText.Contains($catalogCanaryStop)) 'The sanitized audit retained control-like raw CSV field content.'
  Require-TestCondition (-not $canaryTerminalText.Contains($catalogCanary) -and -not $canaryTerminalText.Contains($catalogCanaryFail) -and -not $canaryTerminalText.Contains($catalogCanaryStop)) 'Raw CSV field content reached the terminal transcript.'

  $exactDoneLine = 'F2_DONE PASS source=' + $pass.SourceSha + ' query=' + $pass.QuerySha256
  [void](Assert-TestF2Classification -Label 'exact-done-exit-zero-evidence-verified' -ExitCode 0 -DiagnosticLines @($exactDoneLine) -ExpectedSourceSha $pass.SourceSha -ExpectedQuerySha $pass.QuerySha256 -EvidenceVerified $true -FailureCodes @() -ExpectedStatus 'COMPLETED')
  [void](Assert-TestF2Classification -Label 'nonzero-exit' -ExitCode 3 -DiagnosticLines @($exactDoneLine) -ExpectedSourceSha $pass.SourceSha -ExpectedQuerySha $pass.QuerySha256 -EvidenceVerified $true -FailureCodes @() -ExpectedStatus 'FAILED')
  [void](Assert-TestF2Classification -Label 'missing-done' -ExitCode 0 -DiagnosticLines @('F2_CHECK TLS_ACTIVE PASS') -ExpectedSourceSha $pass.SourceSha -ExpectedQuerySha $pass.QuerySha256 -EvidenceVerified $true -FailureCodes @() -ExpectedStatus 'FAILED')
  [void](Assert-TestF2Classification -Label 'wrong-source-done' -ExitCode 0 -DiagnosticLines @('F2_DONE PASS source=' + ('b' * 40) + ' query=' + $pass.QuerySha256) -ExpectedSourceSha $pass.SourceSha -ExpectedQuerySha $pass.QuerySha256 -EvidenceVerified $true -FailureCodes @() -ExpectedStatus 'FAILED')
  [void](Assert-TestF2Classification -Label 'wrong-query-done' -ExitCode 0 -DiagnosticLines @('F2_DONE PASS source=' + $pass.SourceSha + ' query=' + ('c' * 64)) -ExpectedSourceSha $pass.SourceSha -ExpectedQuerySha $pass.QuerySha256 -EvidenceVerified $true -FailureCodes @() -ExpectedStatus 'FAILED')
  [void](Assert-TestF2Classification -Label 'duplicate-done' -ExitCode 0 -DiagnosticLines @($exactDoneLine, $exactDoneLine) -ExpectedSourceSha $pass.SourceSha -ExpectedQuerySha $pass.QuerySha256 -EvidenceVerified $true -FailureCodes @() -ExpectedStatus 'FAILED')
  [void](Assert-TestF2Classification -Label 'fail-with-done' -ExitCode 0 -DiagnosticLines @('F2_FAIL SYNTHETIC_GUARD_FAILURE', $exactDoneLine) -ExpectedSourceSha $pass.SourceSha -ExpectedQuerySha $pass.QuerySha256 -EvidenceVerified $true -FailureCodes @('SYNTHETIC_GUARD_FAILURE') -ExpectedStatus 'FAILED')
  [void](Assert-TestF2Classification -Label 'stop-with-done' -ExitCode 0 -DiagnosticLines @('F2_STOP SYNTHETIC_GUARD_FAILURE', $exactDoneLine) -ExpectedSourceSha $pass.SourceSha -ExpectedQuerySha $pass.QuerySha256 -EvidenceVerified $true -FailureCodes @() -ExpectedStatus 'FAILED')
  [void](Assert-TestF2Classification -Label 'unverified-evidence-with-done' -ExitCode 0 -DiagnosticLines @($exactDoneLine) -ExpectedSourceSha $pass.SourceSha -ExpectedQuerySha $pass.QuerySha256 -EvidenceVerified $false -FailureCodes @('F2_EVIDENCE_MISSING') -ExpectedStatus 'FAILED')

  Write-TestStage 'failing-connection-guard'
  $connectionFailure = Invoke-TestPsqlCase `
    -Name 'connection-guard-failure' `
    -HostAddress '127.0.0.1' `
    -Port $port `
    -InputFile $queryPath `
    -TargetBranchId 'br-orange-wrong-00000000' `
    -ExpectedStatus 'FAILED' `
    -ExpectedFailureCode 'TARGET_BRANCH_ID_MISMATCH' `
    -ExpectedSourceSha $sourceSha `
    -TestRoot $testRoot `
    -EvidenceRoot $evidenceRoot `
    -AclCheckerPath $aclCheckerPath `
    -PsqlPath $psqlPath
  Require-TestCondition ($connectionFailure.ExitCode -ne 0) 'The failing connection guard returned psql exit zero.'
  Require-TestCondition ($connectionFailure.DiagnosticLines -contains 'F2_STOP CONNECTION_GUARD_FAILED') 'The connection guard did not report its sanitized stop marker.'
  Require-TestCondition (@($connectionFailure.DiagnosticLines | Where-Object { $_ -match '^F2_CATALOG_READ ' }).Count -eq 0) 'A connection guard failure reached a catalog read.'
  Require-TestCondition ($connectionFailure.DiagnosticLines -contains 'F2_FAIL TARGET_BRANCH_ID_MISMATCH') 'The connection guard did not report its target branch failure.'

  $schemaSetupPath = Join-Path $testRoot 'create-over-limit-schemas.sql'
  $schemaSetup = @'
DO $f2_setup$
BEGIN
  FOR i IN 1..201 LOOP
    EXECUTE format('CREATE SCHEMA f2_over_limit_%s', lpad(i::text, 3, '0'));
  END LOOP;
END
$f2_setup$;
'@
  [IO.File]::WriteAllText($schemaSetupPath, $schemaSetup, [Text.UTF8Encoding]::new($false))
  $setupArguments = @('-X', '-w', '-h', '127.0.0.1', '-p', [string]$port, '-U', 'neondb_owner', '-d', 'neondb', '-v', 'ON_ERROR_STOP=1', '-f', $schemaSetupPath)
  Write-TestStage 'create-isolated-over-limit-schema-fixture'
  [void](Invoke-CheckedProcess -Executable $psqlPath -ArgumentList $setupArguments -Label 'isolated schema over-limit fixture setup')

  Write-TestStage 'failing-schema-output-guard'
  $schemaFailure = Invoke-TestPsqlCase `
    -Name 'schema-output-guard-failure' `
    -HostAddress '127.0.0.1' `
    -Port $port `
    -InputFile $queryPath `
    -ExpectedStatus 'FAILED' `
    -ExpectedFailureCode 'SCHEMA_OUTPUT_LIMIT_EXCEEDED' `
    -ExpectedSourceSha $sourceSha `
    -TestRoot $testRoot `
    -EvidenceRoot $evidenceRoot `
    -AclCheckerPath $aclCheckerPath `
    -PsqlPath $psqlPath
  Require-TestCondition ($schemaFailure.ExitCode -ne 0) 'The failing output guard returned psql exit zero.'
  Require-TestCondition ($schemaFailure.DiagnosticLines -contains 'F2_CATALOG_READ SCHEMA_LIMIT_COUNT') 'The failing schema guard did not show its count read marker.'
  Require-TestCondition ($schemaFailure.DiagnosticLines -contains 'F2_FAIL SCHEMA_OUTPUT_LIMIT_EXCEEDED') 'The failing schema guard lost its specific failure code.'
  Require-TestCondition (@($schemaFailure.DiagnosticLines | Where-Object { $_ -match '^F2_CATALOG_READ SCHEMA_INVENTORY$|^F2_CATALOG_READ (RELATION|TYPE|ROUTINE|EXTENSION|DEFAULT_ACL)_' }).Count -eq 0) 'A catalog read continued after the schema output guard failed.'

  $unusedHostPort = Get-TestLoopbackPort -Address ([Net.IPAddress]::Parse('127.0.0.2'))
  Write-TestStage 'terminal-connection-failure'
  $terminalFailure = Invoke-TestPsqlCase `
    -Name 'terminal-connection-failure' `
    -HostAddress '127.0.0.2' `
    -Port $unusedHostPort `
    -InputFile $queryPath `
    -ExpectedStatus 'FAILED' `
    -ExpectedFailureCode '' `
    -ExpectedSourceSha $sourceSha `
    -TestRoot $testRoot `
    -EvidenceRoot $evidenceRoot `
    -AclCheckerPath $aclCheckerPath `
    -PsqlPath $psqlPath
  Require-TestCondition ($terminalFailure.ExitCode -ne 0) 'The terminal connection failure unexpectedly returned psql exit zero.'

  $legacyScriptPath = Join-Path $testRoot 'legacy-quit-3.sql'
  $legacyScript = @(
    '\set ON_ERROR_STOP on'
    '\echo F2_FAIL LEGACY_QUIT_3'
    '\quit 3'
    '\echo F2_CATALOG_READ MUST_NOT_RUN'
    ''
  ) -join "`n"
  [IO.File]::WriteAllText($legacyScriptPath, $legacyScript, [Text.UTF8Encoding]::new($false))
  Write-TestStage 'legacy-quit-zero-exit-classification'
  $legacy = Invoke-TestPsqlCase `
    -Name 'legacy-quit-3' `
    -HostAddress '127.0.0.1' `
    -Port $port `
    -InputFile $legacyScriptPath `
    -ExpectedStatus 'FAILED' `
    -ExpectedFailureCode '' `
    -ExpectedSourceSha $sourceSha `
    -TestRoot $testRoot `
    -EvidenceRoot $evidenceRoot `
    -AclCheckerPath $aclCheckerPath `
    -PsqlPath $psqlPath
  Require-TestCondition ($legacy.ExitCode -eq 0) 'The legacy \quit 3 test no longer demonstrates psql exit zero.'
  Require-TestCondition ($legacy.DiagnosticLines -notcontains 'F2_CATALOG_READ MUST_NOT_RUN') 'psql did not stop at the legacy quit command.'
  Require-TestCondition ($legacy.Status -ceq 'FAILED') 'The runner misclassified the legacy exit-zero stop as successful.'

  Write-TestStage 'missing-evidence-fails-closed'
  $missingSourceSha = 'd' * 40
  $missingQuerySha = 'e' * 64
  $missingDone = 'F2_DONE PASS source=' + $missingSourceSha + ' query=' + $missingQuerySha
  $missingAttemptRoot = Get-TestAttemptDirectory -BasePath $evidenceRoot -SourceSha $missingSourceSha
  $missingPath = Join-Path $missingAttemptRoot ('wave13b2-f2-catalog-evidence-' + $missingSourceSha + '-' + $missingQuerySha + '.local.txt')
  $missingVerification = Get-Wave13B2F2OwnerEvidenceVerification `
    -Path $missingPath `
    -AclCheckerPath $aclCheckerPath `
    -ExpectedSourceSha $missingSourceSha `
    -ExpectedQuerySha256 $missingQuerySha `
    -ExpectedLength 1 `
    -ExpectedSha256 ('0' * 64)
  Require-TestCondition (-not $missingVerification.Verified) 'A missing owner evidence file passed verification.'
  Require-TestCondition (@($missingVerification.FailureCodes | Where-Object { $_ -match 'MISSING' }).Count -gt 0) 'A missing evidence file did not report a specific failure code.'
  [void](Assert-TestF2Classification -Label 'missing-evidence-with-exact-done' -ExitCode 0 -DiagnosticLines @($missingDone) -ExpectedSourceSha $missingSourceSha -ExpectedQuerySha $missingQuerySha -EvidenceVerified $missingVerification.Verified -FailureCodes $missingVerification.FailureCodes -ExpectedStatus 'FAILED')

  $syntheticSourceSha = 'f' * 40
  $syntheticQuerySha = '1' * 64
  $syntheticDone = 'F2_DONE PASS source=' + $syntheticSourceSha + ' query=' + $syntheticQuerySha
  $syntheticEvidenceBytes = [Text.UTF8Encoding]::new($false).GetBytes("synthetic_catalog_row=owner_only`n$syntheticDone`n")
  $syntheticEvidenceSha = Get-TestSha256Hex -Bytes $syntheticEvidenceBytes
  $syntheticAttemptRoot = Get-TestAttemptDirectory -BasePath $evidenceRoot -SourceSha $syntheticSourceSha
  $syntheticEvidencePath = Join-Path $syntheticAttemptRoot ('wave13b2-f2-catalog-evidence-' + $syntheticSourceSha + '-' + $syntheticQuerySha + '.local.txt')
  $syntheticEvidenceCreate = New-Wave13B2F2OwnerEvidenceFile -Path $syntheticEvidencePath -AclCheckerPath $aclCheckerPath -ExpectedSourceSha $syntheticSourceSha -ExpectedQuerySha256 $syntheticQuerySha
  Require-TestCondition ($null -ne $syntheticEvidenceCreate.Stream) ('Could not create synthetic owner evidence: ' + ($syntheticEvidenceCreate.FailureCodes -join ','))
  try {
    $syntheticEvidenceCreate.Stream.Write($syntheticEvidenceBytes, 0, $syntheticEvidenceBytes.Length)
    $syntheticEvidenceCreate.Stream.Flush($true)
  } finally {
    $syntheticEvidenceCreate.Stream.Dispose()
  }

  Write-TestStage 'evidence-create-only'
  $evidenceBeforeDuplicateCreate = Get-TestSha256Hex -Bytes ([IO.File]::ReadAllBytes($syntheticEvidencePath))
  $duplicateEvidence = New-Wave13B2F2OwnerEvidenceFile -Path $syntheticEvidencePath -AclCheckerPath $aclCheckerPath -ExpectedSourceSha $syntheticSourceSha -ExpectedQuerySha256 $syntheticQuerySha
  $duplicateEvidenceCreateDenied = $null -eq $duplicateEvidence.Stream -and @($duplicateEvidence.FailureCodes | Where-Object { $_ -match 'CREATE_FAILED' }).Count -gt 0
  if ($null -ne $duplicateEvidence.Stream) { $duplicateEvidence.Stream.Dispose() }
  Require-TestCondition $duplicateEvidenceCreateDenied 'Owner evidence creation overwrote or reopened an existing source/query-bound file.'
  Require-TestCondition ((Get-TestSha256Hex -Bytes ([IO.File]::ReadAllBytes($syntheticEvidencePath))) -ceq $evidenceBeforeDuplicateCreate) 'A rejected create-only evidence attempt changed prior evidence bytes.'

  Write-TestStage 'tampered-evidence-fails-closed'
  $initialSyntheticVerification = Get-Wave13B2F2OwnerEvidenceVerification `
    -Path $syntheticEvidencePath `
    -AclCheckerPath $aclCheckerPath `
    -ExpectedSourceSha $syntheticSourceSha `
    -ExpectedQuerySha256 $syntheticQuerySha `
    -ExpectedLength $syntheticEvidenceBytes.LongLength `
    -ExpectedSha256 $syntheticEvidenceSha
  try {
    Require-TestCondition $initialSyntheticVerification.Verified 'The intact synthetic owner evidence did not verify.'
  } finally {
    if ($null -ne $initialSyntheticVerification.ReadLock) { $initialSyntheticVerification.ReadLock.Dispose() }
  }
  $tamperedEvidenceBytes = [IO.File]::ReadAllBytes($syntheticEvidencePath)
  $tamperedEvidenceBytes[0] = [byte]([int]$tamperedEvidenceBytes[0] -bxor 1)
  [IO.File]::WriteAllBytes($syntheticEvidencePath, $tamperedEvidenceBytes)
  $tamperedVerification = Get-Wave13B2F2OwnerEvidenceVerification `
    -Path $syntheticEvidencePath `
    -AclCheckerPath $aclCheckerPath `
    -ExpectedSourceSha $syntheticSourceSha `
    -ExpectedQuerySha256 $syntheticQuerySha `
    -ExpectedLength $syntheticEvidenceBytes.LongLength `
    -ExpectedSha256 $syntheticEvidenceSha
  try {
    Require-TestCondition (-not $tamperedVerification.Verified) 'Tampered evidence passed SHA-256 verification.'
    Require-TestCondition (@($tamperedVerification.FailureCodes | Where-Object { $_ -match 'HASH_MISMATCH' }).Count -gt 0) 'Tampered evidence did not report a digest mismatch.'
    [void](Assert-TestF2Classification -Label 'tampered-evidence-with-exact-done' -ExitCode 0 -DiagnosticLines @($syntheticDone) -ExpectedSourceSha $syntheticSourceSha -ExpectedQuerySha $syntheticQuerySha -EvidenceVerified $tamperedVerification.Verified -FailureCodes $tamperedVerification.FailureCodes -ExpectedStatus 'FAILED')
  } finally {
    if ($null -ne $tamperedVerification.ReadLock) { $tamperedVerification.ReadLock.Dispose() }
  }

  Write-TestStage 'acl-mismatch-fails-closed'
  $aclSourceSha = '2' * 40
  $aclQuerySha = '3' * 64
  $aclDone = 'F2_DONE PASS source=' + $aclSourceSha + ' query=' + $aclQuerySha
  $aclAttemptRoot = Get-TestAttemptDirectory -BasePath $evidenceRoot -SourceSha $aclSourceSha
  $aclEvidencePath = Join-Path $aclAttemptRoot ('wave13b2-f2-catalog-evidence-' + $aclSourceSha + '-' + $aclQuerySha + '.local.txt')
  [IO.File]::WriteAllBytes($aclEvidencePath, $syntheticEvidenceBytes)
  Require-TestCondition (-not (Get-Acl -LiteralPath $aclEvidencePath).AreAccessRulesProtected) 'The inherited-ACL mismatch fixture is unexpectedly protected.'
  $aclVerification = Get-Wave13B2F2OwnerEvidenceVerification `
    -Path $aclEvidencePath `
    -AclCheckerPath $aclCheckerPath `
    -ExpectedSourceSha $aclSourceSha `
    -ExpectedQuerySha256 $aclQuerySha `
    -ExpectedLength $syntheticEvidenceBytes.LongLength `
    -ExpectedSha256 $syntheticEvidenceSha
  Require-TestCondition (-not $aclVerification.Verified) 'An evidence file with inherited ACLs passed verification.'
  Require-TestCondition (@($aclVerification.FailureCodes | Where-Object { $_ -match 'ACL_MISMATCH' }).Count -gt 0) 'The ACL mismatch did not produce a bounded failure code.'
  [void](Assert-TestF2Classification -Label 'acl-mismatch-with-exact-done' -ExitCode 0 -DiagnosticLines @($aclDone) -ExpectedSourceSha $aclSourceSha -ExpectedQuerySha $aclQuerySha -EvidenceVerified $aclVerification.Verified -FailureCodes $aclVerification.FailureCodes -ExpectedStatus 'FAILED')

  Write-TestStage 'truncated-evidence-fails-closed'
  $truncatedSourceSha = '4' * 40
  $truncatedQuerySha = '5' * 64
  $truncatedDone = 'F2_DONE PASS source=' + $truncatedSourceSha + ' query=' + $truncatedQuerySha
  $truncatedEvidenceBytes = [Text.UTF8Encoding]::new($false).GetBytes("synthetic_catalog_row=complete-before-truncation`n$truncatedDone`n")
  $truncatedEvidenceSha = Get-TestSha256Hex -Bytes $truncatedEvidenceBytes
  $truncatedAttemptRoot = Get-TestAttemptDirectory -BasePath $evidenceRoot -SourceSha $truncatedSourceSha
  $truncatedEvidencePath = Join-Path $truncatedAttemptRoot ('wave13b2-f2-catalog-evidence-' + $truncatedSourceSha + '-' + $truncatedQuerySha + '.local.txt')
  $truncatedEvidenceCreate = New-Wave13B2F2OwnerEvidenceFile -Path $truncatedEvidencePath -AclCheckerPath $aclCheckerPath -ExpectedSourceSha $truncatedSourceSha -ExpectedQuerySha256 $truncatedQuerySha
  Require-TestCondition ($null -ne $truncatedEvidenceCreate.Stream) ('Could not create truncated test evidence: ' + ($truncatedEvidenceCreate.FailureCodes -join ','))
  try {
    $truncatedEvidenceCreate.Stream.Write($truncatedEvidenceBytes, 0, $truncatedEvidenceBytes.Length)
    $truncatedEvidenceCreate.Stream.Flush($true)
  } finally {
    $truncatedEvidenceCreate.Stream.Dispose()
  }
  $truncateStream = [IO.File]::Open($truncatedEvidencePath, [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $truncateStream.SetLength($truncatedEvidenceBytes.LongLength - 1)
    $truncateStream.Flush($true)
  } finally {
    $truncateStream.Dispose()
  }
  $truncatedVerification = Get-Wave13B2F2OwnerEvidenceVerification `
    -Path $truncatedEvidencePath `
    -AclCheckerPath $aclCheckerPath `
    -ExpectedSourceSha $truncatedSourceSha `
    -ExpectedQuerySha256 $truncatedQuerySha `
    -ExpectedLength $truncatedEvidenceBytes.LongLength `
    -ExpectedSha256 $truncatedEvidenceSha
  try {
    Require-TestCondition (-not $truncatedVerification.Verified) 'A truncated evidence file passed verification.'
    Require-TestCondition (@($truncatedVerification.FailureCodes | Where-Object { $_ -match 'LENGTH_MISMATCH|HASH_MISMATCH' }).Count -gt 0) 'Truncated evidence did not report a length or digest mismatch.'
    [void](Assert-TestF2Classification -Label 'truncated-evidence-with-exact-done' -ExitCode 0 -DiagnosticLines @($truncatedDone) -ExpectedSourceSha $truncatedSourceSha -ExpectedQuerySha $truncatedQuerySha -EvidenceVerified $truncatedVerification.Verified -FailureCodes $truncatedVerification.FailureCodes -ExpectedStatus 'FAILED')
  } finally {
    if ($null -ne $truncatedVerification.ReadLock) { $truncatedVerification.ReadLock.Dispose() }
  }

  Write-TestStage 'sql-error-fails-closed'
  $sqlErrorPath = Join-Path $testRoot 'synthetic-sql-error.sql'
  $sqlErrorScript = @(
    '\set ON_ERROR_STOP on'
    'SELECT 1 / 0;'
    '\echo F2_DONE PASS source=:approved_source_sha query=:query_packet_sha256'
    ''
  ) -join "`n"
  [IO.File]::WriteAllText($sqlErrorPath, $sqlErrorScript, [Text.UTF8Encoding]::new($false))
  $sqlError = Invoke-TestPsqlCase `
    -Name 'synthetic-sql-error' `
    -HostAddress '127.0.0.1' `
    -Port $port `
    -InputFile $sqlErrorPath `
    -ExpectedStatus 'FAILED' `
    -ExpectedFailureCode 'F2_PSQL_EXIT_CODE_3' `
    -ExpectedSourceSha $sourceSha `
    -TestRoot $testRoot `
    -EvidenceRoot $evidenceRoot `
    -AclCheckerPath $aclCheckerPath `
    -PsqlPath $psqlPath
  Require-TestCondition ($sqlError.ExitCode -ne 0) 'The synthetic SQL error returned exit zero.'
  Require-TestCondition ($sqlError.DiagnosticLines -notcontains ('F2_DONE PASS source=' + $sqlError.SourceSha + ' query=' + $sqlError.QuerySha256)) 'psql reported F2_DONE after stopping on the synthetic SQL error.'

  Write-TestStage 'interrupted-query-times-out-fail-closed'
  $interruptedSqlPath = Join-Path $testRoot 'synthetic-interrupted-query.sql'
  $interruptedSql = @(
    '\set ON_ERROR_STOP on'
    '\echo F2_CATALOG_READ SYNTHETIC_LONG_QUERY'
    'SELECT pg_sleep(60);'
    '\echo F2_DONE PASS source=:approved_source_sha query=:query_packet_sha256'
    ''
  ) -join "`n"
  [IO.File]::WriteAllText($interruptedSqlPath, $interruptedSql, [Text.UTF8Encoding]::new($false))
  $interrupted = Invoke-TestPsqlCase `
    -Name 'synthetic-query-interruption' `
    -HostAddress '127.0.0.1' `
    -Port $port `
    -InputFile $interruptedSqlPath `
    -ExpectedStatus 'FAILED' `
    -ExpectedFailureCode 'TIMEOUT' `
    -ExpectedSourceSha $sourceSha `
    -TestRoot $testRoot `
    -EvidenceRoot $evidenceRoot `
    -AclCheckerPath $aclCheckerPath `
    -PsqlPath $psqlPath `
    -TimeoutSeconds 2
  Require-TestCondition ($interrupted.RunResult.PsqlStarted) 'The interruption case did not start psql.'
  Require-TestCondition ($interrupted.RunResult.PSObject.Properties.Name -contains 'ProcessId') 'The runner did not report the bounded test process identifier.'
  Require-TestCondition ($interrupted.DiagnosticLines -notcontains ('F2_DONE PASS source=' + $interrupted.SourceSha + ' query=' + $interrupted.QuerySha256)) 'The interrupted query unexpectedly reached F2_DONE.'

  Write-TestStage 'attempt-marker-create-only-and-preserved'
  $markerPath = Join-Path $syntheticAttemptRoot ('wave13b2-f2-query-attempt-' + $syntheticSourceSha + '.local.txt')
  $markerPrefix = "status=STARTED`nsignedApprovalDigest=" + ('a' * 64) + "`nsourceSha=$syntheticSourceSha`n"
  $markerBytes = [Text.UTF8Encoding]::new($false).GetBytes($markerPrefix)
  $ownerMarker = [IO.File]::Open($markerPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $ownerMarker.Write($markerBytes, 0, $markerBytes.Length)
    $ownerMarker.Flush($true)
  } finally {
    $ownerMarker.Dispose()
  }
  Set-TestOwnerOnlyFile -Path $markerPath
  $markerBefore = Get-TestSha256Hex -Bytes ([IO.File]::ReadAllBytes($markerPath))
  $duplicateMarkerDenied = $false
  try {
    $duplicateMarker = [IO.File]::Open($markerPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $duplicateMarker.Dispose()
  } catch {
    $duplicateMarkerDenied = $true
  }
  Require-TestCondition $duplicateMarkerDenied 'An existing source attempt marker was reopened with CreateNew.'
  Require-TestCondition ((Get-TestSha256Hex -Bytes ([IO.File]::ReadAllBytes($markerPath))) -ceq $markerBefore) 'A duplicate attempt changed the existing owner marker or approval digest.'

  Write-TestStage 'tampered-query-denial'
  $tamperedBytes = [byte[]]$queryBytes.Clone()
  $tamperedBytes[0] = [byte]([int]$tamperedBytes[0] -bxor 1)
  $tamperDenied = $false
  $tamperStartSentinel = Join-Path $testRoot 'tampered-query-psql-started.txt'
  try {
    Assert-Wave13B2F2QueryDigest -Bytes $tamperedBytes -ExpectedSha256 $querySha
    [IO.File]::WriteAllText($tamperStartSentinel, 'psql started')
  } catch {
    $tamperDenied = $true
  }
  Require-TestCondition $tamperDenied 'Tampered query bytes were not rejected before psql.'
  Require-TestCondition (-not (Test-Path -LiteralPath $tamperStartSentinel)) 'The tampered-query path reached the psql start sentinel.'
  $tamperClassification = Assert-TestF2Classification -Label 'tampered-query-denial' -ExitCode -1 -DiagnosticLines @('F2_FAIL QUERY_SOURCE_DIGEST_MISMATCH') -ExpectedSourceSha $sourceSha -ExpectedQuerySha $querySha -EvidenceVerified $false -FailureCodes @('QUERY_SOURCE_DIGEST_MISMATCH', 'F2_EVIDENCE_MISSING') -ExpectedStatus 'FAILED'
  $tamperAttemptRoot = Get-TestAttemptDirectory -BasePath $evidenceRoot -SourceSha $sourceSha
  $tamperMarkerPath = Join-Path $tamperAttemptRoot ('wave13b2-f2-query-attempt-' + $sourceSha + '.local.txt')
  [IO.File]::WriteAllText($tamperMarkerPath, "status=STARTED`nsourceSha=$sourceSha`nqueryPacketSha256=$querySha`nsignedApprovalDigest=$(('b' * 64))`n", [Text.UTF8Encoding]::new($false))
  Set-TestOwnerOnlyFile -Path $tamperMarkerPath
  $tamperRun = [pscustomobject]@{ ExitCode = -1; PsqlStarted = $false; EvidencePath = ''; DiagnosticLines = [string[]]@('F2_FAIL QUERY_SOURCE_DIGEST_MISMATCH'); FailureCodes = [string[]]@('QUERY_SOURCE_DIGEST_MISMATCH', 'F2_EVIDENCE_MISSING'); EvidenceVerified = $false; EvidenceBytes = 0; EvidenceSha256 = $null; StderrBytes = 0; StderrSha256 = ('0' * 64) }
  Add-Wave13B2F2AttemptResult -MarkerPath $tamperMarkerPath -RunResult $tamperRun -Classification $tamperClassification -AuditFileName 'unavailable' -AuditSha256 'unavailable'
  Assert-TestMarkerStatus -Path $tamperMarkerPath -ExpectedStatus 'FAILED' -Label 'tampered-query'

  Write-Output 'WAVE13B2_F2_PG18_REGRESSION_PASS'
  Write-Output ('querySha256=' + $querySha)
  Write-Output ('passingGuard=COMPLETED psqlExitCode=' + $pass.ExitCode + ' F2_DONE=PASS TLS=PASS')
  Write-Output ('connectionGuard=FAILED psqlExitCode=' + $connectionFailure.ExitCode + ' failure=TARGET_BRANCH_ID_MISMATCH laterCatalogReads=0')
  Write-Output ('schemaOutputGuard=FAILED psqlExitCode=' + $schemaFailure.ExitCode + ' failure=SCHEMA_OUTPUT_LIMIT_EXCEEDED laterInventoryReads=0')
  Write-Output ('terminalConnection=FAILED psqlExitCode=' + $terminalFailure.ExitCode)
  Write-Output ('legacyQuit3=FAILED psqlExitCode=' + $legacy.ExitCode + ' laterCatalogReads=0')
  Write-Output ('ownerEvidence=VERIFIED bytes=' + $pass.EvidenceBytes + ' sha256=' + $pass.EvidenceSha256 + ' terminalRawOutput=ABSENT')
  Write-Output 'evidenceFailures=missing,tampered,acl-mismatch,truncated all=FAILED'
  Write-Output ('sqlError=FAILED exit=' + $sqlError.ExitCode + ' interruption=FAILED timeoutSeconds=2')
  Write-Output 'classifier=exact-F2_DONE+exit-zero+verified-evidence+no-FAIL-or-STOP enforced'
  Write-Output 'attemptMarker=create-only existing-signature-digest-preserved'
  Write-Output 'queryTamper=FAILED psqlStarted=false'
} finally {
  if ($serverStarted) {
    [void](& $pgCtlPath -D $dataDir -m fast -w -t 30 stop 2>&1)
  }
  foreach ($entry in $testEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
  if ($testRootCreated) {
    $verifiedRoot = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $testRoot).Path)
    $verifiedTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
    Require-TestCondition ($verifiedRoot -ceq [IO.Path]::GetFullPath($testRoot)) 'Refusing test cleanup because the resolved temp root changed.'
    Require-TestCondition ($verifiedRoot.StartsWith($verifiedTempRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'Refusing test cleanup outside the Windows temporary directory.'
    Require-TestCondition ($verifiedRoot -match '\\karturt-wave13b2-f2-pg18-[a-f0-9]{32}$') 'Refusing test cleanup because the root does not match this harness UUID.'
    Remove-Item -LiteralPath $verifiedRoot -Recurse -Force
  }
}
