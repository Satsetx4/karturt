[CmdletBinding()]
param(
    [string]$ApprovedBaselinePath = $env:KARTURT_D1V2_APPROVED_BASELINE_PATH
)

# Offline-only readiness check for the frozen D1v2 packet.
# This script never starts psql, opens a database connection, wakes compute,
# reads credential/baseline contents, or writes an extracted SQL file.

$ErrorActionPreference = 'Stop'

$ExpectedBlobSha1 = 'e011f0e843d42d53c7c4c76ba479854644137fc9'
$ExpectedManifestSha256 = 'ab7193d72520482a50081fdb65edc098fdac1cc9530d161430ddc6b9a0759db0'
$ExpectedStatementCount = 26
$ExpectedHost = 'ep-silent-butterfly-azrflu40.c-3.ap-southeast-1.aws.neon.tech'
$ExpectedProjectId = 'falling-bread-33359184'
$ExpectedBranchId = 'br-muddy-frost-azot13fb'
$ExpectedDatabaseId = '702718'
$ExpectedRole = 'karturt_staging_owner'
$SqlRelativePath = 'docs/wave13b-1r/2026-10-14/WAVE13B_1R_FIXED_SQL_REFERENCE.md'

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..\..')).Path
$sqlPath = Join-Path $repoRoot ($SqlRelativePath -replace '/', '\')
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check {
    param(
        [string]$Name,
        [bool]$Passed,
        [string]$Detail
    )

    $script:checks.Add([pscustomobject]@{
        name = $Name
        status = if ($Passed) { 'PASS' } else { 'BLOCKED' }
        detail = $Detail
    })
}

function Get-Sha256Hex {
    param([byte[]]$Bytes)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha.ComputeHash($Bytes)
        return [System.BitConverter]::ToString($digest).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Convert-ToSecurityIdentifier {
    param([System.Security.Principal.IdentityReference]$IdentityReference)

    try {
        return $IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    }
    catch {
        return $null
    }
}

function Test-SafeLocalPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or -not [System.IO.Path]::IsPathRooted($Path)) {
        return $false
    }
    if ($Path.StartsWith('\\') -or $Path.StartsWith('//')) {
        return $false
    }

    try {
        $fullPath = [System.IO.Path]::GetFullPath($Path)
        if ($fullPath -match '^(\\\\|//)') {
            return $false
        }
        $root = [System.IO.Path]::GetPathRoot($fullPath)
        if ($root -notmatch '^[A-Za-z]:\\$') {
            return $false
        }
        $drive = [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.Name -ieq $root } | Select-Object -First 1
        if ($null -eq $drive -or $drive.DriveType -ne [System.IO.DriveType]::Fixed) {
            return $false
        }

        $segments = $fullPath.Substring($root.Length).Split([char[]]@('\', '/'), [System.StringSplitOptions]::RemoveEmptyEntries)
        $current = $root
        foreach ($segment in $segments) {
            $current = Join-Path $current $segment
            if (-not (Test-Path -LiteralPath $current)) {
                break
            }
            $item = Get-Item -LiteralPath $current -Force
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                return $false
            }
        }
        return $true
    }
    catch {
        return $false
    }
}

function Test-OwnerOnlyCredentialFile {
    param([string]$Path)

    $result = [ordered]@{
        exists = $false
        readable = $false
        ownerIsCurrentUser = $false
        principalsRestricted = $false
        secure = $false
    }

    if (-not (Test-SafeLocalPath -Path $Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]$result
    }

    $result.exists = $true
    try {
        $stream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
        $stream.Dispose()
        $result.readable = $true

        $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544')
        $acl = Get-Acl -LiteralPath $Path
        $ownerSid = Convert-ToSecurityIdentifier -IdentityReference $acl.GetOwner([System.Security.Principal.SecurityIdentifier])
        $result.ownerIsCurrentUser = ($ownerSid -eq $currentSid)

        $rules = $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
        $badRule = $false
        $currentUserCanRead = $false
        foreach ($rule in $rules) {
            $sid = $rule.IdentityReference.Value
            if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $sid -notin $allowedSids) {
                $badRule = $true
            }
            if ($sid -eq $currentSid -and $rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow) {
                $rights = [System.Security.AccessControl.FileSystemRights]$rule.FileSystemRights
                if (($rights -band [System.Security.AccessControl.FileSystemRights]::ReadData) -ne 0 -or
                    ($rights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne 0) {
                    $currentUserCanRead = $true
                }
            }
        }

        $result.principalsRestricted = (-not $badRule) -and $currentUserCanRead
        $result.secure = $result.exists -and $result.readable -and $result.ownerIsCurrentUser -and $result.principalsRestricted
    }
    catch {
        # Do not expose exception text: it can contain local paths or identities.
        $result.secure = $false
    }

    return [pscustomobject]$result
}

function Test-CaFile {
    param([string]$Path)

    $result = [ordered]@{
        exists = $false
        readable = $false
        noBroadWriteGrant = $false
    }

    if (-not (Test-SafeLocalPath -Path $Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]$result
    }

    $result.exists = $true
    try {
        $stream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
        $stream.Dispose()
        $result.readable = $true

        $broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
        $writeRights = [System.Security.AccessControl.FileSystemRights]::WriteData -bor
            [System.Security.AccessControl.FileSystemRights]::AppendData -bor
            [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor
            [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
            [System.Security.AccessControl.FileSystemRights]::Delete -bor
            [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
            [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor
            [System.Security.AccessControl.FileSystemRights]::TakeOwnership -bor
            [System.Security.AccessControl.FileSystemRights]::Modify -bor
            [System.Security.AccessControl.FileSystemRights]::FullControl
        $broadWrite = $false
        $acl = Get-Acl -LiteralPath $Path
        foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
                $rule.IdentityReference.Value -in $broadSids -and
                (([System.Security.AccessControl.FileSystemRights]$rule.FileSystemRights -band $writeRights) -ne 0)) {
                $broadWrite = $true
            }
        }
        $result.noBroadWriteGrant = -not $broadWrite
    }
    catch {
        # Do not expose exception text: it can contain local paths or identities.
        $result.noBroadWriteGrant = $false
    }

    return [pscustomobject]$result
}

# Verify committed and working-tree identity without changing the index or repository.
$headBlob = ''
$workBlob = ''
$worktreeMatchesHead = $false
try {
    $headBlob = (& git -C $repoRoot rev-parse "HEAD:$SqlRelativePath" 2>$null).Trim()
    if ($LASTEXITCODE -eq 0) {
        $workBlob = (& git -C $repoRoot hash-object "--path=$SqlRelativePath" $SqlRelativePath 2>$null).Trim()
        $hashExit = $LASTEXITCODE
        & git -C $repoRoot diff --quiet HEAD -- $SqlRelativePath 2>$null
        $diffExit = $LASTEXITCODE
        $worktreeMatchesHead = ($hashExit -eq 0) -and ($diffExit -eq 0)
    }
}
catch {
    $headBlob = ''
    $workBlob = ''
}

$blobVerified = ($headBlob -eq $ExpectedBlobSha1) -and ($workBlob -eq $ExpectedBlobSha1) -and $worktreeMatchesHead
Add-Check 'frozen_reference_blob' $blobVerified 'Committed and working-tree reference must match the approved blob SHA-1.'

$manifestVerified = $false
$manifestHash = ''
$statementCount = 0
$statementHashesMatchTable = $false
try {
    $referenceText = [System.IO.File]::ReadAllText($sqlPath).Replace("`r`n", "`n").Replace("`r", "`n")
    $fences = [System.Text.RegularExpressions.Regex]::Matches(
        $referenceText,
        '(?ms)^~~~sql[ \t]*\n(.*?)\n~~~[ \t]*$'
    )
    $statementCount = $fences.Count

    $embeddedHashes = @{}
    foreach ($line in ($referenceText -split "`n")) {
        if ($line -match '^\|\s*(Q\d{2})\s*\|\s*([0-9a-f]{64})\s*\|\s*$') {
            $embeddedHashes[$Matches[1]] = $Matches[2]
        }
    }

    $manifestLines = [System.Collections.Generic.List[string]]::new()
    $statementHashesMatchTable = ($statementCount -eq $ExpectedStatementCount) -and ($embeddedHashes.Count -eq $ExpectedStatementCount)
    for ($index = 0; $index -lt $fences.Count; $index++) {
        $statementId = 'Q{0:D2}' -f ($index + 1)
        $body = $fences[$index].Groups[1].Value
        $digest = Get-Sha256Hex -Bytes ([System.Text.Encoding]::UTF8.GetBytes($body))
        $manifestLines.Add("${statementId}:$digest")
        if (-not $embeddedHashes.ContainsKey($statementId) -or $embeddedHashes[$statementId] -ne $digest) {
            $statementHashesMatchTable = $false
        }
    }

    if ($manifestLines.Count -eq $ExpectedStatementCount) {
        $manifestText = ($manifestLines -join "`n") + "`n"
        $manifestHash = Get-Sha256Hex -Bytes ([System.Text.Encoding]::UTF8.GetBytes($manifestText))
        $manifestVerified = $statementHashesMatchTable -and ($manifestHash -eq $ExpectedManifestSha256)
    }
}
catch {
    $manifestVerified = $false
}
Add-Check 'ordered_26_statement_manifest' $manifestVerified 'Exactly 26 ordered SQL fences, each matching its embedded fingerprint and the approved manifest SHA-256.'

# Search only local fixed-drive PATH entries. UNC, network-drive, and reparse-point paths are rejected
# before filesystem inspection; the executable is never launched.
$psqlPath = $null
foreach ($pathEntry in ($env:Path -split ';')) {
    if (-not (Test-SafeLocalPath -Path $pathEntry)) {
        continue
    }
    $candidate = Join-Path $pathEntry 'psql.exe'
    if (Test-SafeLocalPath -Path $candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        $psqlPath = $candidate
        break
    }
}
$psqlPresent = -not [string]::IsNullOrWhiteSpace($psqlPath)
$psqlFile = if ($psqlPresent) { Test-CaFile -Path $psqlPath } else { $null }
$psqlPassed = $psqlPresent -and $psqlFile.exists -and $psqlFile.readable -and $psqlFile.noBroadWriteGrant
Add-Check 'psql_executable_presence_permissions' $psqlPassed $(if ($psqlPassed) { 'Executable detected and readable; no broad write grant; not launched; version remains unverified.' } else { 'PostgreSQL client executable is missing, unreadable, or has an untrusted broad write grant.' })

# libpq accepts PGSSLROOTCERT; otherwise its Windows default is %APPDATA%\postgresql\root.crt.
$caPath = [Environment]::GetEnvironmentVariable('PGSSLROOTCERT', 'Process')
$caSource = 'libpq Windows default'
if ([string]::IsNullOrWhiteSpace($caPath)) {
    $caPath = Join-Path $env:APPDATA 'postgresql\root.crt'
} else {
    $caSource = 'PGSSLROOTCERT override'
}
$ca = Test-CaFile -Path $caPath
$caPassed = $ca.exists -and $ca.readable -and $ca.noBroadWriteGrant
Add-Check 'trusted_ca_file_presence_permissions' $caPassed $(if ($caPassed) { "$caSource exists, is readable, and has no broad write grant; certificate trust and TLS handshake remain unverified." } else { "$caSource is missing, unreadable, or has an untrusted broad write grant." })

# Do not print or read the credential path or file contents.
$credentialPath = [Environment]::GetEnvironmentVariable('PGPASSFILE', 'Process')
$credentialSource = 'libpq Windows default'
if ([string]::IsNullOrWhiteSpace($credentialPath)) {
    $credentialPath = Join-Path $env:APPDATA 'postgresql\pgpass.conf'
} else {
    $credentialSource = 'PGPASSFILE override'
}
$credential = Test-OwnerOnlyCredentialFile -Path $credentialPath
Add-Check 'owner_only_pgpassfile' ([bool]$credential.secure) $(if ($credential.secure) { "$credentialSource exists; current user owns and can read it; ACL principals are restricted; contents were not read." } else { "$credentialSource is missing or its owner, read access, or ACL could not be verified." })

# The baseline is sensitive and separately approved. This aid checks only file presence/readability,
# never content or approval; a human must still verify its exact target binding and approval.
$baselinePresent = $false
$baselineReadable = $false
if (Test-SafeLocalPath -Path $ApprovedBaselinePath -and (Test-Path -LiteralPath $ApprovedBaselinePath -PathType Leaf)) {
    $baselinePresent = $true
    try {
        $stream = [System.IO.File]::Open(
            $ApprovedBaselinePath,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
        $stream.Dispose()
        $baselineReadable = $true
    }
    catch {
        $baselineReadable = $false
    }
}
Add-Check 'separate_baseline_file_presence' ($baselinePresent -and $baselineReadable) $(if ($baselinePresent -and $baselineReadable) { 'File is present and readable; content and owner approval were not inspected and require separate review.' } else { 'No readable baseline file was supplied through -ApprovedBaselinePath or KARTURT_D1V2_APPROVED_BASELINE_PATH.' })

# The required connection policy is printed as a fixed expectation only. This script does not
# build a connection string or invoke a client. A later approved run must explicitly use verify-full.
Add-Check 'tls_target_expectation' $true "Required later run: sslmode=verify-full; direct host=$ExpectedHost; project=$ExpectedProjectId; branch=$ExpectedBranchId; database_id=$ExpectedDatabaseId; role=$ExpectedRole. No connection attempted."

$allLocalGates = $blobVerified -and $manifestVerified -and $psqlPresent -and $caPassed -and [bool]$credential.secure -and $baselinePresent -and $baselineReadable
$result = if ($allLocalGates) { 'OFFLINE_GATES_PRESENT_HUMAN_REVIEW_REQUIRED' } else { 'NOT_EXECUTED_ACCESS_SAFETY_BLOCKED' }
$summary = [ordered]@{
    result = $result
    mode = 'OFFLINE_ONLY_NO_DATABASE_CONNECTION_CAPABILITY'
    databaseConnectionAttempted = $false
    psqlLaunched = $false
    credentialContentsRead = $false
    baselineContentsRead = $false
    sqlFileCreated = $false
    frozenBlobSha1 = $headBlob
    workingTreeBlobSha1 = $workBlob
    statementFenceCount = $statementCount
    statementHashesMatchEmbeddedTable = $statementHashesMatchTable
    orderedManifestSha256 = $manifestHash
    caFileSource = $caSource
    credentialFileSource = $credentialSource
    expectedDirectHost = $ExpectedHost
    requiredTlsMode = 'verify-full'
    baselineApprovalVerified = $false
    checks = @($checks)
}

$summary | ConvertTo-Json -Depth 5
if ($result -eq 'NOT_EXECUTED_ACCESS_SAFETY_BLOCKED') {
    exit 2
}
exit 0
