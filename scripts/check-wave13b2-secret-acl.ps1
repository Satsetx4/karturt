[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Path,
  [switch]$RequireProtected
)

$ErrorActionPreference = 'Stop'

try {
  $currentPath = [System.IO.Path]::GetFullPath($Path)
  while (-not [string]::IsNullOrWhiteSpace($currentPath)) {
    $item = Get-Item -LiteralPath $currentPath -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'Reparse point in protected path.'
    }
    $parentPath = [System.IO.Path]::GetDirectoryName($currentPath)
    if ([string]::IsNullOrWhiteSpace($parentPath) -or $parentPath -eq $currentPath) {
      break
    }
    $currentPath = $parentPath
  }

  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'Protected path is a reparse point.'
  }

  $acl = Get-Acl -LiteralPath $Path
  if ($RequireProtected -and -not $acl.AreAccessRulesProtected) {
    throw 'Inherited permissions are enabled.'
  }

  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -ne $currentSid) {
    throw 'Protected path owner is not the current operator.'
  }

  $allowedSids = @($currentSid, 'S-1-5-18')
  $rules = @($acl.Access)
  if ($rules.Count -eq 0) {
    throw 'Protected path has no access rules.'
  }

  foreach ($rule in $rules) {
    $ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if (
      $ruleSid -notin $allowedSids -or
      $rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
      (($rule.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -ne
        [System.Security.AccessControl.FileSystemRights]::FullControl)
    ) {
      throw 'Protected path permissions are broader or weaker than the owner-only policy.'
    }
  }

  'PASS'
} catch {
  Write-Verbose ("Protected path ACL check failed: " + $_.Exception.Message)
  'BLOCKED'
  exit 2
}
