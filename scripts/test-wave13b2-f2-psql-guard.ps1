[CmdletBinding()]
param(
  [string]$PostgresBin = 'C:\Program Files\PostgreSQL\18\bin'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Import-Module (Join-Path $PSScriptRoot 'lib/wave13b2-f2-runner.psm1') -Force

function Require-TestCondition([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
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
  [string]$PsqlPath
) {
  $markerPath = Join-Path $TestRoot ($Name + '.attempt.local.txt')
  $auditPath = Join-Path $TestRoot ($Name + '.audit.local.txt')
  [IO.File]::WriteAllText($markerPath, "status=STARTED`n", [Text.UTF8Encoding]::new($false))
  $arguments = @(
    '-X', '-w', '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1',
    '-h', $HostAddress, '-p', [string]$Port, '-d', 'neondb', '-U', 'neondb_owner',
    '-v', 'owner_signed_query_approval_verified=on',
    '-v', 'target_project_id=broad-star-40451875',
    '-v', ('target_branch_id=' + $TargetBranchId),
    '-v', 'target_endpoint_id=ep-mute-firefly-azjcru4h',
    '-v', ('approved_source_sha=' + $ExpectedSourceSha),
    '-v', ('query_packet_sha256=' + $ExpectedQuerySha),
    '-v', 'expected_database=neondb',
    '-v', 'expected_owner_role=neondb_owner',
    '-f', $InputFile
  )
  $runResult = Invoke-Wave13B2F2Psql -PsqlExecutable $PsqlPath -ArgumentList $arguments
  $classification = Get-Wave13B2F2RunClassification `
    -ExitCode $runResult.ExitCode `
    -OutputLines $runResult.OutputLines `
    -ExpectedSourceSha $ExpectedSourceSha `
    -ExpectedQuerySha256 $ExpectedQuerySha
  $auditContent = New-Wave13B2F2AuditContent `
    -SourceSha $ExpectedSourceSha `
    -QuerySha256 $ExpectedQuerySha `
    -RunResult $runResult `
    -Classification $classification
  $auditSha = Write-Wave13B2F2AuditEvidence -Path $auditPath -Content $auditContent
  Add-Wave13B2F2AttemptResult `
    -MarkerPath $markerPath `
    -RunResult $runResult `
    -Classification $classification `
    -AuditFileName ([IO.Path]::GetFileName($auditPath)) `
    -AuditSha256 $auditSha

  Assert-TestMarkerStatus -Path $markerPath -ExpectedStatus $ExpectedStatus -Label $Name
  Require-TestCondition ($classification.Status -ceq $ExpectedStatus) ($Name + ' classification did not match its expected result.')
  if ($ExpectedFailureCode) {
    Require-TestCondition ($classification.FailureCodes -contains $ExpectedFailureCode) ($Name + ' lost the specific F2_FAIL code.')
    Require-TestCondition ([IO.File]::ReadAllText($auditPath).Contains('F2_FAIL ' + $ExpectedFailureCode)) ($Name + ' audit evidence lost the specific F2_FAIL code.')
  }
  return [pscustomobject]@{
    Name = $Name
    ExitCode = $runResult.ExitCode
    Status = $classification.Status
    FailureCodes = [string[]]$classification.FailureCodes
    OutputLines = [string[]]$runResult.OutputLines
    AuditPath = $auditPath
    MarkerPath = $markerPath
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
$testRootCreated = $false
$serverStarted = $false
$dataDir = Join-Path $testRoot 'data'
$serverLogPath = Join-Path $testRoot 'postgres.log'
$testEnvironment = [System.Collections.Generic.Dictionary[string, string]]::new([StringComparer]::OrdinalIgnoreCase)

try {
  [void][IO.Directory]::CreateDirectory($testRoot)
  $testRootCreated = $true
  $tempRootResolved = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  $testRootResolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $testRoot).Path)
  Require-TestCondition ($testRootResolved.StartsWith($tempRootResolved + '\', [StringComparison]::OrdinalIgnoreCase)) 'The test temp root resolved outside the Windows temporary directory.'
  Write-Host ('[PG18] tempRoot=' + $testRootResolved)

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
  $pass = Invoke-TestPsqlCase `
    -Name 'passing-guard' `
    -HostAddress '127.0.0.1' `
    -Port $port `
    -InputFile $queryPath `
    -ExpectedStatus 'COMPLETED' `
    -ExpectedFailureCode '' `
    -ExpectedSourceSha $sourceSha `
    -ExpectedQuerySha $querySha `
    -TestRoot $testRoot `
    -PsqlPath $psqlPath
  Require-TestCondition ($pass.ExitCode -eq 0) 'The passing guard path did not exit zero.'
  Require-TestCondition ($pass.OutputLines -contains ('F2_DONE PASS source=' + $sourceSha + ' query=' + $querySha)) 'The passing guard path did not reach its exact F2_DONE marker.'
  Require-TestCondition ($pass.OutputLines -contains 'F2_CHECK TLS_ACTIVE PASS') 'The passing guard path did not verify local TLS.'

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
    -ExpectedQuerySha $querySha `
    -TestRoot $testRoot `
    -PsqlPath $psqlPath
  Require-TestCondition ($connectionFailure.ExitCode -ne 0) 'The failing connection guard returned psql exit zero.'
  Require-TestCondition ($connectionFailure.OutputLines -contains 'F2_STOP CONNECTION_GUARD_FAILED CATALOG_QUERIES_SKIPPED') 'The connection guard did not report its stop marker.'
  Require-TestCondition (@($connectionFailure.OutputLines | Where-Object { $_ -match '^F2_CATALOG_READ ' }).Count -eq 0) 'A connection guard failure reached a catalog read.'
  Require-TestCondition ($connectionFailure.OutputLines -contains 'F2_FAIL TARGET_BRANCH_ID_MISMATCH') 'The connection guard did not report its target branch failure.'

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
    -ExpectedQuerySha $querySha `
    -TestRoot $testRoot `
    -PsqlPath $psqlPath
  Require-TestCondition ($schemaFailure.ExitCode -ne 0) 'The failing output guard returned psql exit zero.'
  Require-TestCondition ($schemaFailure.OutputLines -contains 'F2_CATALOG_READ SCHEMA_LIMIT_COUNT') 'The failing schema guard did not show its count read marker.'
  Require-TestCondition ($schemaFailure.OutputLines -contains 'F2_FAIL SCHEMA_OUTPUT_LIMIT_EXCEEDED') 'The failing schema guard lost its specific failure code.'
  Require-TestCondition (@($schemaFailure.OutputLines | Where-Object { $_ -match '^F2_CATALOG_READ SCHEMA_INVENTORY$|^F2_CATALOG_READ (RELATION|TYPE|ROUTINE|EXTENSION|DEFAULT_ACL)_' }).Count -eq 0) 'A catalog read continued after the schema output guard failed.'

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
    -ExpectedQuerySha $querySha `
    -TestRoot $testRoot `
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
    -ExpectedQuerySha $querySha `
    -TestRoot $testRoot `
    -PsqlPath $psqlPath
  Require-TestCondition ($legacy.ExitCode -eq 0) 'The legacy \quit 3 test no longer demonstrates psql exit zero.'
  Require-TestCondition ($legacy.OutputLines -notcontains 'F2_CATALOG_READ MUST_NOT_RUN') 'psql did not stop at the legacy quit command.'
  Require-TestCondition ($legacy.Status -ceq 'FAILED') 'The runner misclassified the legacy exit-zero stop as successful.'

  Write-TestStage 'query-tamper-denial'
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
  $tamperRun = [pscustomobject]@{ ExitCode = -1; OutputLines = [string[]]@('F2_FAIL QUERY_SOURCE_DIGEST_MISMATCH') }
  $tamperClassification = Get-Wave13B2F2RunClassification -ExitCode -1 -OutputLines $tamperRun.OutputLines -ExpectedSourceSha $sourceSha -ExpectedQuerySha256 $querySha
  $tamperMarkerPath = Join-Path $testRoot 'tampered-query.attempt.local.txt'
  [IO.File]::WriteAllText($tamperMarkerPath, "status=STARTED`n", [Text.UTF8Encoding]::new($false))
  Add-Wave13B2F2AttemptResult -MarkerPath $tamperMarkerPath -RunResult $tamperRun -Classification $tamperClassification -AuditFileName 'unavailable' -AuditSha256 'unavailable'
  Assert-TestMarkerStatus -Path $tamperMarkerPath -ExpectedStatus 'FAILED' -Label 'tampered-query'

  Write-TestStage 'sanitized-audit-evidence'
  $syntheticOutput = [string[]]@(
    'F2_FAIL SCHEMA_OUTPUT_LIMIT_EXCEEDED',
    'F2_STOP CATALOG_QUERIES_SKIPPED',
    'F2_CATALOG_READ SCHEMA_LIMIT_COUNT',
    'F2_CHECK SCHEMA_OUTPUT_LIMIT count=202 limit=200',
    'schema_name=private_test_schema',
    'password=synthetic-secret-never-persist',
    'ERROR: F2_STOP SCHEMA_OUTPUT_LIMIT_EXCEEDED'
  )
  $syntheticRun = [pscustomobject]@{ ExitCode = 3; OutputLines = $syntheticOutput }
  $syntheticClassification = Get-Wave13B2F2RunClassification -ExitCode 3 -OutputLines $syntheticOutput -ExpectedSourceSha $sourceSha -ExpectedQuerySha256 $querySha
  $syntheticAudit = New-Wave13B2F2AuditContent -SourceSha $sourceSha -QuerySha256 $querySha -RunResult $syntheticRun -Classification $syntheticClassification
  Require-TestCondition ($syntheticAudit.Contains('F2_FAIL SCHEMA_OUTPUT_LIMIT_EXCEEDED')) 'Sanitized evidence lost the specific F2_FAIL code.'
  Require-TestCondition ($syntheticAudit.Contains('F2_CHECK SCHEMA_OUTPUT_LIMIT count=202 limit=200')) 'Sanitized evidence lost a safe F2_CHECK marker.'
  Require-TestCondition (-not $syntheticAudit.Contains('private_test_schema')) 'Sanitized evidence retained catalog result data.'
  Require-TestCondition (-not $syntheticAudit.Contains('synthetic-secret-never-persist')) 'Sanitized evidence retained a secret-like value.'
  Require-TestCondition ($syntheticAudit.Contains('capturedOutputSuppressedLineCount=2')) 'Sanitized evidence did not account for suppressed output lines.'

  Write-Output 'WAVE13B2_F2_PG18_REGRESSION_PASS'
  Write-Output ('querySha256=' + $querySha)
  Write-Output ('passingGuard=COMPLETED psqlExitCode=' + $pass.ExitCode + ' F2_DONE=PASS TLS=PASS')
  Write-Output ('connectionGuard=FAILED psqlExitCode=' + $connectionFailure.ExitCode + ' failure=TARGET_BRANCH_ID_MISMATCH laterCatalogReads=0')
  Write-Output ('schemaOutputGuard=FAILED psqlExitCode=' + $schemaFailure.ExitCode + ' failure=SCHEMA_OUTPUT_LIMIT_EXCEEDED laterInventoryReads=0')
  Write-Output ('terminalConnection=FAILED psqlExitCode=' + $terminalFailure.ExitCode)
  Write-Output ('legacyQuit3=FAILED psqlExitCode=' + $legacy.ExitCode + ' laterCatalogReads=0')
  Write-Output 'tamper=FAILED psqlStarted=false'
  Write-Output 'auditSanitization=PASS F2_FAIL=retained catalogRows=omitted secretLikeValues=omitted'
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
