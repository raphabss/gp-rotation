# GP Rotation Display System

Sistema de exibição da rotação de GPs (game presenters) em TV de estúdio, para a
Spin Gaming. Lê a matriz de rotação publicada pelos Shift Leaders numa planilha
do SharePoint (via Microsoft Graph) e exibe numa TV em modo kiosk, com painel de
ajustes ao vivo.

## Visão geral

- **TV** (`/tv`): grade de rotação por marca (CDA, GOAT, Blaze, Shufflers), com
  autoescala para qualquer resolução, faixa do horário atual (verde) e próximo
  (amarela), e visão "Agora/Próximo" com a mesa atual + 3 seguintes.
- **Admin** (`/admin`): login por usuário, ajustes ao vivo sobre a rotação
  (overrides que expiram no fim do turno), gestão de usuários, ambientes prod/qa.
- **Turnos**: Manhã, Tarde e Noite, com virada automática por horário
  (cortes 06:45 / 14:45 / 22:45) e detecção do turno pelos horários da planilha.

## Arquitetura

```
SharePoint (Template TV)  --Graph API-->  Backend (Node)  --WS/HTTP-->  TV + Admin
                                              |
                                       snapshots por turno (data/)
```

- Backend: Node.js + Express + WebSocket. Sync periódico do Graph com checagem de
  `lastModified` (só relê quando a planilha muda). Estado em arquivos JSON por
  `(ambiente, turno)`.
- Frontends: HTML/CSS/JS puro (sem build), servidos como estáticos.
- Proxy: Nginx.
- Empacotamento: Docker Compose (serviços `app` + `nginx`).

## Estrutura

```
backend/          API Node (src/), Dockerfile, entrypoint
frontend-tv/      TV (kiosk)
frontend-admin/   painel administrativo
nginx/            proxy reverso
docs/             RUNBOOK operacional
docker-compose.yml
.env.example      modelo de variáveis (copie para .env)
```

## Como rodar

```bash
cp .env.example .env      # preencha as credenciais do Graph e o JWT_SECRET
docker compose up -d --build
# TV:    http://<host>/tv/
# Admin: http://<host>/admin/
```

## Endpoints úteis

- `GET /health` — status do serviço.
- `GET /api/rotation` — rotação mesclada do turno atual (consumida pela TV).
- `GET /api/rotation/shifts` — diagnóstico: estado dos snapshots por turno.
- `GET /api/rotation?shift=noite` — simulação de turno (teste de virada).
- `POST /api/graph/sync?env=prod` — força um sync com o SharePoint.

## Diagnóstico de turnos

`GET /api/rotation/shifts` retorna, por turno: se tem dados, nº de blocos,
primeira/última coluna de horário e quando foi atualizado — além do turno atual,
o próximo e os segundos até o próximo corte. Base para o monitoramento
(Prometheus/Grafana, repositório separado).

## Segurança

- Credenciais (Graph, JWT) ficam **somente** no `.env` (fora do Git).
- Usuários têm senha inicial com **troca obrigatória no primeiro acesso**.
- O fuso do container (`TZ`) precisa estar correto, pois define os cortes de turno.
