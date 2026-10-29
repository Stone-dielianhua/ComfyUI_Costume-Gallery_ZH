param(
    [Parameter(Mandatory = $true)]
    [string]$ComfyUIPath
)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$comfyRoot = (Resolve-Path -LiteralPath $ComfyUIPath).Path
if (-not (Test-Path -LiteralPath (Join-Path $comfyRoot 'main.py') -PathType Leaf)) {
    throw 'ComfyUIPath must point to the ComfyUI folder containing main.py.'
}
$customNodes = Join-Path $comfyRoot 'custom_nodes'
if (-not (Test-Path -LiteralPath $customNodes -PathType Container)) {
    throw 'The ComfyUI custom_nodes folder is missing.'
}
$destination = Join-Path $customNodes 'ComfyUI_Costume-Gallery_ZH'
if (Test-Path -LiteralPath $destination) {
    $existing = Get-Item -LiteralPath $destination -Force
    if ($existing.LinkType -eq 'Junction' -and @($existing.Target)[0].TrimEnd('\') -eq $projectRoot.TrimEnd('\')) {
        Write-Output "Already installed: $destination"
        exit 0
    }
    throw "The destination already exists; no files were changed: $destination"
}
New-Item -ItemType Junction -Path $destination -Target $projectRoot | Out-Null
Write-Output "Installed: $destination -> $projectRoot"
Write-Output 'Restart ComfyUI and refresh its browser page to load the costume gallery.'
