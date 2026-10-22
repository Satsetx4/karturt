Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not ('Karturt.Security.TokenInfo' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;

namespace Karturt.Security {
  public static class TokenInfo {
    [StructLayout(LayoutKind.Sequential)]
    private struct SidAndAttributes {
      public IntPtr Sid;
      public uint Attributes;
    }

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(
      IntPtr tokenHandle,
      int tokenInformationClass,
      IntPtr tokenInformation,
      uint tokenInformationLength,
      out uint returnLength);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr stringSid);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);

    public static string GetLogonSid(IntPtr tokenHandle) {
      uint length = 0;
      if (GetTokenInformation(tokenHandle, 28, IntPtr.Zero, 0, out length)) {
        throw new SecurityException("Token logon SID size query unexpectedly succeeded.");
      }
      int error = Marshal.GetLastWin32Error();
      if (error != 122 || length == 0) {
        throw new Win32Exception(error);
      }
      IntPtr buffer = Marshal.AllocHGlobal((int)length);
      try {
        if (!GetTokenInformation(tokenHandle, 28, buffer, length, out length)) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        uint groupCount = unchecked((uint)Marshal.ReadInt32(buffer));
        if (groupCount != 1) throw new SecurityException("Expected one logon SID.");
        int groupOffset = IntPtr.Size == 8 ? 8 : 4;
        SidAndAttributes group = Marshal.PtrToStructure<SidAndAttributes>(IntPtr.Add(buffer, groupOffset));
        if (group.Sid == IntPtr.Zero || (group.Attributes & 0xC0000000u) != 0xC0000000u) {
          throw new SecurityException("Token group is not the logon SID.");
        }
        IntPtr stringSid;
        if (!ConvertSidToStringSid(group.Sid, out stringSid)) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        try {
          return Marshal.PtrToStringUni(stringSid);
        } finally {
          LocalFree(stringSid);
        }
      } finally {
        Marshal.FreeHGlobal(buffer);
      }
    }
  }
}
'@
}

function Assert-StagingCaptureFile {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,

    [string]$ExpectedSha256
  )

  if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path)) {
    throw 'TLS_FILE_MISSING'
  }
  $fullPath = [IO.Path]::GetFullPath($Path)
  if (-not [IO.File]::Exists($fullPath)) { throw 'TLS_FILE_MISSING' }
  $attributes = [IO.File]::GetAttributes($fullPath)
  if (($attributes -band [IO.FileAttributes]::Directory) -ne 0 -or
      ($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'TLS_FILE_UNSAFE'
  }

  $runnerTemp = [Environment]::GetEnvironmentVariable('RUNNER_TEMP', 'Process')
  $runId = [Environment]::GetEnvironmentVariable('GITHUB_RUN_ID', 'Process')
  $runAttempt = [Environment]::GetEnvironmentVariable('GITHUB_RUN_ATTEMPT', 'Process')
  if ([string]::IsNullOrWhiteSpace($runnerTemp) -or -not [IO.Path]::IsPathRooted($runnerTemp) -or
      $runId -cnotmatch '^[0-9]{1,20}$' -or $runAttempt -cnotmatch '^[0-9]{1,4}$') {
    throw 'TLS_FILE_UNSAFE'
  }
  $captureParent = [IO.Path]::GetFullPath((Join-Path $runnerTemp 'karturt-staging-readiness'))
  $runRoot = [IO.Path]::GetFullPath((Join-Path $captureParent ($runId + '-' + $runAttempt)))
  if (-not [string]::Equals([IO.Path]::GetDirectoryName($fullPath), $runRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'TLS_FILE_UNSAFE'
  }

  $directoryPaths = [Collections.Generic.List[string]]::new()
  $directoryInfo = [IO.DirectoryInfo]::new($runRoot)
  while ($null -ne $directoryInfo) {
    $directoryPaths.Add([IO.Path]::GetFullPath($directoryInfo.FullName))
    $directoryInfo = $directoryInfo.Parent
  }
  foreach ($directoryPath in $directoryPaths) {
    if (-not [IO.Directory]::Exists($directoryPath)) { throw 'TLS_FILE_MISSING' }
    $directoryAttributes = [IO.File]::GetAttributes($directoryPath)
    if (($directoryAttributes -band [IO.FileAttributes]::Directory) -eq 0 -or
        ($directoryAttributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'TLS_FILE_UNSAFE'
    }
  }

  try {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
      $currentSid = $currentIdentity.User
      if ($null -eq $currentSid) { throw 'TLS_FILE_ACL_UNSAFE' }
      $currentLogonSessionSid = [Karturt.Security.TokenInfo]::GetLogonSid($currentIdentity.Token)
    } finally {
      $currentIdentity.Dispose()
    }
    $allowedSids = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [void]$allowedSids.Add($currentSid.Value)
    [void]$allowedSids.Add('S-1-5-18')
    [void]$allowedSids.Add('S-1-5-32-544')
    $runnerTempAcl = Get-Acl -LiteralPath $runnerTemp -ErrorAction Stop
    $runnerTempOwnerSid = $runnerTempAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if (-not $allowedSids.Contains([string]$runnerTempOwnerSid)) { throw 'TLS_FILE_ACL_UNSAFE' }
    $runnerTempCanWrite = $false
    $unsafeWriteRights = [Security.AccessControl.FileSystemRights]::WriteData -bor
      [Security.AccessControl.FileSystemRights]::AppendData -bor
      [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
      [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
      [Security.AccessControl.FileSystemRights]::Delete -bor
      [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
      [Security.AccessControl.FileSystemRights]::TakeOwnership -bor
      [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles
    $runnerTempRules = $runnerTempAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    foreach ($rule in $runnerTempRules) {
      $sid = [string]$rule.IdentityReference.Value
      if ($sid -ceq $currentSid.Value -and
          $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
          (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Modify) -eq [Security.AccessControl.FileSystemRights]::Modify)) {
        $runnerTempCanWrite = $true
      }
      if (-not $allowedSids.Contains($sid) -and
          $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
          (($rule.FileSystemRights -band $unsafeWriteRights) -ne 0)) {
        throw 'TLS_FILE_ACL_UNSAFE'
      }
    }
    if (-not $runnerTempCanWrite) { throw 'TLS_FILE_ACL_UNSAFE' }

    foreach ($directoryPath in @($captureParent, $runRoot)) {
      $directoryAcl = Get-Acl -LiteralPath $directoryPath -ErrorAction Stop
      if (-not $directoryAcl.AreAccessRulesProtected) { throw 'TLS_FILE_ACL_UNSAFE' }
      $ownerSid = $directoryAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value
      if (-not $allowedSids.Contains([string]$ownerSid)) { throw 'TLS_FILE_ACL_UNSAFE' }
      $currentSidCanWrite = $false
      $directoryRules = $directoryAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
      foreach ($rule in $directoryRules) {
        if ($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
          throw 'TLS_FILE_ACL_UNSAFE'
        }
        $sid = [string]$rule.IdentityReference.Value
        $isLogonSessionSid = $sid -ceq $currentLogonSessionSid
        if (-not $allowedSids.Contains($sid) -and -not $isLogonSessionSid) { throw 'TLS_FILE_ACL_UNSAFE' }
        if ($isLogonSessionSid -and
            (($rule.FileSystemRights -band $unsafeWriteRights) -ne 0)) {
          throw 'TLS_FILE_ACL_UNSAFE'
        }
        $modifyRights = [Security.AccessControl.FileSystemRights]::Modify
        if ($sid -ceq $currentSid.Value -and
            (($rule.FileSystemRights -band $modifyRights) -eq $modifyRights)) {
          $currentSidCanWrite = $true
        }
      }
      if (-not $currentSidCanWrite) { throw 'TLS_FILE_ACL_UNSAFE' }
    }

    $acl = Get-Acl -LiteralPath $fullPath -ErrorAction Stop
    if (-not $acl.AreAccessRulesProtected) { throw 'TLS_FILE_ACL_UNSAFE' }
    $fileOwnerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
    if (-not $allowedSids.Contains([string]$fileOwnerSid)) { throw 'TLS_FILE_ACL_UNSAFE' }
    $currentSidReadable = $false
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    foreach ($rule in $rules) {
      if ($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) {
        throw 'TLS_FILE_ACL_UNSAFE'
      }
      $sid = [string]$rule.IdentityReference.Value
      if (-not $allowedSids.Contains($sid)) { throw 'TLS_FILE_ACL_UNSAFE' }
      if ($sid -ceq $currentSid.Value -and
          (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Read) -eq [Security.AccessControl.FileSystemRights]::Read)) {
        $currentSidReadable = $true
      }
    }
    if (-not $currentSidReadable) { throw 'TLS_FILE_ACL_UNSAFE' }
  } catch {
    if ([string]$_.Exception.Message -ceq 'TLS_FILE_ACL_UNSAFE') { throw }
    throw 'TLS_FILE_ACL_UNSAFE'
  }

  if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256)) {
    if ($ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$') { throw 'TLS_ROOT_CA_PIN_MISSING' }
    $actualSha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
    if ($actualSha256 -cne $ExpectedSha256) { throw 'TLS_ROOT_CA_PIN_MISMATCH' }
  }

  return $fullPath
}

Export-ModuleMember -Function Assert-StagingCaptureFile
