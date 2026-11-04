# Builds site/downloads/ajay-autoflow.zip from the extension files (run after changing the extension).
# Usage:  powershell -ExecutionPolicy Bypass -File build-zip.ps1
# Entries use "/" so the ZIP unpacks correctly on Windows, macOS and Linux.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$outDir = Join-Path $root 'site\downloads'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipPath = Join-Path $outDir 'ajay-autoflow.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$include = @('manifest.json', 'background.js', 'README.md', 'assets', 'content', 'icons', 'sidepanel')
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($item in $include) {
    $path = Join-Path $root $item
    $files = if (Test-Path $path -PathType Container) { Get-ChildItem $path -Recurse -File } else { Get-Item $path }
    foreach ($f in $files) {
      $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/') -replace '\\', '/'
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, "Ajay AutoFlow/$rel", 'Optimal') | Out-Null
    }
  }
} finally { $zip.Dispose() }

$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
Write-Output "Built $zipPath (version $version, $([math]::Round((Get-Item $zipPath).Length / 1KB)) KB)"
