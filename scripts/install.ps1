# Installs emRequest into every supported editor found on this Windows machine.
# Usage:  powershell -ExecutionPolicy Bypass -File install.ps1 C:\path\emrequest-x.y.z.vsix
param([string]$Vsix)
if (-not $Vsix) { $Vsix = Get-ChildItem "$PSScriptRoot\..\*.vsix" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName }
if (-not $Vsix -or -not (Test-Path $Vsix)) { Write-Host "Give the path to the .vsix file: install.ps1 emrequest.vsix"; exit 1 }

$editors = @(
  @{ Name = "VS Code";     Cli = "code";        Path = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd" },
  @{ Name = "Cursor";      Cli = "cursor";      Path = "$env:LOCALAPPDATA\Programs\cursor\resources\app\bin\cursor.cmd" },
  @{ Name = "Antigravity"; Cli = "antigravity"; Path = "$env:LOCALAPPDATA\Programs\Antigravity\bin\antigravity.cmd" },
  @{ Name = "Windsurf";    Cli = "windsurf";    Path = "$env:LOCALAPPDATA\Programs\Windsurf\bin\windsurf.cmd" }
)
$found = $false
foreach ($e in $editors) {
  $bin = (Get-Command $e.Cli -ErrorAction SilentlyContinue).Source
  if (-not $bin -and (Test-Path $e.Path)) { $bin = $e.Path }
  if ($bin) {
    $found = $true
    Write-Host "-> Installing into $($e.Name)..."
    & $bin --install-extension $Vsix --force *> $null
    if ($LASTEXITCODE -eq 0) { Write-Host "   done" } else { Write-Host "   failed - open $($e.Name) > Extensions > ... > Install from VSIX" }
  }
}
if (-not $found) { Write-Host "No supported editor found. Install manually: Extensions > ... > Install from VSIX." }
Write-Host "Restart the editor(s) to see emRequest in the sidebar."
