# GP Rotation Display System
## Runbook de Implantação — Spin Gaming Brasil

---

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│  SharePoint/Excel  (Shift Leader edita normalmente)             │
│         │                                                       │
│         ▼ Power Automate (webhook on change)                    │
├─────────────────────────────────────────────────────────────────┤
│  LXC no Proxmox — sg-docker (ou CT existente)                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Docker Compose                                           │  │
│  │  ┌─────────────────────┐  ┌──────────────────────────┐   │  │
│  │  │  nginx :80          │  │  node app :3000          │   │  │
│  │  │  reverse proxy      │  │  - REST API              │   │  │
│  │  │  WebSocket upgrade  │  │  - WebSocket server      │   │  │
│  │  └──────────┬──────────┘  │  - state.json persist.   │   │  │
│  │             └─────────────│  - Graph API polling      │   │  │
│  │                           └──────────────────────────┘   │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  Xibo CMS :8080  (digital signage manager)          │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│         │                                                       │
│         │  HTTP + WebSocket (LAN interna)                      │
├─────────────────────────────────────────────────────────────────┤
│  ThinClient Windows (TV 50")                                    │
│  Chrome Kiosk → http://IP-LXC/tv                               │
│  Watchdog PowerShell → Task Scheduler                           │
│  Xibo Player Windows → managed by Xibo CMS                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sprint 1 — Deploy Imediato

### 1.1 Criar LXC no Proxmox (se não existir)

```bash
# No Proxmox Shell
pct create 120 local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname sg-gp-rotation \
  --memory 1024 \
  --cores 2 \
  --net0 name=eth0,bridge=vmbr0,ip=192.168.1.100/24,gw=192.168.1.1 \
  --rootfs local-lvm:8 \
  --unprivileged 1 \
  --features nesting=1   # necessário para Docker dentro de LXC

pct start 120
```

> **Se for usar um CT existente**, apenas certifique que tem `nesting=1` nas features.

### 1.2 Instalar Docker no LXC

```bash
# Dentro do LXC (pct enter 120)
apt update && apt install -y curl git

curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# Testar
docker run --rm hello-world
```

### 1.3 Deploy da Aplicação

```bash
# Copie o diretório gp-rotation para o LXC
# Opção A: via SCP do seu workstation
scp -r ./gp-rotation root@192.168.1.100:/opt/

# Opção B: git clone se subir no GitLab/Gitea interno
# git clone http://seu-gitea/spin/gp-rotation.git /opt/gp-rotation

cd /opt/gp-rotation

# Edite o .env
nano .env
# Troque WEBHOOK_SECRET por algo forte, ex:
# WEBHOOK_SECRET=sg2024$(openssl rand -hex 16)

# Build e start
docker compose up -d --build

# Verificar
docker compose ps
docker compose logs -f app
```

### 1.4 Verificar endpoints

```bash
# Health check
curl http://192.168.1.100/health

# TV Display (abrir no browser)
# http://192.168.1.100/tv

# Admin Panel
# http://192.168.1.100/admin
```

### 1.5 Configurar o ThinClient Windows

1. Copie a pasta `scripts-windows/` para `C:\SpinGaming\` no ThinClient
2. Abra PowerShell como Administrador
3. Execute:
```powershell
cd C:\SpinGaming
.\install-task.ps1 -ServerIP "192.168.1.100"
```
4. Reinicie o ThinClient
5. Ao fazer login, o Chrome abre automaticamente em modo kiosk

---

## Sprint 2 — Power Automate (SharePoint → Webhook)

### 2.1 Criar o fluxo no Power Automate

1. Acesse **make.powerautomate.com**
2. Novo fluxo → **Automatizado** → trigger: **"When an item or a file is modified"**
   - Site: seu site SharePoint
   - Biblioteca: onde está a planilha
3. Adicione ação: **HTTP**
   - Método: `POST`
   - URL: `http://IP-DO-LXC/api/webhook/sharepoint`
   - Headers: `Content-Type: application/json`
   - Body (JSON dinâmico):
```json
{
  "secret": "SEU_WEBHOOK_SECRET_AQUI",
  "shift": "@{triggerBody()?['Turno']}",
  "shiftLabel": "@{triggerBody()?['ShiftLabel']}",
  "updatedBy": "@{triggerOutputs()?['headers']?['x-ms-user-principal-name']}",
  "assignments": [
    {
      "tableName": "@{triggerBody()?['Mesa']}",
      "gp": "@{triggerBody()?['GP']}",
      "game": "@{triggerBody()?['Jogo']}"
    }
  ]
}
```

> **Dica:** Se a planilha tem múltiplas linhas, use uma ação **"Apply to each"** sobre os itens da lista e construa o array `assignments` dinamicamente.

### 2.2 Formato esperado da planilha SharePoint

| Mesa   | GP           | Jogo      | Turno | ShiftLabel  |
|--------|--------------|-----------|-------|-------------|
| T01    | Ana Paula    | Baccarat  | A     | Turno A     |
| T02    | Carlos Mendes| Roulette  | A     | Turno A     |
| ...    | ...          | ...       | ...   | ...         |

---

## Sprint 3 — Microsoft Graph API (polling direto)

Isso substitui o webhook do Power Automate por uma integração direta.

### 3.1 Criar App Registration no Entra ID

1. **Entra ID** → App Registrations → New registration
   - Name: `gp-rotation-app`
   - Supported account types: Single tenant
2. Em **API Permissions**, adicione:
   - `Sites.Read.All` (Application)
   - `Files.Read.All` (Application)
3. Grant admin consent
4. Em **Certificates & Secrets**, crie um Client Secret
5. Copie: Tenant ID, Client ID, Client Secret

### 3.2 Obter o Site ID do SharePoint

```bash
# Com um token do Graph Explorer (https://developer.microsoft.com/en-us/graph/graph-explorer)
GET https://graph.microsoft.com/v1.0/sites?search=cassino

# Ou pelo nome do site:
GET https://graph.microsoft.com/v1.0/sites/spingaming.sharepoint.com:/sites/cassino
```

### 3.3 Ativar no .env do LXC

```bash
# Edite /opt/gp-rotation/.env
GRAPH_ENABLED=true
GRAPH_TENANT_ID=xxxx-xxxx-xxxx
GRAPH_CLIENT_ID=xxxx-xxxx-xxxx
GRAPH_CLIENT_SECRET=seu-secret-aqui
GRAPH_SITE_ID=spingaming.sharepoint.com,site-id-aqui
GRAPH_FILE_PATH=/Shared Documents/Rotacao GPs.xlsx
GRAPH_SHEET_NAME=Rotação

# Reiniciar
docker compose restart app
```

O sistema fará polling a cada 60 segundos **E** ainda receberá webhooks do Power Automate como trigger imediato.

---

## Sprint 4 — Xibo Digital Signage

### 4.1 Deploy Xibo

```bash
cd /opt/gp-rotation/xibo

# Edite as senhas no docker-compose.xibo.yml antes de subir
docker compose -f docker-compose.xibo.yml up -d

# Acesse: http://192.168.1.100:8080
# Login inicial: admin / password (troque imediatamente)
```

### 4.2 Configurar o Layout no Xibo

1. **Layouts** → New Layout → Full HD (1920x1080)
2. Adicione widget: **Webpage**
   - URL: `http://192.168.1.100/tv`
   - Transparency: Yes
   - Duration: 0 (permanent)
3. Publique o layout
4. **Displays** → adicione o ThinClient Windows
5. Instale o **Xibo for Windows** no ThinClient:
   - Download: https://xibosignage.com/downloads
   - Configure CMS URL: `http://192.168.1.100:8080`
   - CMS Key: (definido nas configurações do Xibo CMS)
6. Crie um Schedule no Xibo apontando o layout para o display

### 4.3 Vantagens do Xibo vs Chrome puro

- Reinicialização agendada do player (ex: toda madrugada)
- Monitoramento de status do display no CMS
- Fallback para imagem offline se o servidor sumir
- Screenshot remoto da tela atual
- Gestão centralizada se houver mais TVs no futuro

---

## Monitoramento

### Health check via Prometheus (se quiser integrar ao seu stack)

```yaml
# Adicione no seu prometheus.yml
scrape_configs:
  - job_name: 'gp-rotation'
    static_configs:
      - targets: ['192.168.1.100:80']
    metrics_path: '/health'
    scrape_interval: 30s
```

### Alertmanager rule

```yaml
- alert: GPRotationDown
  expr: up{job="gp-rotation"} == 0
  for: 2m
  labels:
    severity: warning
  annotations:
    summary: "GP Rotation server indisponível"
    description: "O display de rotacionamento de GPs está offline há mais de 2 minutos."
```

---

## Manutenção

### Comandos úteis

```bash
# Ver logs em tempo real
docker compose -f /opt/gp-rotation/docker-compose.yml logs -f app

# Reiniciar apenas o app (sem downtime do nginx)
docker compose restart app

# Backup do state.json
cp /opt/gp-rotation/data/state.json /opt/backups/gp-rotation-$(date +%Y%m%d).json

# Ver histórico de mudanças
curl http://192.168.1.100/api/schedule/history | jq .

# Forçar sync Graph API
curl -X POST http://192.168.1.100/api/graph/sync
```

### Atualizar a aplicação

```bash
cd /opt/gp-rotation
git pull
docker compose up -d --build
```

---

## Troubleshooting

| Sintoma | Causa provável | Solução |
|---------|----------------|---------|
| TV mostra "Conectando..." | Servidor Docker down | `docker compose ps` → `docker compose restart` |
| TV mostra dados desatualizados | WebSocket desconectado | A página faz polling a cada 15s como fallback automático |
| Power Automate retorna 401 | WEBHOOK_SECRET errado | Conferir o secret no .env e no flow do Power Automate |
| TV tela preta | Chrome travou | Watchdog reinicia automaticamente em 30s |
| Graph API 403 | Permissões do App Registration | Re-verificar `Sites.Read.All` + admin consent |
