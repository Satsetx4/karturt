Set-StrictMode -Version Latest

if ($null -eq ('Wave13B2F2.RawOutputPump' -as [type])) {
  Add-Type -TypeDefinition @'
using System.IO;
using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Wave13B2F2 {
  public sealed class StderrCaptureResult {
    public long ByteCount { get; set; }
    public string Sha256 { get; set; }
    public string[] Markers { get; set; }
    public bool MarkerScanComplete { get; set; }
  }

  public static class RawOutputPump {
    public static async Task<long> CopyAsync(Stream source, Stream destination, IncrementalHash hash) {
      var buffer = new byte[81920];
      long copied = 0;
      int read;
      while ((read = await source.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false)) > 0) {
        hash.AppendData(buffer, 0, read);
        await destination.WriteAsync(buffer, 0, read).ConfigureAwait(false);
        copied += read;
      }
      return copied;
    }

    public static async Task<StderrCaptureResult> DrainStderrAsync(Stream source) {
      using (var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256)) {
        var readBuffer = new byte[81920];
        var lineBuffer = new byte[8192];
        var markers = new System.Collections.Generic.List<string>();
        long byteCount = 0;
        int lineLength = 0;
        bool lineOverflow = false;
        bool markerScanComplete = true;
        int read;
        while ((read = await source.ReadAsync(readBuffer, 0, readBuffer.Length).ConfigureAwait(false)) > 0) {
          hash.AppendData(readBuffer, 0, read);
          byteCount += read;
          for (int index = 0; index < read; index++) {
            byte value = readBuffer[index];
            if (value == 10) {
              if (lineOverflow) {
                markerScanComplete = false;
              } else if (lineLength > 0) {
                CaptureAllowlistedMarker(lineBuffer, lineLength, markers);
              }
              lineLength = 0;
              lineOverflow = false;
            } else if (!lineOverflow) {
              if (lineLength < lineBuffer.Length) lineBuffer[lineLength++] = value;
              else lineOverflow = true;
            }
          }
        }
        if (lineOverflow) markerScanComplete = false;
        else if (lineLength > 0) CaptureAllowlistedMarker(lineBuffer, lineLength, markers);
        return new StderrCaptureResult {
          ByteCount = byteCount,
          Sha256 = BitConverter.ToString(hash.GetHashAndReset()).Replace("-", "").ToLowerInvariant(),
          Markers = markers.ToArray(),
          MarkerScanComplete = markerScanComplete
        };
      }
    }

    private static void CaptureAllowlistedMarker(byte[] lineBuffer, int lineLength, System.Collections.Generic.List<string> markers) {
      int normalizedLength = lineLength > 0 && lineBuffer[lineLength - 1] == 13 ? lineLength - 1 : lineLength;
      string line = Encoding.UTF8.GetString(lineBuffer, 0, normalizedLength);
      Match failure = Regex.Match(line, @"(?:^|\s)F2_FAIL ([A-Z0-9_]+)$");
      if (failure.Success) {
        markers.Add("F2_FAIL " + failure.Groups[1].Value);
        return;
      }
      Match stop = Regex.Match(line, @"(?:^|\s)F2_STOP ([A-Z0-9_]+)(?: CATALOG_QUERIES_SKIPPED)?$");
      if (stop.Success) markers.Add("F2_STOP " + stop.Groups[1].Value);
    }
  }
}
'@ -ErrorAction Stop
}

$script:Wave13B2F2SqlFailureCodes = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($code in @(
  'APPROVED_SOURCE_SHA_FORMAT_INVALID', 'APPROVED_SOURCE_SHA_MISSING', 'DATABASE_NAME_MISMATCH',
  'DEFAULT_ACL_OUTPUT_LIMIT_EXCEEDED', 'EXPECTED_DATABASE_MISSING', 'EXPECTED_OWNER_ROLE_MISSING',
  'EXTENSION_OUTPUT_LIMIT_EXCEEDED', 'OWNER_APPROVAL_NOT_CONFIRMED', 'OWNER_APPROVAL_VERIFICATION_REQUIRED',
  'OWNER_ROLE_MISMATCH', 'POSTGRES_MAJOR_NOT_18', 'QUERY_PACKET_SHA256_FORMAT_INVALID',
  'QUERY_PACKET_SHA256_MISSING', 'RELATION_OUTPUT_LIMIT_EXCEEDED', 'ROLE_MEMBERSHIP_OUTPUT_LIMIT_EXCEEDED',
  'ROUTINE_OUTPUT_LIMIT_EXCEEDED', 'SCHEMA_OUTPUT_LIMIT_EXCEEDED', 'TARGET_BRANCH_ID_MISMATCH',
  'TARGET_BRANCH_ID_MISSING', 'TARGET_ENDPOINT_ID_MISMATCH', 'TARGET_ENDPOINT_ID_MISSING',
  'TARGET_PROJECT_ID_MISMATCH', 'TARGET_PROJECT_ID_MISSING', 'TLS_NOT_ACTIVE',
  'TRANSACTION_NOT_READ_ONLY', 'TYPE_OUTPUT_LIMIT_EXCEEDED', 'UNEXPECTED_STANDALONE_APPLICATION_TYPES'
)) { [void]$script:Wave13B2F2SqlFailureCodes.Add($code) }

$script:Wave13B2F2SqlStopCodes = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($code in @(
  'APPROVED_SOURCE_SHA_MISSING', 'CATALOG_QUERIES_SKIPPED', 'CONNECTION_GUARD_FAILED',
  'DEFAULT_ACL_OUTPUT_LIMIT_EXCEEDED', 'EXPECTED_DATABASE_MISSING', 'EXPECTED_OWNER_ROLE_MISSING',
  'EXTENSION_OUTPUT_LIMIT_EXCEEDED', 'OWNER_APPROVAL_NOT_CONFIRMED', 'OWNER_APPROVAL_VERIFICATION_REQUIRED',
  'QUERY_NOT_STARTED', 'QUERY_PACKET_SHA256_MISSING', 'RELATION_OUTPUT_LIMIT_EXCEEDED',
  'ROLE_MEMBERSHIP_OUTPUT_LIMIT_EXCEEDED', 'ROUTINE_OUTPUT_LIMIT_EXCEEDED', 'SCHEMA_OUTPUT_LIMIT_EXCEEDED',
  'TARGET_BRANCH_ID_MISSING', 'TARGET_ENDPOINT_ID_MISSING', 'TARGET_PROJECT_ID_MISSING',
  'TYPE_OUTPUT_LIMIT_EXCEEDED', 'UNEXPECTED_STANDALONE_APPLICATION_TYPES'
)) { [void]$script:Wave13B2F2SqlStopCodes.Add($code) }

$script:Wave13B2F2SqlCheckNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($name in @(
  'APPROVED_SOURCE_SHA_FORMAT', 'DATABASE_NAME', 'DEFAULT_ACL_OUTPUT_LIMIT', 'EMPTY_BASELINE_STANDALONE_TYPES',
  'EXTENSION_OUTPUT_LIMIT', 'OWNER_ROLE', 'POSTGRES_MAJOR', 'QUERY_PACKET_SHA256_FORMAT',
  'RELATION_OUTPUT_LIMIT', 'ROLE_MEMBERSHIP_OUTPUT_LIMIT', 'ROUTINE_OUTPUT_LIMIT', 'SCHEMA_OUTPUT_LIMIT',
  'TARGET_BRANCH_ID', 'TARGET_ENDPOINT_ID', 'TARGET_PROJECT_ID', 'TLS_ACTIVE', 'TRANSACTION_READ_ONLY', 'TYPE_OUTPUT_LIMIT'
)) { [void]$script:Wave13B2F2SqlCheckNames.Add($name) }

$script:Wave13B2F2SqlCatalogReadNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($name in @(
  'DEFAULT_ACL_INVENTORY', 'DEFAULT_ACL_LIMIT_COUNT', 'EXTENSION_INVENTORY', 'EXTENSION_LIMIT_COUNT',
  'MEMBERSHIP_LIMIT_COUNT', 'RELATION_DIAGNOSTIC_COUNT', 'RELATION_INVENTORY', 'RELATION_LIMIT_COUNT',
  'ROLE_MEMBERSHIP_INVENTORY', 'ROUTINE_DIAGNOSTIC_COUNT', 'ROUTINE_INVENTORY', 'ROUTINE_LIMIT_COUNT',
  'SCHEMA_DIAGNOSTIC_COUNT', 'SCHEMA_INVENTORY', 'SCHEMA_LIMIT_COUNT', 'STANDALONE_APPLICATION_TYPE_COUNT',
  'STANDALONE_APPLICATION_TYPE_INVENTORY', 'TYPE_DIAGNOSTIC_COUNT', 'TYPE_LIMIT_COUNT'
)) { [void]$script:Wave13B2F2SqlCatalogReadNames.Add($name) }

$script:Wave13B2F2RunnerFailureCodes = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($code in @(
  'F2_RUNNER_RESULT_INVALID', 'F2_PSQL_EXIT_CODE_UNKNOWN', 'F2_STOP_MARKER_PRESENT',
  'F2_DONE_MARKER_MISSING_OR_INVALID', 'F2_EVIDENCE_NOT_VERIFIED', 'F2_PSQL_PROCESS_START_FAILED',
  'F2_PSQL_TIMEOUT', 'F2_PSQL_INTERRUPTED', 'F2_PSQL_CAPTURE_FAILED', 'F2_PSQL_STDERR_MARKER_SCAN_INCOMPLETE',
  'F2_EVIDENCE_SOURCE_QUERY_BINDING_MISMATCH', 'F2_EVIDENCE_CREATE_FAILED', 'F2_EVIDENCE_REPARSE_DETECTED',
  'F2_EVIDENCE_ACL_MISMATCH', 'F2_EVIDENCE_VERIFY_FAILED', 'F2_EVIDENCE_EXPECTED_HASH_INVALID',
  'F2_EVIDENCE_LENGTH_MISMATCH', 'F2_EVIDENCE_HASH_MISMATCH', 'F2_EVIDENCE_CAPTURE_INCOMPLETE',
  'F2_EVIDENCE_CSV_LINE_TOO_LONG', 'F2_EVIDENCE_CSV_PARSE_FAILED', 'F2_EVIDENCE_MISSING',
  'F2_UNALLOWLISTED_MARKER_PRESENT', 'F2_DONE_MARKER_INVALID',
  'F2_RECEIPT_SOURCE_QUERY_BINDING_MISMATCH', 'F2_RECEIPT_CONTENT_INVALID', 'F2_RECEIPT_DIRECTORY_MISSING',
  'F2_RECEIPT_REPARSE_DETECTED', 'F2_RECEIPT_ACL_MISMATCH', 'F2_RECEIPT_CREATE_FAILED',
  'F2_RECEIPT_WRITE_FAILED', 'F2_RECEIPT_LENGTH_MISMATCH', 'F2_RECEIPT_HASH_MISMATCH',
  'F2_RECEIPT_POST_VERIFY_FAILED', 'F2_RECEIPT_VERIFY_FAILED', 'F2_RUNNER_ABORTED_BEFORE_PSQL',
  'F2_RUNNER_ABORTED'
)) { [void]$script:Wave13B2F2RunnerFailureCodes.Add($code) }

function Test-Wave13B2F2AllowedFailureCode([string]$Code) {
  return $script:Wave13B2F2RunnerFailureCodes.Contains($Code) -or
    $script:Wave13B2F2SqlFailureCodes.Contains($Code) -or
    $Code -cmatch '^F2_PSQL_EXIT_CODE_[0-9]{1,10}$'
}

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

function Test-Wave13B2F2NoReparsePath([string]$Path) {
  try {
    $currentPath = [IO.Path]::GetFullPath($Path)
    while (-not [string]::IsNullOrWhiteSpace($currentPath)) {
      $item = Get-Item -LiteralPath $currentPath -Force -ErrorAction Stop
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
      $parentPath = [IO.Path]::GetDirectoryName($currentPath)
      if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) { break }
      $currentPath = $parentPath
    }
    return $true
  } catch {
    return $false
  }
}

function Test-Wave13B2F2ProtectedAcl([string]$Path, [string]$AclCheckerPath) {
  try {
    if (-not (Test-Path -LiteralPath $AclCheckerPath -PathType Leaf)) { return $false }
    $checkerOutput = @(& $AclCheckerPath -Path $Path -RequireProtected 2>$null)
    return (($checkerOutput -join '').Trim() -ceq 'PASS')
  } catch {
    return $false
  }
}

function Set-Wave13B2F2OwnerOnlyProtectedAcl([string]$Path) {
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner($ownerSid)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  $fullControl = [Security.AccessControl.FileSystemRights]::FullControl
  $allow = [Security.AccessControl.AccessControlType]::Allow
  $acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($ownerSid, $fullControl, $allow))
  $acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, $fullControl, $allow))
  Set-Acl -LiteralPath $Path -AclObject $acl -ErrorAction Stop
}

function Test-Wave13B2F2EvidencePathBinding(
  [string]$Path,
  [string]$ExpectedSourceSha,
  [string]$ExpectedQuerySha256
) {
  if ($ExpectedSourceSha -notmatch '^[a-f0-9]{40}$' -or $ExpectedQuerySha256 -notmatch '^[a-f0-9]{64}$') {
    return $false
  }
  try {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $expectedName = 'wave13b2-f2-catalog-evidence-' + $ExpectedSourceSha + '-' + $ExpectedQuerySha256 + '.local.txt'
    $parentName = [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($fullPath))
    return [IO.Path]::GetFileName($fullPath) -ceq $expectedName -and $parentName -ceq ('f2-attempt-' + $ExpectedSourceSha)
  } catch {
    return $false
  }
}

function Test-Wave13B2F2ReceiptPathBinding(
  [string]$Path,
  [string]$ExpectedSourceSha,
  [string]$ExpectedQuerySha256
) {
  if ($ExpectedSourceSha -notmatch '^[a-f0-9]{40}$' -or $ExpectedQuerySha256 -notmatch '^[a-f0-9]{64}$' -or [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    return $false
  }
  try {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $expectedRoot = [IO.Path]::GetFullPath((Join-Path (Join-Path $env:LOCALAPPDATA 'KarturtStageOperator') ('f2-attempt-' + $ExpectedSourceSha)))
    $expectedPath = Join-Path $expectedRoot ('wave13b2-f2-owner-review-' + $ExpectedSourceSha + '-' + $ExpectedQuerySha256 + '.local.json')
    return [string]::Equals($fullPath, [IO.Path]::GetFullPath($expectedPath), [StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function New-Wave13B2F2OwnerEvidenceFile(
  [string]$Path,
  [string]$AclCheckerPath,
  [string]$ExpectedSourceSha,
  [string]$ExpectedQuerySha256
) {
  $failureCodes = [System.Collections.Generic.List[string]]::new()
  $stream = $null
  if (-not (Test-Wave13B2F2EvidencePathBinding -Path $Path -ExpectedSourceSha $ExpectedSourceSha -ExpectedQuerySha256 $ExpectedQuerySha256)) {
    $failureCodes.Add('F2_EVIDENCE_SOURCE_QUERY_BINDING_MISMATCH')
    return [pscustomobject]@{ Stream = $null; FailureCodes = [string[]]$failureCodes.ToArray() }
  }

  $directoryPath = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))
  if (-not (Test-Path -LiteralPath $directoryPath -PathType Container)) {
    $failureCodes.Add('F2_EVIDENCE_CREATE_FAILED')
    return [pscustomobject]@{ Stream = $null; FailureCodes = [string[]]$failureCodes.ToArray() }
  }
  if (-not (Test-Wave13B2F2NoReparsePath -Path $directoryPath)) {
    $failureCodes.Add('F2_EVIDENCE_REPARSE_DETECTED')
    return [pscustomobject]@{ Stream = $null; FailureCodes = [string[]]$failureCodes.ToArray() }
  }
  if (-not (Test-Wave13B2F2ProtectedAcl -Path $directoryPath -AclCheckerPath $AclCheckerPath)) {
    $failureCodes.Add('F2_EVIDENCE_ACL_MISMATCH')
    return [pscustomobject]@{ Stream = $null; FailureCodes = [string[]]$failureCodes.ToArray() }
  }

  try {
    $createStream = [IO.File]::Open([IO.Path]::GetFullPath($Path), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $createStream.Dispose()
  } catch {
    $failureCodes.Add('F2_EVIDENCE_CREATE_FAILED')
    return [pscustomobject]@{ Stream = $null; FailureCodes = [string[]]$failureCodes.ToArray() }
  }

  try {
    Set-Wave13B2F2OwnerOnlyProtectedAcl -Path $Path
    if (-not (Test-Wave13B2F2NoReparsePath -Path $Path)) {
      $failureCodes.Add('F2_EVIDENCE_REPARSE_DETECTED')
    } elseif (-not (Test-Wave13B2F2ProtectedAcl -Path $Path -AclCheckerPath $AclCheckerPath)) {
      $failureCodes.Add('F2_EVIDENCE_ACL_MISMATCH')
    }
    if ($failureCodes.Count -gt 0) {
      return [pscustomobject]@{ Stream = $null; FailureCodes = [string[]]$failureCodes.ToArray() }
    }
    $stream = [IO.File]::Open([IO.Path]::GetFullPath($Path), [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
    if (-not (Test-Wave13B2F2NoReparsePath -Path $Path) -or -not (Test-Wave13B2F2ProtectedAcl -Path $Path -AclCheckerPath $AclCheckerPath)) {
      $stream.Dispose()
      $failureCodes.Add('F2_EVIDENCE_ACL_MISMATCH')
      return [pscustomobject]@{ Stream = $null; FailureCodes = [string[]]$failureCodes.ToArray() }
    }
    return [pscustomobject]@{ Stream = $stream; FailureCodes = [string[]]@() }
  } catch {
    if ($null -ne $stream) { $stream.Dispose() }
    $failureCodes.Add('F2_EVIDENCE_ACL_MISMATCH')
    return [pscustomobject]@{ Stream = $null; FailureCodes = [string[]]$failureCodes.ToArray() }
  }
}

function Get-Wave13B2F2OwnerEvidenceVerification(
  [string]$Path,
  [string]$AclCheckerPath,
  [string]$ExpectedSourceSha,
  [string]$ExpectedQuerySha256,
  [long]$ExpectedLength = -1,
  [string]$ExpectedSha256 = '',
  [IO.FileStream]$ReadLock = $null
) {
  $failureCodes = [System.Collections.Generic.List[string]]::new()
  $stream = $ReadLock
  $byteLength = -1L
  $sha256Hex = 'unavailable'

  if (-not (Test-Wave13B2F2EvidencePathBinding -Path $Path -ExpectedSourceSha $ExpectedSourceSha -ExpectedQuerySha256 $ExpectedQuerySha256)) {
    $failureCodes.Add('F2_EVIDENCE_SOURCE_QUERY_BINDING_MISMATCH')
  }
  if ($ExpectedSha256 -notmatch '^[a-f0-9]{64}$') {
    $failureCodes.Add('F2_EVIDENCE_EXPECTED_HASH_INVALID')
  }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    $failureCodes.Add('F2_EVIDENCE_MISSING')
  } elseif (-not (Test-Wave13B2F2NoReparsePath -Path $Path)) {
    $failureCodes.Add('F2_EVIDENCE_REPARSE_DETECTED')
  }
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    if (-not (Test-Wave13B2F2ProtectedAcl -Path $Path -AclCheckerPath $AclCheckerPath)) {
      $failureCodes.Add('F2_EVIDENCE_ACL_MISMATCH')
    }
  }

  if ($failureCodes.Count -eq 0) {
    try {
      if ($null -eq $stream) {
        $stream = [IO.File]::Open([IO.Path]::GetFullPath($Path), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
      }
      $stream.Position = 0
      $byteLength = $stream.Length
      $sha = [Security.Cryptography.SHA256]::Create()
      try {
        $sha256Hex = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
      } finally {
        $sha.Dispose()
      }
      $stream.Position = 0
      if ($ExpectedLength -ge 0 -and $byteLength -ne $ExpectedLength) { $failureCodes.Add('F2_EVIDENCE_LENGTH_MISMATCH') }
      if ($sha256Hex -cne $ExpectedSha256) { $failureCodes.Add('F2_EVIDENCE_HASH_MISMATCH') }
      if (-not (Test-Wave13B2F2NoReparsePath -Path $Path)) { $failureCodes.Add('F2_EVIDENCE_REPARSE_DETECTED') }
      if (-not (Test-Wave13B2F2ProtectedAcl -Path $Path -AclCheckerPath $AclCheckerPath)) { $failureCodes.Add('F2_EVIDENCE_ACL_MISMATCH') }
      if (-not (Test-Wave13B2F2NoReparsePath -Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path)))) -or
        -not (Test-Wave13B2F2ProtectedAcl -Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))) -AclCheckerPath $AclCheckerPath)) {
        $failureCodes.Add('F2_EVIDENCE_ACL_MISMATCH')
      }
    } catch {
      $failureCodes.Add('F2_EVIDENCE_VERIFY_FAILED')
    }
  }

  return [pscustomobject]@{
    Verified = $failureCodes.Count -eq 0
    ByteLength = $byteLength
    Sha256 = $sha256Hex
    FailureCodes = [string[]]@($failureCodes.ToArray() | Select-Object -Unique)
    ReadLock = $stream
  }
}

function Assert-Wave13B2F2OwnerReviewReceipt(
  [byte[]]$Bytes,
  [string]$SourceSha,
  [string]$QuerySha256
) {
  $allowedNames = [string[]]@(
    'schemaVersion', 'recordType', 'sourceSha', 'querySha256',
    'evidenceFile', 'evidenceSha256', 'evidenceBytes',
    'auditFile', 'auditSha256', 'auditBytes',
    'expectedStateFile', 'expectedStateSha256', 'expectedStateBytes',
    'comparisonStatus', 'matchedFields', 'mismatchedFields', 'reviewedAtUtc', 'confirmationPhrase'
  )
  if ($null -eq $Bytes -or $Bytes.Length -lt 2 -or $Bytes.Length -gt 65536 -or $Bytes[0] -eq 0xEF -or $SourceSha -notmatch '^[a-f0-9]{40}$' -or $QuerySha256 -notmatch '^[a-f0-9]{64}$') {
    return $false
  }
  try {
    $utf8 = [Text.UTF8Encoding]::new($false, $true)
    $jsonText = $utf8.GetString($Bytes)
    $document = [System.Text.Json.JsonDocument]::Parse($jsonText)
  } catch {
    return $false
  }

  try {
    $root = $document.RootElement
    if ($root.ValueKind -ne [System.Text.Json.JsonValueKind]::Object) { return $false }
    $properties = [System.Collections.Generic.Dictionary[string, System.Text.Json.JsonElement]]::new([StringComparer]::Ordinal)
    foreach ($property in $root.EnumerateObject()) {
      if ($property.Name -notin $allowedNames -or $properties.ContainsKey($property.Name)) { return $false }
      $properties.Add($property.Name, $property.Value)
    }
    if ($properties.Count -ne $allowedNames.Count) { return $false }
    foreach ($name in $allowedNames) { if (-not $properties.ContainsKey($name)) { return $false } }

    $schema = $properties['schemaVersion']
    $recordType = $properties['recordType']
    $source = $properties['sourceSha']
    $query = $properties['querySha256']
    if ($schema.ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or $schema.GetInt32() -ne 1) { return $false }
    if ($recordType.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $recordType.GetString() -cne 'INTERACTIVE_LOCAL_OWNER_CONFIRMATION_NOT_SIGNATURE') { return $false }
    if ($source.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $source.GetString() -cne $SourceSha) { return $false }
    if ($query.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $query.GetString() -cne $QuerySha256) { return $false }

    $evidenceFile = $properties['evidenceFile']
    $auditFile = $properties['auditFile']
    $expectedStateFile = $properties['expectedStateFile']
    if ($evidenceFile.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $evidenceFile.GetString() -cne ('wave13b2-f2-catalog-evidence-' + $SourceSha + '-' + $QuerySha256 + '.local.txt')) { return $false }
    if ($auditFile.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $auditFile.GetString() -cne ('wave13b2-f2-audit-' + $SourceSha + '-' + $QuerySha256 + '.local.txt')) { return $false }
    if ($expectedStateFile.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $expectedStateFile.GetString() -cne 'wave13b2-staging-expected-state.local.json') { return $false }

    foreach ($name in @('evidenceSha256', 'auditSha256', 'expectedStateSha256')) {
      if ($properties[$name].ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $properties[$name].GetString() -notmatch '^[a-f0-9]{64}$') { return $false }
    }
    foreach ($name in @('evidenceBytes', 'auditBytes', 'expectedStateBytes')) {
      $length = 0L
      if ($properties[$name].ValueKind -ne [System.Text.Json.JsonValueKind]::Number -or -not $properties[$name].TryGetInt64([ref]$length) -or $length -lt 0) { return $false }
    }

    $comparison = $properties['comparisonStatus']
    if ($comparison.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $comparison.GetString() -cnotin @('MATCH', 'MISMATCH')) { return $false }
    foreach ($name in @('matchedFields', 'mismatchedFields')) {
      if ($properties[$name].ValueKind -ne [System.Text.Json.JsonValueKind]::Array) { return $false }
      $seenFields = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
      foreach ($field in $properties[$name].EnumerateArray()) {
        if ($field.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $field.GetString() -notmatch '^[A-Za-z][A-Za-z0-9_.-]{0,63}$' -or -not $seenFields.Add($field.GetString())) { return $false }
      }
    }
    $mismatchCount = $properties['mismatchedFields'].GetArrayLength()
    if (($comparison.GetString() -ceq 'MATCH' -and $mismatchCount -ne 0) -or ($comparison.GetString() -ceq 'MISMATCH' -and $mismatchCount -eq 0)) { return $false }

    $reviewedAt = $properties['reviewedAtUtc']
    $reviewedAtValue = [DateTimeOffset]::MinValue
    if ($reviewedAt.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or -not [DateTimeOffset]::TryParse($reviewedAt.GetString(), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind, [ref]$reviewedAtValue) -or $reviewedAtValue.Offset -ne [TimeSpan]::Zero) { return $false }
    $status = $comparison.GetString()
    $expectedPhrase = 'REVIEW WAVE13B2 F2 ' + $SourceSha.Substring(0, 12) + ' ' + $QuerySha256.Substring(0, 12) + ' ' + $status
    $phrase = $properties['confirmationPhrase']
    if ($phrase.ValueKind -ne [System.Text.Json.JsonValueKind]::String -or $phrase.GetString() -cne $expectedPhrase) { return $false }
    return $true
  } catch {
    return $false
  } finally {
    $document.Dispose()
  }
}

function New-Wave13B2F2OwnerOnlyBoundFile(
  [string]$Path,
  [byte[]]$Bytes,
  [string]$SourceSha,
  [string]$QuerySha256
) {
  $failureCodes = [System.Collections.Generic.List[string]]::new()
  $byteLength = -1L
  $sha256Hex = 'unavailable'
  $stream = $null
  if (-not (Test-Wave13B2F2ReceiptPathBinding -Path $Path -ExpectedSourceSha $SourceSha -ExpectedQuerySha256 $QuerySha256)) {
    $failureCodes.Add('F2_RECEIPT_SOURCE_QUERY_BINDING_MISMATCH')
  } elseif (-not (Assert-Wave13B2F2OwnerReviewReceipt -Bytes $Bytes -SourceSha $SourceSha -QuerySha256 $QuerySha256)) {
    $failureCodes.Add('F2_RECEIPT_CONTENT_INVALID')
  }
  if ($failureCodes.Count -eq 0) {
    $directoryPath = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))
    if (-not (Test-Path -LiteralPath $directoryPath -PathType Container)) { $failureCodes.Add('F2_RECEIPT_DIRECTORY_MISSING') }
    elseif (-not (Test-Wave13B2F2NoReparsePath -Path $directoryPath)) { $failureCodes.Add('F2_RECEIPT_REPARSE_DETECTED') }
    elseif (-not (Test-Wave13B2F2ProtectedAcl -Path $directoryPath -AclCheckerPath (Join-Path $PSScriptRoot '..\check-wave13b2-secret-acl.ps1'))) { $failureCodes.Add('F2_RECEIPT_ACL_MISMATCH') }
  }
  if ($failureCodes.Count -eq 0) {
    try {
      $created = [IO.File]::Open([IO.Path]::GetFullPath($Path), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
      $created.Dispose()
    } catch {
      $failureCodes.Add('F2_RECEIPT_CREATE_FAILED')
    }
  }
  if ($failureCodes.Count -eq 0) {
    try {
      Set-Wave13B2F2OwnerOnlyProtectedAcl -Path $Path
      $aclCheckerPath = Join-Path $PSScriptRoot '..\check-wave13b2-secret-acl.ps1'
      if (-not (Test-Wave13B2F2NoReparsePath -Path $Path) -or -not (Test-Wave13B2F2NoReparsePath -Path ([IO.Path]::GetDirectoryName($Path)))) {
        $failureCodes.Add('F2_RECEIPT_REPARSE_DETECTED')
      }
      if (-not (Test-Wave13B2F2ProtectedAcl -Path $Path -AclCheckerPath $aclCheckerPath) -or -not (Test-Wave13B2F2ProtectedAcl -Path ([IO.Path]::GetDirectoryName($Path)) -AclCheckerPath $aclCheckerPath)) {
        $failureCodes.Add('F2_RECEIPT_ACL_MISMATCH')
      }
      if ($failureCodes.Count -eq 0) {
        $stream = [IO.File]::Open([IO.Path]::GetFullPath($Path), [IO.FileMode]::Open, [IO.FileAccess]::Write, [IO.FileShare]::Read)
        if (-not (Test-Wave13B2F2NoReparsePath -Path $Path) -or -not (Test-Wave13B2F2ProtectedAcl -Path $Path -AclCheckerPath $aclCheckerPath)) {
          $failureCodes.Add('F2_RECEIPT_ACL_MISMATCH')
        } else {
          $stream.Write($Bytes, 0, $Bytes.Length)
          $stream.Flush($true)
        }
      }
    } catch {
      $failureCodes.Add('F2_RECEIPT_WRITE_FAILED')
    } finally {
      if ($null -ne $stream) { $stream.Dispose() }
    }
  }

  if ($failureCodes.Count -eq 0) {
    $aclCheckerPath = Join-Path $PSScriptRoot '..\check-wave13b2-secret-acl.ps1'
    if (-not (Test-Wave13B2F2NoReparsePath -Path $Path) -or -not (Test-Wave13B2F2NoReparsePath -Path ([IO.Path]::GetDirectoryName($Path)))) {
      $failureCodes.Add('F2_RECEIPT_REPARSE_DETECTED')
    }
    if (-not (Test-Wave13B2F2ProtectedAcl -Path $Path -AclCheckerPath $aclCheckerPath) -or -not (Test-Wave13B2F2ProtectedAcl -Path ([IO.Path]::GetDirectoryName($Path)) -AclCheckerPath $aclCheckerPath)) {
      $failureCodes.Add('F2_RECEIPT_ACL_MISMATCH')
    }
    if ($failureCodes.Count -eq 0) {
      try {
        $verifyStream = [IO.File]::Open([IO.Path]::GetFullPath($Path), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        try {
          $byteLength = $verifyStream.Length
          $sha = [Security.Cryptography.SHA256]::Create()
          try { $sha256Hex = [BitConverter]::ToString($sha.ComputeHash($verifyStream)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        } finally { $verifyStream.Dispose() }
        $expectedHash = Get-Wave13B2F2QuerySha256 -Bytes $Bytes
        if ($byteLength -ne $Bytes.Length) { $failureCodes.Add('F2_RECEIPT_LENGTH_MISMATCH') }
        if ($sha256Hex -cne $expectedHash) { $failureCodes.Add('F2_RECEIPT_HASH_MISMATCH') }
    if (-not (Test-Wave13B2F2NoReparsePath -Path $Path) -or -not (Test-Wave13B2F2NoReparsePath -Path ([IO.Path]::GetDirectoryName($Path))) -or
      -not (Test-Wave13B2F2ProtectedAcl -Path $Path -AclCheckerPath $aclCheckerPath) -or
      -not (Test-Wave13B2F2ProtectedAcl -Path ([IO.Path]::GetDirectoryName($Path)) -AclCheckerPath $aclCheckerPath)) { $failureCodes.Add('F2_RECEIPT_POST_VERIFY_FAILED') }
      } catch {
        $failureCodes.Add('F2_RECEIPT_VERIFY_FAILED')
      }
    }
  }
  if ($failureCodes.Count -eq 0) { $sha256Hex = Get-Wave13B2F2QuerySha256 -Bytes $Bytes; $byteLength = $Bytes.Length }
  return [pscustomobject]@{
    Verified = $failureCodes.Count -eq 0
    FileName = [IO.Path]::GetFileName($Path)
    ByteLength = $byteLength
    Sha256 = $sha256Hex
    FailureCodes = [string[]]@($failureCodes.ToArray() | Select-Object -Unique)
  }
}

function Get-Wave13B2F2SafeDiagnosticLines([string[]]$Lines, [switch]$IncludeCompletion) {
  $safe = [System.Collections.Generic.List[string]]::new()
  foreach ($line in $Lines) {
    $value = ([string]$line).TrimEnd("`r")
    if ($value -cmatch '^F2_FAIL ([A-Z0-9_]+)$' -and $script:Wave13B2F2SqlFailureCodes.Contains($Matches[1])) {
      $safe.Add($value)
    } elseif ($value -cmatch '^F2_CHECK ([A-Z0-9_]+) PASS$' -and $script:Wave13B2F2SqlCheckNames.Contains($Matches[1])) {
      $safe.Add($value)
    } elseif (($value -cmatch '^F2_CHECK ([A-Z0-9_]+) count=[0-9]+ limit=[0-9]+$' -or
      $value -cmatch '^F2_CHECK ([A-Z0-9_]+) count=[0-9]+ expected=[0-9]+$') -and $script:Wave13B2F2SqlCheckNames.Contains($Matches[1])) {
      $safe.Add($value)
    } elseif ($value -cmatch '^F2_STOP ([A-Z0-9_]+)(?: CATALOG_QUERIES_SKIPPED)?$' -and $script:Wave13B2F2SqlStopCodes.Contains($Matches[1])) {
      $safe.Add($value)
    } elseif ($value -cmatch '^ERROR:\s+F2_STOP ([A-Z0-9_]+)$' -and $script:Wave13B2F2SqlStopCodes.Contains($Matches[1])) {
      $safe.Add('F2_STOP ' + $Matches[1])
    } elseif ($value -cmatch '^F2_CATALOG_READ ([A-Z0-9_]+)$' -and $script:Wave13B2F2SqlCatalogReadNames.Contains($Matches[1])) {
      $safe.Add($value)
    } elseif ($IncludeCompletion -and $value -cmatch '^F2_DONE PASS source=[a-f0-9]{40} query=[a-f0-9]{64}$') {
      $safe.Add($value)
    }
  }
  return [string[]]$safe.ToArray()
}

function Add-Wave13B2F2CsvControlCandidate(
  [string]$Candidate,
  [System.Collections.Generic.List[string]]$Markers,
  [System.Collections.Generic.List[string]]$FailureCodes
) {
  if ($Candidate.StartsWith('F2_DONE', [StringComparison]::Ordinal)) {
    if ($Candidate -cmatch '^F2_DONE PASS source=[a-f0-9]{40} query=[a-f0-9]{64}$') {
      $Markers.Add($Candidate)
    } else {
      $Markers.Add('F2_DONE INVALID')
      $FailureCodes.Add('F2_DONE_MARKER_INVALID')
    }
    return
  }

  if ($Candidate.StartsWith('F2_FAIL', [StringComparison]::Ordinal)) {
    if ($Candidate -cmatch '^F2_FAIL ([A-Z0-9_]+)$' -and $script:Wave13B2F2SqlFailureCodes.Contains($Matches[1])) {
      $Markers.Add('F2_FAIL ' + $Matches[1])
    } else {
      $FailureCodes.Add('F2_UNALLOWLISTED_MARKER_PRESENT')
    }
    return
  }

  if ($Candidate.StartsWith('F2_STOP', [StringComparison]::Ordinal)) {
    if ($Candidate -cmatch '^F2_STOP ([A-Z0-9_]+)(?: CATALOG_QUERIES_SKIPPED)?$' -and $script:Wave13B2F2SqlStopCodes.Contains($Matches[1])) {
      $Markers.Add('F2_STOP ' + $Matches[1])
    } else {
      $FailureCodes.Add('F2_UNALLOWLISTED_MARKER_PRESENT')
    }
    return
  }

  $safe = @(Get-Wave13B2F2SafeDiagnosticLines -Lines ([string[]]@($Candidate)) -IncludeCompletion)
  foreach ($marker in $safe) { $Markers.Add($marker) }
}

function Get-Wave13B2F2CsvControlMarkers([IO.Stream]$Stream) {
  $markers = [System.Collections.Generic.List[string]]::new()
  $failureCodes = [System.Collections.Generic.List[string]]::new()
  $stream.Position = 0
  $buffer = [byte[]]::new(81920)
  $line = [Text.StringBuilder]::new()
  $insideQuotedField = $false
  $quotePending = $false
  $afterQuotedField = $false
  $fieldStart = $true
  $lineMayBeControl = $true
  $lineOverflow = $false
  $maxPhysicalLineBytes = 8192

  while (($read = $Stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
    for ($index = 0; $index -lt $read; $index++) {
      $byte = $buffer[$index]
      if ($insideQuotedField -and $quotePending) {
        if ($byte -eq 34) {
          $quotePending = $false
          continue
        }
        $insideQuotedField = $false
        $quotePending = $false
        $afterQuotedField = $true
      }

      if ($byte -eq 10) {
        if (-not $insideQuotedField) {
          if ($lineMayBeControl -and -not $lineOverflow) {
            $candidate = $line.ToString().TrimEnd("`r")
            Add-Wave13B2F2CsvControlCandidate -Candidate $candidate -Markers $markers -FailureCodes $failureCodes
          } elseif ($lineOverflow) {
            $failureCodes.Add('F2_EVIDENCE_CSV_LINE_TOO_LONG')
          }
          $fieldStart = $true
          $afterQuotedField = $false
          $lineMayBeControl = $true
        } else {
          $lineMayBeControl = $false
        }
        [void]$line.Clear()
        $lineOverflow = $false
        continue
      }

      if ($lineMayBeControl -and -not $lineOverflow) {
        if ($line.Length -lt $maxPhysicalLineBytes) { [void]$line.Append([char]$byte) } else { $lineOverflow = $true }
      }

      if ($insideQuotedField) {
        if ($byte -eq 34) { $quotePending = $true }
      } elseif ($byte -eq 34) {
        if ($fieldStart) {
          $insideQuotedField = $true
          $lineMayBeControl = $false
        } else {
          $failureCodes.Add('F2_EVIDENCE_CSV_PARSE_FAILED')
          $lineMayBeControl = $false
        }
      } elseif ($byte -eq 44) {
        if ($afterQuotedField) { $afterQuotedField = $false }
        $fieldStart = $true
        $lineMayBeControl = $false
      } elseif ($byte -ne 13) {
        if ($afterQuotedField) { $failureCodes.Add('F2_EVIDENCE_CSV_PARSE_FAILED'); $afterQuotedField = $false }
        $fieldStart = $false
      }
    }
  }

  if ($insideQuotedField -and $quotePending) {
    $insideQuotedField = $false
    $quotePending = $false
  }
  if ($insideQuotedField) { $failureCodes.Add('F2_EVIDENCE_CSV_PARSE_FAILED') }
  if ($line.Length -gt 0 -and $lineMayBeControl -and -not $lineOverflow) {
    $candidate = $line.ToString().TrimEnd("`r")
    Add-Wave13B2F2CsvControlCandidate -Candidate $candidate -Markers $markers -FailureCodes $failureCodes
  } elseif ($lineOverflow) {
    $failureCodes.Add('F2_EVIDENCE_CSV_LINE_TOO_LONG')
  }
  $Stream.Position = 0
  return [pscustomobject]@{
    ControlMarkers = [string[]]$markers.ToArray()
    FailureCodes = [string[]]@($failureCodes.ToArray() | Select-Object -Unique)
  }
}

function Invoke-Wave13B2F2Psql(
  [string]$PsqlExecutable,
  [string[]]$ArgumentList,
  [string]$EvidencePath,
  [string]$AclCheckerPath,
  [string]$ExpectedSourceSha,
  [string]$ExpectedQuerySha256,
  [ValidateRange(1, 3600)]
  [int]$TimeoutSeconds = 60
) {
  $failureCodes = [System.Collections.Generic.List[string]]::new()
  $exitCode = -1
  $processStarted = $false
  $processId = -1
  $timedOut = $false
  $interrupted = $false
  $captureComplete = $false
  $evidenceWriter = $null
  $evidenceReadLock = $null
  $stdoutHash = $null
  $stderrTask = $null
  $stderrCapture = $null
  $stdoutTask = $null
  $process = [Diagnostics.Process]::new()
  $evidence = $null
  $stderrBytes = 0L
  $stderrSha256 = 'unavailable'
  $stdoutSha256 = 'unavailable'
  $stdoutBytes = -1L
  $evidenceVerified = $false
  $controlMarkers = [string[]]@()
  $stderrMarkers = [string[]]@()

  $created = New-Wave13B2F2OwnerEvidenceFile `
    -Path $EvidencePath `
    -AclCheckerPath $AclCheckerPath `
    -ExpectedSourceSha $ExpectedSourceSha `
    -ExpectedQuerySha256 $ExpectedQuerySha256
  foreach ($code in $created.FailureCodes) { $failureCodes.Add($code) }
  if ($null -eq $created.Stream) {
    return [pscustomobject]@{
      ExitCode = -1; PsqlStarted = $false; ProcessId = -1; CaptureComplete = $false
      ControlMarkers = [string[]]@(); StderrMarkers = [string[]]@(); DiagnosticLines = [string[]]@()
      FailureCodes = [string[]]$failureCodes.ToArray(); EvidenceVerified = $false
      EvidenceBytes = -1L; EvidenceSha256 = 'unavailable'; EvidencePath = $EvidencePath
      StderrBytes = 0L; StderrSha256 = 'unavailable'; OutputFormat = 'csv'
    }
  }
  $evidenceWriter = $created.Stream

  try {
    $evidenceReadLock = [IO.File]::Open([IO.Path]::GetFullPath($EvidencePath), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  } catch {
    $failureCodes.Add('F2_EVIDENCE_VERIFY_FAILED')
  }
  if ($failureCodes.Count -gt 0) {
    $evidenceWriter.Dispose()
    if ($null -ne $evidenceReadLock) { $evidenceReadLock.Dispose() }
    return [pscustomobject]@{
      ExitCode = -1; PsqlStarted = $false; ProcessId = -1; CaptureComplete = $false
      ControlMarkers = [string[]]@(); StderrMarkers = [string[]]@(); DiagnosticLines = [string[]]@()
      FailureCodes = [string[]]@($failureCodes.ToArray() | Select-Object -Unique); EvidenceVerified = $false
      EvidenceBytes = -1L; EvidenceSha256 = 'unavailable'; EvidencePath = $EvidencePath
      StderrBytes = 0L; StderrSha256 = 'unavailable'; OutputFormat = 'csv'
    }
  }

  try {
    if (-not (Test-Wave13B2F2NoReparsePath -Path $EvidencePath)) {
      $failureCodes.Add('F2_EVIDENCE_REPARSE_DETECTED')
      throw 'F2 evidence path check failed.'
    }
    if (-not (Test-Wave13B2F2ProtectedAcl -Path $EvidencePath -AclCheckerPath $AclCheckerPath)) {
      $failureCodes.Add('F2_EVIDENCE_ACL_MISMATCH')
      throw 'F2 evidence ACL check failed.'
    }
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $PsqlExecutable
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($argument in $ArgumentList) { [void]$startInfo.ArgumentList.Add([string]$argument) }
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw 'F2_PSQL_PROCESS_START_FAILED' }
    $processStarted = $true
    $processId = [int]$process.Id

    $stdoutHash = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    $stdoutTask = [Wave13B2F2.RawOutputPump]::CopyAsync($process.StandardOutput.BaseStream, $evidenceWriter, $stdoutHash)
    $stderrTask = [Wave13B2F2.RawOutputPump]::DrainStderrAsync($process.StandardError.BaseStream)

    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
      $timedOut = $true
      try { $process.Kill($true) } catch { }
      $process.WaitForExit()
      $failureCodes.Add('F2_PSQL_TIMEOUT')
    }
    $stdoutBytes = [long]$stdoutTask.GetAwaiter().GetResult()
    $stderrCapture = $stderrTask.GetAwaiter().GetResult()
    $evidenceWriter.Flush($true)
    $exitCode = [int]$process.ExitCode
    $captureComplete = -not $timedOut
  } catch {
    if ($processStarted) {
      try {
        if (-not $process.HasExited) {
          $interrupted = -not $timedOut
          $process.Kill($true)
          $process.WaitForExit()
        }
      } catch { }
      if ($null -ne $stdoutTask) { try { $stdoutTask.GetAwaiter().GetResult() } catch { } }
      if ($null -ne $stderrTask) { try { $stderrCapture = $stderrTask.GetAwaiter().GetResult() } catch { } }
      if ($null -ne $evidenceWriter) { try { $evidenceWriter.Flush($true) } catch { } }
      try { if ($process.HasExited) { $exitCode = [int]$process.ExitCode } } catch { }
    } else {
      if ($failureCodes.Count -eq 0) { $failureCodes.Add('F2_PSQL_PROCESS_START_FAILED') }
    }
    if ($timedOut -and -not $failureCodes.Contains('F2_PSQL_TIMEOUT')) { $failureCodes.Add('F2_PSQL_TIMEOUT') }
    elseif ($interrupted -or $processStarted) { $failureCodes.Add('F2_PSQL_INTERRUPTED') }
    if (-not $captureComplete) { $failureCodes.Add('F2_PSQL_CAPTURE_FAILED') }
  } finally {
    if ($null -ne $evidenceWriter) {
      try { $evidenceWriter.Flush($true) } catch { }
      try { $evidenceWriter.Dispose() } catch { }
    }
    try { if ($processStarted -and $process.HasExited) { $exitCode = [int]$process.ExitCode } } catch { }
  }

  if ($null -ne $stderrTask) {
    try {
      if ($null -eq $stderrCapture) { $stderrCapture = $stderrTask.GetAwaiter().GetResult() }
      $stderrBytes = [long]$stderrCapture.ByteCount
      $stderrSha256 = [string]$stderrCapture.Sha256
      $stderrMarkers = [string[]]$stderrCapture.Markers
      if (-not $stderrCapture.MarkerScanComplete) { $failureCodes.Add('F2_PSQL_STDERR_MARKER_SCAN_INCOMPLETE') }
    } catch {
      $failureCodes.Add('F2_PSQL_CAPTURE_FAILED')
    }
  }
  if ($null -ne $stdoutHash) {
    try {
      $stdoutSha256 = [BitConverter]::ToString($stdoutHash.GetHashAndReset()).Replace('-', '').ToLowerInvariant()
    } catch { $failureCodes.Add('F2_PSQL_CAPTURE_FAILED') }
    finally { $stdoutHash.Dispose() }
  }

  if ($null -ne $evidenceReadLock) {
    $evidence = Get-Wave13B2F2OwnerEvidenceVerification `
      -Path $EvidencePath `
      -AclCheckerPath $AclCheckerPath `
      -ExpectedSourceSha $ExpectedSourceSha `
      -ExpectedQuerySha256 $ExpectedQuerySha256 `
      -ExpectedLength $stdoutBytes `
      -ExpectedSha256 $stdoutSha256 `
      -ReadLock $evidenceReadLock
    $evidenceReadLock = $evidence.ReadLock
    foreach ($code in $evidence.FailureCodes) { $failureCodes.Add($code) }
    if (-not $captureComplete) { $failureCodes.Add('F2_EVIDENCE_CAPTURE_INCOMPLETE') }
    $evidenceCaptureFailed = @($failureCodes | Where-Object { $_ -match '^F2_EVIDENCE_' -or $_ -eq 'F2_PSQL_CAPTURE_FAILED' -or $_ -eq 'F2_PSQL_INTERRUPTED' -or $_ -eq 'F2_PSQL_TIMEOUT' -or $_ -eq 'F2_PSQL_STDERR_MARKER_SCAN_INCOMPLETE' }).Count -gt 0
    $evidenceVerified = $evidence.Verified -and $captureComplete -and -not $evidenceCaptureFailed
    $stdoutBytes = $evidence.ByteLength
    if ($evidence.Verified) { $stdoutSha256 = $evidence.Sha256 }
    $parsed = Get-Wave13B2F2CsvControlMarkers -Stream $evidenceReadLock
    $controlMarkers = $parsed.ControlMarkers
    foreach ($code in $parsed.FailureCodes) { $failureCodes.Add($code) }
    if ($parsed.FailureCodes.Count -gt 0) { $evidenceVerified = $false }
  } else {
    $failureCodes.Add('F2_EVIDENCE_MISSING')
  }

  $allDiagnosticLines = [string[]]@($controlMarkers + $stderrMarkers)
  try { if ($null -ne $evidenceReadLock) { $evidenceReadLock.Dispose() } } catch { }
  try { $process.Dispose() } catch { }

  return [pscustomobject]@{
    ExitCode = $exitCode
    PsqlStarted = $processStarted
    ProcessId = $processId
    CaptureComplete = $captureComplete
    ControlMarkers = [string[]]$controlMarkers
    StderrMarkers = [string[]]$stderrMarkers
    DiagnosticLines = $allDiagnosticLines
    FailureCodes = [string[]]@($failureCodes.ToArray() | Select-Object -Unique)
    EvidenceVerified = $evidenceVerified
    EvidenceBytes = $stdoutBytes
    EvidenceSha256 = $stdoutSha256
    EvidencePath = $EvidencePath
    StderrBytes = $stderrBytes
    StderrSha256 = $stderrSha256
    OutputFormat = 'csv'
  }
}

function Get-Wave13B2F2RunClassification(
  [int]$ExitCode,
  [string[]]$ControlMarkers,
  [string[]]$StderrMarkers,
  [string]$ExpectedSourceSha,
  [string]$ExpectedQuerySha256,
  [bool]$EvidenceVerified,
  [string[]]$FailureCodes
) {
  if ($ExpectedSourceSha -notmatch '^[a-f0-9]{40}$' -or $ExpectedQuerySha256 -notmatch '^[a-f0-9]{64}$') {
    throw 'F2 result classification requires exact source and query hashes.'
  }

  $allMarkers = [string[]]@($ControlMarkers + $StderrMarkers)
  $failureCodesOut = [System.Collections.Generic.List[string]]::new()
  foreach ($code in $FailureCodes) {
    if (Test-Wave13B2F2AllowedFailureCode -Code ([string]$code)) { $failureCodesOut.Add($code) }
  }
  $allFailMarkers = @([regex]::Matches(($allMarkers -join "`n"), '(?m)^F2_FAIL ([A-Z0-9_]+)$'))
  $markerFailureCodes = @($allFailMarkers | ForEach-Object { $_.Groups[1].Value } | Where-Object { $script:Wave13B2F2SqlFailureCodes.Contains($_) } | Select-Object -Unique)
  foreach ($code in $markerFailureCodes) { $failureCodesOut.Add($code) }
  if ($allFailMarkers.Count -gt $markerFailureCodes.Count) { $failureCodesOut.Add('F2_UNALLOWLISTED_MARKER_PRESENT') }
  $stopCount = [regex]::Matches(($allMarkers -join "`n"), '(?m)^F2_STOP\b').Count
  $expectedDone = 'F2_DONE PASS source=' + $ExpectedSourceSha + ' query=' + $ExpectedQuerySha256
  $doneLines = @([regex]::Matches(($ControlMarkers -join "`n"), '(?m)^F2_DONE.*$') | ForEach-Object { $_.Value })
  $doneMatches = $doneLines.Count -eq 1 -and $doneLines[0] -ceq $expectedDone
  $markerFailuresPresent = $allFailMarkers.Count -gt 0 -or $stopCount -gt 0
  $completed = $ExitCode -eq 0 -and $EvidenceVerified -and $doneMatches -and -not $markerFailuresPresent -and $failureCodesOut.Count -eq 0

  if ($ExitCode -ne 0) {
    if ($ExitCode -lt 0) { $failureCodesOut.Add('F2_PSQL_EXIT_CODE_UNKNOWN') }
    else { $failureCodesOut.Add('F2_PSQL_EXIT_CODE_' + $ExitCode) }
  }
  if ($stopCount -gt 0) { $failureCodesOut.Add('F2_STOP_MARKER_PRESENT') }
  if (-not $doneMatches) { $failureCodesOut.Add('F2_DONE_MARKER_MISSING_OR_INVALID') }
  if (-not $EvidenceVerified) { $failureCodesOut.Add('F2_EVIDENCE_NOT_VERIFIED') }
  if ($failureCodesOut.Count -eq 0 -and -not $completed) { $failureCodesOut.Add('F2_RUNNER_RESULT_INVALID') }

  return [pscustomobject]@{
    Status = if ($completed) { 'COMPLETED' } else { 'FAILED' }
    ExitCode = $ExitCode
    FailureCodes = [string[]]@($failureCodesOut.ToArray() | Select-Object -Unique)
    DoneMarker = if ($doneMatches) { $doneLines[0] } else { $null }
  }
}

function New-Wave13B2F2AuditContent(
  [string]$SourceSha,
  [string]$QuerySha256,
  [pscustomobject]$RunResult,
  [pscustomobject]$Classification
) {
  $diagnostics = @(Get-Wave13B2F2SafeDiagnosticLines -Lines ([string[]]$RunResult.DiagnosticLines) -IncludeCompletion)
  $safeFailureCodes = @($Classification.FailureCodes | Where-Object { Test-Wave13B2F2AllowedFailureCode -Code ([string]$_) } | Select-Object -Unique)
  $header = @(
    'F2_AUDIT_FORMAT=2'
    'sourceSha=' + $SourceSha
    'queryPacketSha256=' + $QuerySha256
    'outputFormat=csv'
    'psqlStarted=' + ([bool]$RunResult.PsqlStarted).ToString().ToLowerInvariant()
    'psqlExitCode=' + $RunResult.ExitCode
    'status=' + $Classification.Status
    'failureCodes=' + ($safeFailureCodes -join ',')
    'evidenceFile=' + [IO.Path]::GetFileName([string]$RunResult.EvidencePath)
    'evidenceBytes=' + $RunResult.EvidenceBytes
    'evidenceSha256=' + $RunResult.EvidenceSha256
    'evidenceVerified=' + ([bool]$RunResult.EvidenceVerified).ToString().ToLowerInvariant()
    'stderrBytes=' + $RunResult.StderrBytes
    'stderrSha256=' + $RunResult.StderrSha256
    'sanitizedMarkerCount=' + $diagnostics.Count
    'sanitizedMarkersBegin'
  )
  return (($header + @($diagnostics) + @('sanitizedMarkersEnd', '')) -join "`n")
}

function Write-Wave13B2F2AuditEvidence([string]$Path, [string]$Content, [string]$AclCheckerPath) {
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Content)
  $stream = $null
  try {
    $directoryPath = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Path))
    if (-not (Test-Path -LiteralPath $directoryPath -PathType Container) -or
      -not (Test-Wave13B2F2NoReparsePath -Path $directoryPath) -or
      -not (Test-Wave13B2F2ProtectedAcl -Path $directoryPath -AclCheckerPath $AclCheckerPath)) {
      throw 'F2 sanitized audit directory could not be verified.'
    }
    $createStream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $createStream.Dispose()
    Set-Wave13B2F2OwnerOnlyProtectedAcl -Path $Path
    if (-not (Test-Wave13B2F2NoReparsePath -Path $Path) -or -not (Test-Wave13B2F2NoReparsePath -Path $directoryPath) -or
      -not (Test-Wave13B2F2ProtectedAcl -Path $Path -AclCheckerPath $AclCheckerPath) -or
      -not (Test-Wave13B2F2ProtectedAcl -Path $directoryPath -AclCheckerPath $AclCheckerPath)) {
      throw 'F2 sanitized audit evidence could not be protected.'
    }
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
    $stream.Dispose()
    $stream = $null
    if (-not (Test-Wave13B2F2NoReparsePath -Path $Path) -or -not (Test-Wave13B2F2NoReparsePath -Path $directoryPath) -or
      -not (Test-Wave13B2F2ProtectedAcl -Path $Path -AclCheckerPath $AclCheckerPath) -or
      -not (Test-Wave13B2F2ProtectedAcl -Path $directoryPath -AclCheckerPath $AclCheckerPath)) {
      throw 'F2 sanitized audit evidence could not be protected.'
    }
    $verify = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
      $verifiedSha = Get-Wave13B2F2QuerySha256 -Bytes ([IO.File]::ReadAllBytes($Path))
      if ($verify.Length -ne $bytes.Length -or $verifiedSha -cne (Get-Wave13B2F2QuerySha256 -Bytes $bytes)) {
        throw 'F2 sanitized audit verification failed.'
      }
    } finally { $verify.Dispose() }
  } catch {
    if ($null -ne $stream) { $stream.Dispose() }
    throw 'F2 sanitized audit evidence could not be written securely.'
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
  $failureCodes = @($Classification.FailureCodes | Where-Object { Test-Wave13B2F2AllowedFailureCode -Code ([string]$_) })
  $evidenceFile = if ([string]::IsNullOrWhiteSpace([string]$RunResult.EvidencePath)) { 'unavailable' } else { [IO.Path]::GetFileName([string]$RunResult.EvidencePath) }
  $lines = @(
    'status=' + $Classification.Status
    'finishedAtUtc=' + [DateTime]::UtcNow.ToString('o')
    'psqlExitCode=' + $RunResult.ExitCode
    'failureCodes=' + ($failureCodes -join ',')
    'outputFormat=csv'
    'evidenceFile=' + $evidenceFile
    'evidenceBytes=' + $RunResult.EvidenceBytes
    'evidenceSha256=' + $RunResult.EvidenceSha256
    'evidenceVerified=' + ([bool]$RunResult.EvidenceVerified).ToString().ToLowerInvariant()
    'auditFile=' + $AuditFileName
    'auditSha256=' + $AuditSha256
    ''
  )
  [IO.File]::AppendAllText($MarkerPath, ($lines -join "`n"), [Text.UTF8Encoding]::new($false))
}

Export-ModuleMember -Function @(
  'Add-Wave13B2F2AttemptResult',
  'Assert-Wave13B2F2QueryDigest',
  'Get-Wave13B2F2CsvControlMarkers',
  'Get-Wave13B2F2OwnerEvidenceVerification',
  'Get-Wave13B2F2QuerySha256',
  'Get-Wave13B2F2RunClassification',
  'Invoke-Wave13B2F2Psql',
  'New-Wave13B2F2AuditContent',
  'New-Wave13B2F2OwnerOnlyBoundFile',
  'New-Wave13B2F2OwnerEvidenceFile',
  'Test-Wave13B2F2EvidencePathBinding',
  'Write-Wave13B2F2AuditEvidence'
)
