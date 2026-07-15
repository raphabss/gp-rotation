# ============================================================
#  Instala o Kiosk Watchdog como Scheduled Task no Windows
#  Execute como Administrador uma única vez
#
#  Uso: .\install-task.ps1 -ServerIP "192.168.1.100"
# ============================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$ServerIP,                        # IP do LXC no Proxmox
    [int]$Port = 80,
    [string]$KioskUser = $env:USERNAME,       # usuário que faz o login na TV
    [string]$InstallDir = "C:\SpinGaming"
)

$ErrorActionPreference = "Stop"

# Require admin
if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]"Administrator")) {
    Write-Error "Execute este script como Administrador!"
    exit 1
}

Write-Host "=== GP Rotation Kiosk Installer ===" -ForegroundColor Cyan
Write-Host "Servidor: http://${ServerIP}:${Port}/tv"
Write-Host "Usuário kiosk: $KioskUser"
Write-Host "Diretório: $InstallDir"
Write-Host ""

# Create install dir
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Host "[OK] Diretório criado: $InstallDir"
}

# Copy watchdog script
$watchdogSrc = Join-Path $PSScriptRoot "kiosk-watchdog.ps1"
$watchdogDst = Join-Path $InstallDir "kiosk-watchdog.ps1"

# Update the URL in the watchdog script
$content = Get-Content $watchdogSrc -Raw
$content = $content -replace 'http://192\.168\.1\.100/tv', "http://${ServerIP}:${Port}/tv"
Set-Content -Path $watchdogDst -Value $content -Encoding UTF8
Write-Host "[OK] Script instalado em: $watchdogDst"

# Create the Scheduled Task
$taskName    = "SpinGaming-GPRotation-Kiosk"
$taskDesc    = "Spin Gaming Brasil — GP Rotation Kiosk Display Watchdog"
$psExe       = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
$taskArgs    = "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdogDst`""

# Remove existing task if present
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$action  = New-ScheduledTaskAction -Execute $psExe -Argument $taskArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $KioskUser
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $KioskUser -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
    -TaskName $taskName `
    -Description $taskDesc `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force | Out-Null

Write-Host "[OK] Scheduled Task criada: $taskName" -ForegroundColor Green

# Allow PowerShell scripts execution for this user
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine -Force
Write-Host "[OK] ExecutionPolicy configurada"

# Disable Windows Update auto-restart (kiosk machines)
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 1 /f 2>$null
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v AUOptions /t REG_DWORD /d 3 /f 2>$null
Write-Host "[OK] Auto-reboot do Windows Update desabilitado"

# Disable lock screen
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization" /v NoLockScreen /t REG_DWORD /d 1 /f 2>$null
Write-Host "[OK] Lock screen desabilitado"

# Set power plan to High Performance
powercfg -setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null
Write-Host "[OK] Power plan: High Performance"

# Disable screensaver via registry
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d "0" /f 2>$null
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveTimeOut /t REG_SZ /d "0" /f 2>$null

Write-Host ""
Write-Host "=== Instalação Concluída! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Próximos passos:" -ForegroundColor Yellow
Write-Host "  1. Reinicie o ThinClient para aplicar todas as configurações"
Write-Host "  2. Faça login com o usuário '$KioskUser'"
Write-Host "  3. O kiosk inicia automaticamente e monitora o processo"
Write-Host ""
Write-Host "Para testar manualmente agora:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$watchdogDst`""
