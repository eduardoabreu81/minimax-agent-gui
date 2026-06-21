#requires -Version 5.1
<#
.SYNOPSIS
  Wrapper que carrega o MSVC environment (vcvars64.bat) e roda um comando
  no diretório desktop/ do projeto (Rust/Tauri).

.DESCRIPTION
  Canonical toolchain for this project is MSVC (rustup default
  stable-x86_64-pc-windows-msvc). The Tauri build links against
  link.exe and the Windows SDK, and the Job Object code that owns
  the backend sidecar relies on MSVC headers. To avoid polluting
  the user's PATH, this script:

    1. Loads vcvars64.bat from Build Tools 2022
    2. cd's to desktop/src-tauri (or accepts a custom -CratePath)
    3. Executes the command passed via -Command
       (e.g. "cargo check", "cargo build", "cargo tauri dev")

  GNU fallback is NOT supported by this script — if you are on the
  x86_64-pc-windows-gnu toolchain, run cargo directly and add
  C:\msys64\mingw64\bin to your PATH yourself.

.EXAMPLE
  .\scripts\dev.ps1 -Command "cargo check"
  .\scripts\dev.ps1 -Command "cargo build --release"
  .\scripts\dev.ps1 -Command "cargo tauri dev" -NoExit
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Command,

    [string]$CratePath = "",

    [switch]$NoExit
)

$ErrorActionPreference = "Stop"

# Resolve diretório do script (robusto a -File invocation)
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if ([string]::IsNullOrEmpty($CratePath)) {
    $CratePath = Join-Path $ScriptDir "..\src-tauri"
}

# Resolve MSVC vcvars64 (Build Tools 2022 default path)
$vcvarsCandidates = @(
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
    "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
)

$vcvars = $null
foreach ($p in $vcvarsCandidates) {
    if (Test-Path $p) { $vcvars = $p; break }
}
if (-not $vcvars) {
    throw "vcvars64.bat nao encontrado. Instale Visual Studio Build Tools 2022 com workload VCTools."
}

# Resolve cargo path (assumindo rustup default)
$cargoRoot = "$env:USERPROFILE\.cargo\bin"
if (Test-Path $cargoRoot) {
    $env:Path = "$cargoRoot;$env:Path"
}

# Resolve CratePath para absoluto
$CratePath = (Resolve-Path $CratePath -ErrorAction Stop).Path

Write-Host "[dev] vcvars: $vcvars" -ForegroundColor DarkGray
Write-Host "[dev] crate : $CratePath" -ForegroundColor DarkGray
Write-Host "[dev] cmd   : $Command"   -ForegroundColor DarkGray
Write-Host ""

# Monta o comando final passado ao cmd.exe
# /c "..."  -> executar e fechar
# /k "..."  -> executar e ficar no prompt
$switch = if ($NoExit) { "/k" } else { "/c" }
$cmdLine = "call `"$vcvars`" >nul && cd /d `"$CratePath`" && $Command"

if ($NoExit) {
    cmd.exe /k $cmdLine
} else {
    cmd.exe /c $cmdLine
    exit $LASTEXITCODE
}
