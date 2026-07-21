# Deploy no Render

O jogo usa **dois serviços** no Render:

| Serviço | Tipo | Função |
|---------|------|--------|
| `fps-shooter-api` | Web Service (Node) | Servidor Colyseus (WebSocket) |
| `fps-shooter` | Static Site | Cliente 3D (build Vite → `dist/`) |

---

## Opção A — Blueprint (recomendado)

1. Faça push do projeto para um repositório no **GitHub** ou **GitLab**.
2. Acesse [render.com](https://render.com) → **New** → **Blueprint**.
3. Conecte o repositório e selecione o `render.yaml` na raiz.
4. Confirme a criação dos dois serviços e aguarde o deploy.
5. Abra a URL do serviço **`fps-shooter`** (Static Site) no navegador.

O Blueprint liga automaticamente `VITE_SERVER_URL` à URL pública do `fps-shooter-api`.

---

## Opção B — Manual (painel)

### 1. Web Service — API

| Campo | Valor |
|-------|--------|
| Name | `fps-shooter-api` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Plan | Free (ou pago para evitar sleep) |

Não precisa definir `PORT` — o Render injeta sozinho.

Anote a URL pública, ex.: `https://fps-shooter-api.onrender.com`

### 2. Static Site — Cliente

| Campo | Valor |
|-------|--------|
| Name | `fps-shooter` |
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist` |

**Environment variable (obrigatória no build):**

| Key | Value |
|-----|--------|
| `VITE_SERVER_URL` | `https://fps-shooter-api.onrender.com` |

(use a URL real do passo 1, com `https://`)

Deploy o **API primeiro**, depois o Static Site.

---

## Testar localmente com URL de produção

```bash
# Terminal 1
npm run server

# Terminal 2 — simula build de produção apontando para localhost
VITE_SERVER_URL=http://localhost:2567 npm run build
npm run preview
```

No Windows (PowerShell):

```powershell
$env:VITE_SERVER_URL="http://localhost:2567"; npm run build; npm run preview
```

---

## Plano Free — o que esperar

- O **Web Service dorme** após ~15 min sem conexões → primeiro acesso demora ~30–60 s.
- WebSockets funcionam, mas a sessão cai se o serviço reiniciar.
- Dois domínios separados (`*.onrender.com`) — por isso existe `VITE_SERVER_URL`.

---

## Troubleshooting

| Problema | Causa provável |
|----------|----------------|
| "Servidor offline" no menu | API ainda acordando (Free) ou URL errada em `VITE_SERVER_URL` |
| Lobby vazio / não conecta | Static Site buildado **sem** `VITE_SERVER_URL` — refaça o deploy do cliente |
| WebSocket falha | URL deve ser `https://...` (não `ws://`) no env do Vite |

---

## Variáveis de ambiente

| Variável | Onde | Descrição |
|----------|------|-----------|
| `PORT` | API (auto) | Porta HTTP/WS — definida pelo Render |
| `VITE_SERVER_URL` | Static Site (build) | URL HTTPS do `fps-shooter-api` |
