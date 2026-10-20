[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [Parameter(Mandatory = $true)]
  [string]$SourceSha,
  [Parameter(Mandatory = $true)]
  [string]$QuerySha256,
  [Parameter(Mandatory = $true)]
  [string]$ContentBase64
)

$ErrorActionPreference = 'Stop'

if ($SourceSha -notmatch '^[a-f0-9]{40}$' -or $QuerySha256 -notmatch '^[a-f0-9]{64}$') {
  throw 'Owner review receipt source/query pins are invalid.'
}

try {
  $contentBytes = [Convert]::FromBase64String($ContentBase64)
} catch {
  throw 'Owner review receipt content encoding is invalid.'
}

$modulePath = Join-Path $PSScriptRoot 'lib/wave13b2-f2-runner.psm1'
Import-Module -Name $modulePath -Force
$result = New-Wave13B2F2OwnerOnlyBoundFile `
  -Path $Path `
  -Bytes $contentBytes `
  -SourceSha $SourceSha `
  -QuerySha256 $QuerySha256

if ($null -eq $result -or -not $result.Verified -or $result.FailureCodes.Count -gt 0) {
  throw 'Owner review receipt verification failed.'
}

'OWNER_REVIEW_RECEIPT_CREATE_PASS'
