Set-StrictMode -Version Latest

function Get-Wave13B2F2QuerySha256([byte[]]$Bytes) {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha256.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Assert-Wave13B2F2QueryDigest([byte[]]$Bytes, [string]$ExpectedSha256) {
  if ($null -eq $Bytes -or $ExpectedSha256 -notmatch '^[a-f0-9]{64}$' -or (Get-Wave13B2F2QuerySha256 -Bytes $Bytes) -ne $ExpectedSha256) {
    throw 'The read-only query bytes do not match the expected SHA-256.'
  }
}

function Invoke-Wave13B2F2Psql([string]$PsqlExecutable, [string[]]$ArgumentList) {
  $exitCode = -1
  $outputLines = [System.Collections.Generic.List[string]]::new()
  $process = [Diagnostics.Process]::new()
  try {
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $PsqlExecutable
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $ArgumentList) { [void]$startInfo.ArgumentList.Add([string]$argument) }
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'psql process did not start' }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    foreach ($line in [regex]::Split($stdout, '\r?\n')) {
      if ($line.Length -gt 0) { $outputLines.Add($line) }
    }
    foreach ($line in [regex]::Split($stderr, '\r?\n')) {
      if ($line.Length -gt 0) { $outputLines.Add($line) }
    }
    $exitCode = [int]$process.ExitCode
  } catch {
    $outputLines.Add('F2_RUNNER_PSQL_PROCESS_START_FAILED')
  } finally {
    $process.Dispose()
  }

  return [pscustomobject]@{
    ExitCode = $exitCode
    OutputLines = [string[]]$outputLines.ToArray()
  }
}

function Get-Wave13B2F2RunClassification(
  [int]$ExitCode,
  [string[]]$OutputLines,
  [string]$ExpectedSourceSha,
  [string]$ExpectedQuerySha256
) {
  if ($ExpectedSourceSha -notmatch '^[a-f0-9]{40}$' -or $ExpectedQuerySha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'F2 result classification requires exact source and query hashes.'
  }

  $outputText = $OutputLines -join "`n"
  $failureCodes = @([regex]::Matches($outputText, '(?m)^F2_FAIL ([A-Z0-9_]+)\s*$') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
  $stopCount = [regex]::Matches($outputText, '(?m)^F2_STOP\b|^ERROR:\s+F2_STOP\b').Count
  $expectedDone = 'F2_DONE PASS source=' + $ExpectedSourceSha + ' query=' + $ExpectedQuerySha256
  $doneLines = @([regex]::Matches($outputText, '(?m)^F2_DONE\b.*$') | ForEach-Object { $_.Value })
  $doneMatches = $doneLines.Count -eq 1 -and $doneLines[0] -ceq $expectedDone
  $allPsqlExitLinesSuccessful = $ExitCode -eq 0
  $completed = $allPsqlExitLinesSuccessful -and $doneMatches -and $failureCodes.Count -eq 0 -and $stopCount -eq 0

  $resultCodes = @($failureCodes)
  if ($ExitCode -ne 0) { $resultCodes += 'F2_PSQL_EXIT_CODE_' + $ExitCode }
  if ($stopCount -gt 0) { $resultCodes += 'F2_STOP_MARKER_PRESENT' }
  if (-not $doneMatches) { $resultCodes += 'F2_DONE_MARKER_MISSING_OR_INVALID' }
  if ($resultCodes.Count -eq 0 -and -not $completed) { $resultCodes += 'F2_RUNNER_RESULT_INVALID' }

  return [pscustomobject]@{
    Status = if ($completed) { 'COMPLETED' } else { 'FAILED' }
    ExitCode = $ExitCode
    FailureCodes = [string[]]@($resultCodes | Select-Object -Unique)
    DoneMarker = if ($doneMatches) { $doneLines[0] } else { $null }
  }
}

function Protect-Wave13B2F2AuditOutput([string[]]$Lines) {
  $protected = [System.Collections.Generic.List[string]]::new()
  $suppressedLineCount = 0
  foreach ($line in $Lines) {
    $value = ([string]$line).Trim()
    if ($value -match '^F2_FAIL [A-Z0-9_]+$') {
      $protected.Add($value)
    } elseif ($value -match '^F2_CHECK [A-Z0-9_]+ PASS$' -or
      $value -match '^F2_CHECK [A-Z0-9_]+ count=[0-9]+ limit=[0-9]+$' -or
      $value -match '^F2_CHECK [A-Z0-9_]+ count=[0-9]+ expected=[0-9]+$') {
      $protected.Add($value)
    } elseif ($value -match '^F2_STOP [A-Z0-9_]+(?: CATALOG_QUERIES_SKIPPED)?$' -or
      $value -match '^ERROR:\s+F2_STOP [A-Z0-9_]+$') {
      $protected.Add($value)
    } elseif ($value -match '^F2_CATALOG_READ [A-Z0-9_]+$') {
      $protected.Add($value)
    } elseif ($value -match '^F2_DONE PASS source=[a-f0-9]{40} query=[a-f0-9]{64}$') {
      $protected.Add($value)
    } elseif ($value -eq 'F2_RUNNER_PSQL_PROCESS_START_FAILED' -or $value -match '^F2_RUNNER_[A-Z0-9_]+$') {
      $protected.Add($value)
    } else {
      $suppressedLineCount++
    }
  }
  return [pscustomobject]@{
    Lines = [string[]]$protected.ToArray()
    SuppressedLineCount = $suppressedLineCount
  }
}

function New-Wave13B2F2AuditContent(
  [string]$SourceSha,
  [string]$QuerySha256,
  [pscustomobject]$RunResult,
  [pscustomobject]$Classification
) {
  $rawText = $RunResult.OutputLines -join "`n"
  $rawBytes = [Text.UTF8Encoding]::new($false).GetBytes($rawText)
  $safeOutput = Protect-Wave13B2F2AuditOutput -Lines ([string[]]$RunResult.OutputLines)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $capturedOutputSha256 = [BitConverter]::ToString($sha256.ComputeHash($rawBytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }

  $header = @(
    'F2_AUDIT_FORMAT=1'
    'sourceSha=' + $SourceSha
    'queryPacketSha256=' + $QuerySha256
    'outputStreams=stdout_and_stderr_captured'
    'psqlExitCode=' + $RunResult.ExitCode
    'status=' + $Classification.Status
    'failureCodes=' + (@($Classification.FailureCodes) -join ',')
    'capturedOutputLineCount=' + $RunResult.OutputLines.Count
    'capturedOutputSuppressedLineCount=' + $safeOutput.SuppressedLineCount
    'capturedOutputSha256=' + $capturedOutputSha256
    'capturedOutputBegin'
  )
  return (($header + @($safeOutput.Lines) + @('capturedOutputEnd', '')) -join "`n")
}

function Write-Wave13B2F2AuditEvidence([string]$Path, [string]$Content) {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Content)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
  return Get-Wave13B2F2QuerySha256 -Bytes $bytes
}

function Add-Wave13B2F2AttemptResult(
  [string]$MarkerPath,
  [pscustomobject]$RunResult,
  [pscustomobject]$Classification,
  [string]$AuditFileName,
  [string]$AuditSha256
) {
  $failureCodes = @($Classification.FailureCodes)
  $lines = @(
    'status=' + $Classification.Status
    'finishedAtUtc=' + [DateTime]::UtcNow.ToString('o')
    'psqlExitCode=' + $RunResult.ExitCode
    'failureCodes=' + ($failureCodes -join ',')
    'auditFile=' + $AuditFileName
    'auditSha256=' + $AuditSha256
    ''
  )
  [IO.File]::AppendAllText($MarkerPath, ($lines -join "`n"), [Text.UTF8Encoding]::new($false))
}

Export-ModuleMember -Function @(
  'Add-Wave13B2F2AttemptResult',
  'Assert-Wave13B2F2QueryDigest',
  'Get-Wave13B2F2QuerySha256',
  'Get-Wave13B2F2RunClassification',
  'Invoke-Wave13B2F2Psql',
  'New-Wave13B2F2AuditContent',
  'Protect-Wave13B2F2AuditOutput',
  'Write-Wave13B2F2AuditEvidence'
)
