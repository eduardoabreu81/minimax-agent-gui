#requires -Version 5.1
$ErrorActionPreference = "Continue"

$vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
$CratePath = "C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui\desktop\src-tauri"
$LogPath   = "C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui\desktop\.runtime\tauri-dev.log"
$TauriBin  = "C:\Users\Eduardo\OneDrive\Documentos\GitHub\minimax-agent-gui\desktop\node_modules\.bin\tauri.cmd"

# Header so we know when it actually started
"=== tauri dev start $(Get-Date -Format o) ===" | Out-File -FilePath $LogPath -Encoding utf8

# Launch via cmd so vcvars64.bat (a .bat) is honored, then cd + run tauri
$cmdLine = "call `"$vcvars`" >nul && cd /d `"$CratePath`" && `"$TauriBin`" dev 2>&1"

$proc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", $cmdLine `
    -RedirectStandardOutput $LogPath `
    -RedirectStandardError  $LogPath `
    -WorkingDirectory $CratePath `
    -PassThru `
    -WindowStyle Normal

"started pid=$($proc.Id)" | Out-File -FilePath $LogPath -Append -Encoding utf8
$proc.Id
