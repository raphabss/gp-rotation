<#
  install-task.ps1  -  Instalador do kiosk (GP Rotation / Spin Gaming)
  --------------------------------------------------------------------
  Executar UMA VEZ, como ADMINISTRADOR, no ThinClient da TV.

  O que faz:
   1. Copia o watchdog para C:\GpRotationKiosk
   2. Cria uma tarefa no Agendador que inicia o watchdog no logon do usuario
   3. Configura o login automatico do Windows (autologon)
   4. Ajusta energia: nunca desligar tela/disco, nunca suspender
   5. Adia reinicio do Windows Update para a madrugada

  Depois de rodar, REINICIE a maquina: ela deve logar sozinha e abrir a TV.
#>

# -----------------------------------------------------------------------------
#  CONFIGURACAO  (conta de DOMINIO)
# -----------------------------------------------------------------------------
$Domain        = "SPINGAMING"        # NetBIOS do dominio (NAO o FQDN). Ex.: SPINGAMING
$KioskUser     = "telao"             # conta que ficara logada na TV (so o nome, sem dominio)
$KioskPassword = ""          # senha da conta do quiosque (preenchida; deixe "" para perguntar)
$InstallDir    = "C:\GpRotationKiosk"
$TaskName      = "GpRotationKiosk"

# Usuario completo no formato DOMINIO\usuario (usado na tarefa e no autologon)
$FullUser      = "$Domain\$KioskUser"

# IMPORTANTE: a conta do quiosque e uma conta de DOMINIO COMUM (NAO precisa ser admin).
# Quem RODA este instalador precisa ser admin local da maquina (pode ser outra conta de TI).

# -----------------------------------------------------------------------------
#  Verificacao de privilegio
# -----------------------------------------------------------------------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "ERRO: rode este script como Administrador (botao direito > Executar como administrador)." -ForegroundColor Red
  exit 1
}

Write-Host "== Instalador do Kiosk GP Rotation ==" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
#  1) Copia o watchdog para o destino
# -----------------------------------------------------------------------------
if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
$srcWatchdog = Join-Path $PSScriptRoot "kiosk-watchdog.ps1"
if (-not (Test-Path $srcWatchdog)) {
  Write-Host "ERRO: kiosk-watchdog.ps1 nao encontrado na mesma pasta deste instalador." -ForegroundColor Red
  exit 1
}
Copy-Item $srcWatchdog (Join-Path $InstallDir "kiosk-watchdog.ps1") -Force
Write-Host "[1/5] Watchdog copiado para $InstallDir" -ForegroundColor Green

# -----------------------------------------------------------------------------
#  2) Tarefa no Agendador: inicia o watchdog no logon
# -----------------------------------------------------------------------------
$watchdogPath = Join-Path $InstallDir "kiosk-watchdog.ps1"
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$watchdogPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $FullUser
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
# RunLevel Limited = a conta do quiosque roda SEM elevacao (nao precisa ser admin)
$principalTask = New-ScheduledTaskPrincipal -UserId $FullUser -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principalTask | Out-Null
Write-Host "[2/5] Tarefa '$TaskName' criada (inicia no logon de $FullUser)" -ForegroundColor Green

# -----------------------------------------------------------------------------
#  3) Login automatico do Windows (autologon via registro)
# -----------------------------------------------------------------------------
if ([string]::IsNullOrEmpty($KioskPassword)) {
  $sec = Read-Host "Digite a senha da conta de dominio '$FullUser' (para o autologon)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  $KioskPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
}
$winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
Set-ItemProperty $winlogon -Name "AutoAdminLogon"   -Value "1"          -Type String
Set-ItemProperty $winlogon -Name "DefaultUserName"  -Value $KioskUser   -Type String
Set-ItemProperty $winlogon -Name "DefaultPassword"  -Value $KioskPassword -Type String
Set-ItemProperty $winlogon -Name "DefaultDomainName" -Value $Domain      -Type String   # NetBIOS do dominio
# evita que o autologon pare apos um logoff manual
Set-ItemProperty $winlogon -Name "ForceAutoLogon"   -Value "1"          -Type String -ErrorAction SilentlyContinue
Write-Host "[3/5] Login automatico configurado para $FullUser" -ForegroundColor Green

# -----------------------------------------------------------------------------
#  4) Energia: nunca desligar tela/disco, nunca suspender (AC e DC)
# -----------------------------------------------------------------------------
powercfg /change monitor-timeout-ac 0   | Out-Null
powercfg /change monitor-timeout-dc 0   | Out-Null
powercfg /change disk-timeout-ac 0      | Out-Null
powercfg /change disk-timeout-dc 0      | Out-Null
powercfg /change standby-timeout-ac 0   | Out-Null
powercfg /change standby-timeout-dc 0   | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-dc 0 | Out-Null
# desliga protetor de tela do usuario
Set-ItemProperty "HKCU:\Control Panel\Desktop" -Name "ScreenSaveActive" -Value "0" -ErrorAction SilentlyContinue
Write-Host "[4/5] Energia ajustada (sem suspensao / sem desligar tela)" -ForegroundColor Green

# -----------------------------------------------------------------------------
#  5) Windows Update: horas ativas para nao reiniciar durante operacao
# -----------------------------------------------------------------------------
# Concede "Log on as a batch job" a conta do quiosque (necessario p/ a tarefa rodar no logon)
try {
  $tmp = "$env:TEMP\secpol.inf"; $db = "$env:TEMP\secpol.sdb"
  secedit /export /cfg $tmp /areas USER_RIGHTS | Out-Null
  $sid = (New-Object Security.Principal.NTAccount($FullUser)).Translate([Security.Principal.SecurityIdentifier]).Value
  $content = Get-Content $tmp
  $line = $content | Where-Object { $_ -match "^SeBatchLogonRight" }
  if ($line) {
    if ($line -notmatch [regex]::Escape($sid)) {
      $content = $content -replace "^SeBatchLogonRight.*", "$line,*$sid"
    }
  } else {
    $content += "SeBatchLogonRight = *$sid"
  }
  $content | Set-Content $tmp
  secedit /configure /db $db /cfg $tmp /areas USER_RIGHTS | Out-Null
  Remove-Item $tmp,$db -ErrorAction SilentlyContinue
  Write-Host "      Direito 'Logon as a batch job' garantido para $FullUser" -ForegroundColor DarkGray
} catch {
  Write-Host "      AVISO: nao consegui ajustar 'Logon as a batch job' automaticamente." -ForegroundColor Yellow
  Write-Host "      Se a tarefa nao iniciar no logon, conceda esse direito via GPO/secpol." -ForegroundColor Yellow
}

$au = "HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings"
if (-not (Test-Path $au)) { New-Item -Path $au -Force | Out-Null }
# horas ativas 06h-23h (reinicio de update so pode ocorrer fora disso)
Set-ItemProperty $au -Name "ActiveHoursStart" -Value 6  -Type DWord -ErrorAction SilentlyContinue
Set-ItemProperty $au -Name "ActiveHoursEnd"   -Value 23 -Type DWord -ErrorAction SilentlyContinue
Write-Host "[5/5] Horas ativas do Windows Update: 06h-23h" -ForegroundColor Green

Write-Host ""
Write-Host "Concluido! Reinicie a maquina:" -ForegroundColor Cyan
Write-Host "   - O Windows deve logar sozinho como $FullUser"
Write-Host "   - O watchdog abre o Chrome em tela cheia na TV"
Write-Host "   - Se fechar/travar, reabre em ate $([int]10) segundos"
Write-Host ""
Write-Host "Para iniciar agora sem reiniciar, rode:" -ForegroundColor Yellow
Write-Host "   Start-ScheduledTask -TaskName $TaskName"
