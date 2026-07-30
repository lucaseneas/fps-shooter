# Deploy no Render

O jogo usa **dois serviços** no Render + **Postgres no Supabase** (auth):

| Recurso | Onde | Função |
|---------|------|--------|
| `fps-shooter-api` | Render Web Service | Colyseus + login HTTP |
| `fps-shooter` | Render Static Site | Cliente 3D (Vite → `dist/`) |
| Postgres | Supabase | Contas de utilizadores |

---

## Opção A — Blueprint (recomendado)

1. Cria o projeto no **Supabase** e copia a **Connection string (URI)** (ver secção Auth abaixo).
2. Push do repo → [render.com](https://render.com) → **New** → **Blueprint**.
3. Na sync, cola `DATABASE_URL` quando o painel pedir; `JWT_SECRET` é gerado sozinho.
4. Abre a URL do **`fps-shooter`** (Static Site).

O Blueprint liga `VITE_SERVER_URL` à URL pública do `fps-shooter-api`.

### Auth — Supabase Postgres

1. [supabase.com](https://supabase.com) → New project → guarda a password da DB.
2. **Project Settings → Database → Connection string → URI**.
3. Escolhe **Session pooler** (ou Direct) e substitui `[YOUR-PASSWORD]`.
4. No Render → `fps-shooter-api` → Environment:
   - `DATABASE_URL` = essa URI
   - `JWT_SECRET` = (já vem do Blueprint, ou gera um valor longo)
5. Redeploy da API. No arranque cria a tabela `users` sozinha.

Sem `DATABASE_URL`, a API sobe em modo convidado (só nome).

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
| `No open HTTP ports detected` | Servidor precisa escutar em `0.0.0.0` e responder em `/health` — já corrigido em `server/index.ts`; faça redeploy do API |

---

## Variáveis de ambiente

| Variável | Onde | Descrição |
|----------|------|-----------|
| `PORT` | API (auto) | Porta HTTP/WS — definida pelo Render |
| `DATABASE_URL` | API | URI Postgres do **Supabase** |
| `JWT_SECRET` | API (Blueprint) | Segredo para assinar tokens de login |
| `VITE_SERVER_URL` | Static Site (build) | URL HTTPS do `fps-shooter-api` |
