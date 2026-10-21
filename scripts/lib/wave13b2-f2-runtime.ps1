function Get-Wave13B2F2RuntimeGateResult {
  $supportsPowerShell7 = $PSVersionTable.PSVersion.Major -ge 7
  $supportsArgumentList = $false

  if ($supportsPowerShell7) {
    try {
      $bindingFlags = [Reflection.BindingFlags]::Instance -bor [Reflection.BindingFlags]::Public
      $argumentListProperty = [Diagnostics.ProcessStartInfo].GetProperty('ArgumentList', $bindingFlags)
      if ($null -ne $argumentListProperty -and $argumentListProperty.CanRead) {
        $startInfo = [Diagnostics.ProcessStartInfo]::new()
        $argumentList = $argumentListProperty.GetValue($startInfo, $null)
        if ($null -ne $argumentList) {
          $addMethod = $argumentList.GetType().GetMethod('Add', [type[]]@([string]))
          $supportsArgumentList = $null -ne $addMethod
        }
      }
    } catch {
      $supportsArgumentList = $false
    }
  }

  $supported = $supportsPowerShell7 -and $supportsArgumentList
  return [pscustomobject]@{
    Supported = $supported
    FailureCode = if ($supported) { $null } else { 'F2_POWERSHELL_RUNTIME_UNSUPPORTED' }
    RequiredRuntime = 'PowerShell 7.0 or newer with System.Diagnostics.ProcessStartInfo.ArgumentList.Add(string) support.'
  }
}
