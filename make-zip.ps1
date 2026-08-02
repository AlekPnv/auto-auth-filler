<#
  Build a store ZIP whose entry names use forward slashes.

  Compress-Archive on Windows PowerShell 5.1 writes nested paths with a
  backslash, so icons/icon128.png is stored as "icons\icon128.png". The ZIP
  specification requires forward slashes, and addons.mozilla.org rejects such an
  archive with "Invalid file name in archive". Building the entries by hand is
  the only way to control the separator on this PowerShell version.

  Usage: powershell -File make-zip.ps1 -Source dist -Destination out.zip
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Destination
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = (Resolve-Path -LiteralPath $Source).Path.TrimEnd('\')

if ([System.IO.Path]::IsPathRooted($Destination)) {
  $out = $Destination
} else {
  $out = Join-Path (Get-Location).Path $Destination
}
if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }

$count = 0
$zip = [System.IO.Compression.ZipFile]::Open($out, 'Create')
try {
  # Sorted so two builds of the same folder produce the same archive.
  Get-ChildItem -LiteralPath $root -Recurse -File | Sort-Object FullName | ForEach-Object {
    $name = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $_.FullName, $name, [System.IO.Compression.CompressionLevel]::Optimal)
    $count++
  }
} finally {
  $zip.Dispose()
}

# Never hand back an archive carrying the defect this script exists to prevent.
$reader = [System.IO.Compression.ZipFile]::OpenRead($out)
try {
  $bad = @($reader.Entries | Where-Object { $_.FullName -like '*\*' })
} finally {
  $reader.Dispose()
}
if ($bad.Count -gt 0) {
  Remove-Item -LiteralPath $out -Force
  throw "Backslash entries in the archive: $(($bad | ForEach-Object { $_.FullName }) -join ', ')"
}

Write-Host ("  Created {0}, {1} entries, all forward slashes" -f (Split-Path $out -Leaf), $count)
