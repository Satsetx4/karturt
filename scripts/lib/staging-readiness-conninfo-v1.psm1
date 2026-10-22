Set-StrictMode -Version Latest

function ConvertFrom-Psql18ConninfoV1([string]$Text) {
  if ([string]::IsNullOrWhiteSpace($Text) -or $Text.Length -gt 8192) {
    throw 'CONNECTION_INFO_INVALID'
  }

  # PostgreSQL 18 emits \conninfo as unaligned label|value rows. Pin labels
  # and order to REL_18_STABLE, while accepting its optional Host Address row.
  $allowedLabels = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($label in @(
      'Database', 'Client User', 'Host', 'Host Address', 'Server Port',
      'Options', 'Protocol Version', 'Password Used', 'GSSAPI Authenticated', 'Backend PID',
      'SSL Connection', 'SSL Library', 'SSL Protocol', 'SSL Key Bits', 'SSL Cipher',
      'SSL Compression', 'ALPN', 'Superuser', 'Hot Standby'
    )) {
    [void]$allowedLabels.Add($label)
  }

  $values = [Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
  $lines = [regex]::Split($Text, '\r?\n')
  if ($lines.Count -gt 24) { throw 'CONNECTION_INFO_INVALID' }
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    if ($line.Length -gt 2048 -or $line -match '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') {
      throw 'CONNECTION_INFO_INVALID'
    }

    $separatorIndex = $line.IndexOf('|')
    if ($separatorIndex -le 0) {
      throw 'CONNECTION_INFO_INVALID'
    }

    $label = $line.Substring(0, $separatorIndex).Trim()
    $value = $line.Substring($separatorIndex + 1).Trim()
    if ($value.Contains('|') -or -not $allowedLabels.Contains($label) -or $values.ContainsKey($label)) {
      throw 'CONNECTION_INFO_INVALID'
    }
    $values.Add($label, $value)
  }

  $expectedLabels = [Collections.Generic.List[string]]::new()
  foreach ($label in @('Database', 'Client User', 'Host')) { $expectedLabels.Add($label) }
  if ($values.ContainsKey('Host Address')) { $expectedLabels.Add('Host Address') }
  foreach ($label in @(
      'Server Port', 'Options', 'Protocol Version', 'Password Used', 'GSSAPI Authenticated',
      'Backend PID', 'SSL Connection', 'SSL Library', 'SSL Protocol', 'SSL Key Bits',
      'SSL Cipher', 'SSL Compression', 'ALPN', 'Superuser', 'Hot Standby'
    )) {
    $expectedLabels.Add($label)
  }
  $actualLabels = [Collections.Generic.List[string]]::new()
  foreach ($line in $lines) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $actualLabels.Add($line.Substring(0, $line.IndexOf('|')).Trim())
  }
  if ($actualLabels.Count -ne $expectedLabels.Count) { throw 'CONNECTION_INFO_INVALID' }
  for ($index = 0; $index -lt $expectedLabels.Count; $index++) {
    if ($actualLabels[$index] -cne $expectedLabels[$index]) { throw 'CONNECTION_INFO_INVALID' }
  }

  foreach ($label in @('Database', 'Client User', 'Host', 'Server Port')) {
    if (-not $values.ContainsKey($label) -or [string]::IsNullOrWhiteSpace($values[$label])) {
      throw 'CONNECTION_IDENTITY_UNVERIFIED'
    }
  }

  if ($values['Server Port'] -notmatch '^(?<port>[0-9]{1,5})$') {
    throw 'CONNECTION_IDENTITY_UNVERIFIED'
  }
  $port = [int]$Matches['port']
  if ($port -lt 1 -or $port -gt 65535) { throw 'CONNECTION_IDENTITY_UNVERIFIED' }

  if ($values.ContainsKey('Host Address')) {
    $parsedAddress = $null
    if (-not [Net.IPAddress]::TryParse($values['Host Address'], [ref]$parsedAddress)) {
      throw 'CONNECTION_INFO_INVALID'
    }
  }

  foreach ($label in @('Password Used', 'GSSAPI Authenticated', 'SSL Connection', 'SSL Compression', 'Superuser', 'Hot Standby')) {
    if ($values[$label] -cnotin @('true', 'false')) { throw 'CONNECTION_INFO_INVALID' }
  }
  if ($values['Protocol Version'] -notmatch '^[0-9]{1,3}\.[0-9]{1,3}$' -or
      $values['Backend PID'] -notmatch '^[1-9][0-9]{0,9}$' -or
      [string]::IsNullOrWhiteSpace($values['SSL Library']) -or
      $values['SSL Key Bits'] -notmatch '^[1-9][0-9]{0,4}$' -or
      [string]::IsNullOrWhiteSpace($values['ALPN'])) {
    throw 'CONNECTION_INFO_INVALID'
  }

  if (-not $values.ContainsKey('SSL Connection') -or
      $values['SSL Connection'] -cne 'true' -or
      $values['SSL Compression'] -cne 'false' -or
      -not $values.ContainsKey('SSL Protocol') -or
      $values['SSL Protocol'] -notmatch '^TLSv1\.(?:2|3)$' -or
      -not $values.ContainsKey('SSL Cipher') -or
      $values['SSL Cipher'] -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$' -or
      $values['SSL Cipher'] -cin @('unknown', 'none')) {
    throw 'LIBPQ_TLS_PROOF_MISSING'
  }

  return [pscustomobject]@{
    Database = $values['Database']
    Role = $values['Client User']
    Host = $values['Host']
    Port = [string]$port
    Protocol = $values['SSL Protocol']
    Cipher = $values['SSL Cipher']
  }
}

Export-ModuleMember -Function ConvertFrom-Psql18ConninfoV1
