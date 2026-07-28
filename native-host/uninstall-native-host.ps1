#Requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Chrome', 'Edge', 'Both')]
  [string]$Browser = 'Both',
  [switch]$RemoveFiles
)

$ErrorActionPreference = 'Stop'
$hostName = 'kr.co.rainbowlab.network_context'
$installRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'RainbowCollector\NativeHost'))

if ($Browser -in @('Chrome', 'Both')) {
  Remove-Item -LiteralPath "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName" -Recurse -Force -ErrorAction SilentlyContinue
}
if ($Browser -in @('Edge', 'Both')) {
  Remove-Item -LiteralPath "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName" -Recurse -Force -ErrorAction SilentlyContinue
}
if ($RemoveFiles) {
  $expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'RainbowCollector'))
  if (!$installRoot.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe native host path: $installRoot"
  }
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
}

[ordered]@{ ok = $true; browser = $Browser; files_removed = [bool]$RemoveFiles } | ConvertTo-Json
