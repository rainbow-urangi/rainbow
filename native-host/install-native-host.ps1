#Requires -Version 5.1
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,

  [ValidateSet('Chrome', 'Edge', 'Both')]
  [string]$Browser = 'Both'
)

$ErrorActionPreference = 'Stop'
$hostName = 'kr.co.rainbowlab.network_context'
$installRoot = Join-Path $env:LOCALAPPDATA 'RainbowCollector\NativeHost'
$sourcePath = Join-Path $PSScriptRoot 'RainbowNetworkHost.cs'
$installedSourcePath = Join-Path $installRoot 'RainbowNetworkHost.cs'
$exePath = Join-Path $installRoot 'rainbow-network-host.exe'
$manifestPath = Join-Path $installRoot "$hostName.json"

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
Copy-Item -LiteralPath $sourcePath -Destination $installedSourcePath -Force
Remove-Item -LiteralPath $exePath -Force -ErrorAction SilentlyContinue
Add-Type -Path $installedSourcePath -OutputAssembly $exePath -OutputType ConsoleApplication `
  -ReferencedAssemblies @('System.dll', 'System.Core.dll', 'System.Web.Extensions.dll')

$manifest = [ordered]@{
  name = $hostName
  description = 'Rainbow Collector network context host'
  path = $exePath
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$json = $manifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText($manifestPath, $json, [Text.UTF8Encoding]::new($false))

$registryPaths = @()
if ($Browser -in @('Chrome', 'Both')) {
  $registryPaths += "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName"
}
if ($Browser -in @('Edge', 'Both')) {
  $registryPaths += "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
}
foreach ($registryPath in $registryPaths) {
  New-Item -Path $registryPath -Force | Out-Null
  Set-Item -Path $registryPath -Value $manifestPath
}

[ordered]@{
  ok = $true
  extension_id = $ExtensionId
  browser = $Browser
  host_manifest = $manifestPath
  executable = $exePath
} | ConvertTo-Json
