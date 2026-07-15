# Kiosk da TV — GP Rotation (Spin Gaming)

Procedimento para transformar um ThinClient/Mini-PC Windows num player dedicado
da TV de rotação: liga, loga sozinho e abre a rotação em tela cheia, com watchdog
que reabre o navegador se ele fechar, travar ou cair energia.

## Pré-requisitos
- Windows 10/11 no ThinClient ligado na TV, ingressado no domínio.
- Google Chrome instalado (ou Edge — ver observação no fim).
- Acesso de rede ao servidor da TV: `http://172.16.20.10/tv/` deve abrir no navegador.
- Uma **conta de domínio dedicada** ao quiosque (ex.: `SPINGAMING\tv.estudio`).
  - **NÃO precisa ser administrador** — conta de domínio comum basta.
  - Quem **roda o instalador** precisa ser **admin local** da máquina (pode ser
    outra conta de TI; o instalador mexe em HKLM, energia e Windows Update).

## Conta: instalação x execução (importante)
- **Instalar** (`install-task.ps1`): exige admin local. Roda uma vez.
- **Executar** (a conta que fica logada 24/7 rodando o watchdog + Chrome):
  conta de domínio **comum, sem admin**. A tarefa roda com `RunLevel Limited`
  (sem elevação), pelo princípio do menor privilégio.

## Arquivos
- `kiosk-watchdog.ps1` — o vigia: mantém o navegador em tela cheia na URL da TV.
- `install-task.ps1` — instalador (roda uma vez como administrador).

## Passo a passo

1. Copie a pasta `kiosk` para o ThinClient (ex.: `C:\temp\kiosk`).

2. Abra o **PowerShell como Administrador**:
   - Menu Iniciar → digite "PowerShell" → botão direito → *Executar como administrador*.

3. Permita a execução dos scripts nesta sessão:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
   ```

4. **Antes de rodar**, abra `install-task.ps1` e ajuste o topo para a sua conta de domínio:
   ```powershell
   $Domain    = "SPINGAMING"     # NetBIOS do domínio (NÃO o FQDN spingaming.local)
   $KioskUser = "tv.estudio"     # conta de domínio do quiosque (só o nome, sem domínio)
   ```

5. Rode o instalador:
   ```powershell
   cd C:\temp\kiosk
   .\install-task.ps1
   ```
   - Ele vai pedir a **senha da conta de domínio** (para o login automático).
   - Ele tenta conceder automaticamente o direito **"Logon as a batch job"** à conta;
     se falhar (GPO bloqueando), conceda esse direito à conta via GPO/secpol.

5. **Reinicie** o ThinClient. Ao ligar, ele deve:
   - logar sozinho no Windows;
   - abrir o Chrome em tela cheia mostrando a rotação;
   - se o navegador fechar/travar, reabrir em até ~10 segundos.

   Para testar sem reiniciar:
   ```powershell
   Start-ScheduledTask -TaskName GpRotationKiosk
   ```

## O que o instalador configura
- **Login automático** do Windows (autologon) para a conta escolhida.
- **Tarefa no Agendador** que inicia o watchdog no logon (com reinício automático
  se o watchdog parar).
- **Energia**: nunca suspender, nunca desligar tela/disco, sem protetor de tela.
- **Windows Update**: horas ativas 06h–23h (evita reinício durante operação).
- O watchdog faz um **reinício diário do navegador às 05h** (memória limpa).

## Como sair do kiosk (manutenção)
- Pressione **Alt+F4** para fechar o Chrome (o watchdog reabre em ~5s).
- Para parar o kiosk de vez nesta sessão:
  ```powershell
  Stop-ScheduledTask -TaskName GpRotationKiosk
  Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force
  ```
- Para reativar: `Start-ScheduledTask -TaskName GpRotationKiosk`

## Desinstalar
```powershell
Unregister-ScheduledTask -TaskName GpRotationKiosk -Confirm:$false
# desligar autologon:
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name AutoAdminLogon -Value "0"
```

## Ajustes comuns (editar o topo de kiosk-watchdog.ps1)
- **URL da TV**: variável `$TvUrl`. Para rolagem automática: `http://172.16.20.10/tv/?autoscroll=1`
  (com a autoescala atual, normalmente não é necessário).
- **Caminho do navegador**: `$ChromePath`. O script já tenta Program Files e Program Files (x86).
- **Microsoft Edge** em vez de Chrome: aponte `$ChromePath` para
  `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
  (as flags `--kiosk` são compatíveis, pois o Edge também é Chromium).
- **Intervalo de verificação**: `$CheckEverySeconds` (padrão 5s).
- **Reinício diário**: `$DailyRestartHour` (padrão 5 = 05h; use -1 para desligar).

## Diagnóstico
- Log do watchdog: `%LOCALAPPDATA%\GpRotationKiosk\watchdog.log`
- Ver a tarefa: `Get-ScheduledTask -TaskName GpRotationKiosk`
- Estado da tarefa: `Get-ScheduledTaskInfo -TaskName GpRotationKiosk`

## Notas de segurança (conta de domínio)
- O autologon guarda a senha em texto no registro (`HKLM\...\Winlogon\DefaultPassword`).
  É assim que o autologon do Windows funciona. Por isso:
  - Use uma **conta de domínio dedicada e sem privilégios** (não admin, não conta pessoal).
  - Dê a ela acesso só ao necessário (logon local na máquina da TV).
  - Considere restringir o logon dessa conta a esta estação via GPO ("Log On To").
  - Mantenha o ThinClient em local físico controlado (estúdio).
- Alternativa mais segura ao autologon com senha no registro: **Autologon da Sysinternals**,
  que criptografa a senha com LSA em vez de texto puro. Se a política da empresa exigir,
  dá para usar essa ferramenta no lugar do passo de autologon — me avise que ajusto.
- A conta **não precisa ser admin** para rodar o quiosque (a tarefa usa `RunLevel Limited`).
