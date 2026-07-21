# GDD — FPS Web 3D (Modo Mata-Mata)
> Documento de design vivo. Escrito para desenvolvimento em **vibecoding**: escopo pequeno, iterativo, sem travar em decisões grandes antes de ter algo jogável.

---

## 1. Visão Geral

Jogo de tiro em primeira pessoa (FPS), 3D, rodando 100% no navegador. Inspirado na sensação de jogo do **Counter-Strike** (tiro tático, hitscan, TTK curto, movimentação precisa), mas sem economia de armas, sem bombas, sem rounds complexos — só ação direta.

**Por enquanto, um único modo:** Mata-Mata (Free-for-All Deathmatch), com salas que misturam **jogadores online + bots** preenchendo vagas vazias.

**Pilar de design #1:** a sala nunca fica vazia ou morta. Se faltam jogadores humanos, bots entram para manter o ritmo.

**Pilar de design #2:** simplicidade primeiro. Nada de progressão, economia ou meta-game nesta fase — o foco é validar movimentação + tiro + rede funcionando bem.

---

## 2. Escopo do MVP

O que **entra** na primeira versão jogável:
- 1 mapa pequeno/médio
- 1 modo: Mata-Mata
- 2–3 armas (ex: pistola inicial + rifle + escopeta)
- Bots com IA simples (patrulha, mira, atira, evita paredes)
- HUD básico: vida, munição, kills, placar
- Respawn automático
- Partida com tempo ou limite de kills

O que **fica de fora** por enquanto (ver seção 13).

---

## 3. Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Render 3D | Babylon.js |
| Networking / Server autoritativo | Colyseus |
| Cliente | Web (navegador), sem instalação |
| Lógica de hit | Hitscan, validado no servidor |
| Movimentação | Client-side prediction + reconciliação |
| Bots | IA server-side, tratados como "jogadores fantasmas" na sala |

> Detalhes de netcode (predição, lag compensation, hitscan) já estão cobertos em `colyseus-fps-skeleton.md` — este documento foca em **design**, não em implementação de rede.

---

## 4. Modo de Jogo: Mata-Mata (Deathmatch)

### 4.1 Regras
- Todos contra todos (FFA). Sem times nesta fase.
- Matar = 1 ponto. Morrer = sem penalidade de pontos (por enquanto).
- Respawn automático após X segundos (sugestão inicial: 3s), em ponto aleatório longe de quem te matou.

### 4.2 Condição de vitória
Escolher uma (ou permitir configurar depois):
- **Por tempo:** partida dura N minutos (ex: 10 min), vence quem tiver mais kills ao fim.
- **Por kills:** primeiro a chegar a N kills (ex: 30) vence.

*Sugestão para MVP: por tempo, é mais simples de implementar e testar.*

### 4.3 Tamanho da sala
- Capacidade alvo: 8 a 10 "jogadores" simultâneos (somando humanos + bots).
- Bots preenchem os slots vazios ao criar a sala.
- Se um humano entra depois, um bot é removido para abrir espaço (troca suave, sem matar o bot no meio da tela).

### 4.4 Bots vs. Humanos
- Do ponto de vista do cliente, bots devem aparecer como jogadores normais (mesmo modelo, mesmo HUD de nome/vida).
- Nomes de bots gerados aleatoriamente (lista simples), pra não ficar óbvio "BOT_1", "BOT_2" (ou deixar óbvio, é decisão de estilo — pode configurar depois).

---

## 5. Mecânicas Core

### 5.1 Movimentação
- WASD + mouse look, padrão FPS.
- Pulo simples (sem bunny hop avançado nesta fase — considerar depois se quiser mais "movement skill").
- Sem sprint na v1 (mantém simples), avaliar depois.

### 5.2 Tiro
- Hitscan (sem projétil físico visível na v1, exceto talvez a escopeta com spread).
- Recoil leve, previsível (não aleatório demais — CS-like, controlável).
- Cadência de tiro por arma (ver seção 6).

### 5.3 Vida e Dano
- Vida: 100.
- Dano varia por arma e por parte do corpo (headshot = multiplicador, ex: x2 ou instakill dependendo da arma).
- Sem armadura nesta fase.

### 5.4 Morte e Respawn
- Tela de "morreu" simples (quem te matou, com quê).
- Respawn automático (sem tela de espera longa).

---

## 6. Armas (lista inicial)

| Arma | Tipo | Dano corpo | Dano cabeça | Cadência | Papel |
|---|---|---|---|---|---|
| Pistola | Hitscan | 20 | 50 | Média | Arma inicial, sempre disponível |
| Rifle | Hitscan | 25 | 60 | Alta (auto) | Arma principal, média/longa distância |
| Escopeta | Hitscan (spread) | 60–80 (perto) | — | Baixa | Curta distância, alto risco/recompensa |

> Pickups de arma no mapa (spawn fixo) ou todo mundo já nasce com o kit completo — **decisão em aberto**, ver seção 9 do checklist de decisões.

---

## 7. Bots (IA)

### 7.1 Comportamento esperado no MVP
- Patrulha entre pontos do mapa quando não vê ninguém.
- Ao avistar um jogador (linha de visão + distância), entra em modo combate.
- Mira com algum erro humano (não é aimbot perfeito — precisão configurável).
- Foge ou recua se vida baixa (opcional, pode ficar pra v2).
- Evita obstáculos básicos (usar waypoints ou navmesh simples).

### 7.2 Dificuldade
- Nível único no MVP (nível "médio").
- Estrutura pensada para permitir 2–3 níveis de dificuldade no futuro (ajustando: precisão, tempo de reação, agressividade).

---

## 8. Mapa

- 1 mapa para o MVP: pequeno/médio, com mix de áreas abertas (para rifle) e corredores/cantos (para escopeta).
- Pontos de spawn distribuídos, evitando spawn-kill.
- Sem destruição de cenário nesta fase.

---

## 9. HUD / UI

Elementos mínimos:
- Crosshair central
- Vida (número + barra)
- Munição atual / reserva
- Contador de kills (seu placar)
- Placar geral (scoreboard) — tecla para abrir (ex: Tab)
- Kill feed (quem matou quem, canto da tela)
- Timer da partida (se modo por tempo)

---

## 10. Roadmap Incremental (estilo vibecoding)

Sugestão de ordem de construção — cada etapa deve resultar em algo **testável**:

1. **Movimentação + câmera** funcionando sozinho, sem rede, num mapa placeholder (cubo/plano).
2. **Conexão com Colyseus**: ver o próprio player + outro jogador de teste se mexendo em tempo real.
3. **Tiro hitscan local** (sem dano ainda, só raycasting + efeito visual).
4. **Dano + vida + morte + respawn**, validado no servidor.
5. **1 bot simples** andando e atirando (sem IA esperta ainda, só pra testar o "fantasma" na sala).
6. **Mapa real** (troca o placeholder).
7. **HUD completo**.
8. **Preenchimento automático de sala com bots** + troca bot↔humano.
9. **Balanceamento**: dano, cadência, tempo de respawn.
10. **Polish**: sons, efeitos de impacto, feedback de hit.

---

## 11. Fora de Escopo (por enquanto)

Para não perder o foco do MVP:
- Times / modos por objetivo (bomba, resgate, etc.)
- Economia / compra de armas
- Progressão de conta / XP / desbloqueáveis
- Skins / customização
- Voice chat
- Ranking / matchmaking competitivo
- Mobile / touch controls

---

## 12. Decisões Tomadas

- [x] Kit de armas fixo desde o início ou pickups no mapa? → **Fixo** (todo mundo nasce com pistola + rifle + escopeta).
- [x] Condição de vitória: por tempo ou por kills? → **Por kills** (primeiro a 20 kills vence — configurável em `src/game/config.ts`).
- [x] Nomes de bots visíveis como "bot" ou disfarçados? → **Disfarçados** (lista de nomes "humanos" em `src/game/names.ts`).
- [x] Sprint entra na v1 ou fica pra depois? → **Entrou já na Fase 1** (tecla `Shift`, apenas como teste de movimentação; fácil de remover/ajustar depois).
- [x] Quantos bots no máximo por sala? → **Sala de 8 slots**; slots sem humanos são preenchidos com bots (local: 1 player + 7 bots).

---

## 13. Status de Desenvolvimento

### ✅ Fase 1 — Movimentação + Câmera (concluída)
Corresponde ao passo **1** do Roadmap (seção 10). Cliente local, **sem rede**, num mapa placeholder.

Implementado:
- Setup do projeto: **Vite + TypeScript + Babylon.js** (client web puro, sem framework de UI — mantém o foco no game loop).
- Cena placeholder: chão com grid (80×80), 4 paredes de borda, caixas/obstáculos e uma plataforma para testar pulo.
- Controlador FPS local (`FpsController`):
  - Mouse look via **Pointer Lock API** (yaw/pitch com clamp vertical).
  - Movimento **WASD** relativo à direção da câmera.
  - **Pulo** (`Espaço`) com gravidade manual e detecção de chão.
  - **Correr** (`Shift`) — teste de sprint.
  - Colisão via `moveWithCollisions` num mesh colisor invisível (o "corpo" do player). A câmera acompanha o corpo — decisão pensada para reaproveitar a mesma lógica no futuro *client-side prediction* (o corpo já é uma entidade separada da câmera).
- HUD inicial: crosshair central + overlay de instruções + painel de debug (FPS, posição, estado no chão).

> **Nota de arquitetura:** o corpo colisor é separado da câmera de propósito. Na Fase 2 (rede), o servidor autoritativo controla a posição do "corpo"; o cliente prevê localmente e reconcilia. Manter câmera ≠ corpo desde já evita retrabalho.

### ✅ Fase 2 — Armas + Bots (concluída)
Cobriu os passos **3, 4 e 5** do Roadmap (tiro hitscan, dano/vida/morte/respawn, bots) **em modo local** — a validação server-side fica para a fase de rede. Também adiantou boa parte do **7** (HUD).

Implementado:
- **Sistema de armas** (`src/game/WeaponSystem.ts` + `src/game/weapons.ts`):
  - As 3 armas do GDD com kit fixo: pistola (semi-auto), rifle (automático) e escopeta (9 pellets com spread largo, sem headshot).
  - Hitscan por raycast do centro da câmera, spread em cone, recoil vertical previsível (CS-like), falloff de dano por distância.
  - Munição (pente + reserva), reload (`R`, com reload automático ao esvaziar), troca por `1/2/3` ou scroll.
- **View model** (`src/player/ViewModel.ts`): arma em primeira pessoa (geometria simples), com kick ao atirar e animação de reload.
- **Efeitos** (`src/game/effects.ts`): tracer do tiro, faísca de impacto em parede e "sangue" em acerto.
- **Bots** (`src/bots/Bot.ts`): 7 bots (sala de 8), nomes disfarçados, corpo com **hitbox separada de cabeça e corpo**, nametag flutuante.
  - IA: patrulha entre pontos → entra em combate ao ter linha de visão (raycast contra geometria) → tempo de reação + erro de mira "humano" → strafe/aproxima/recua conforme distância → perde o alvo sem LOS por 2.5s.
  - Bots atiram em **qualquer** combatente (FFA de verdade: bot mata bot).
- **Partida** (`src/game/GameState.ts` + `src/game/config.ts`): vida 100, dano por parte do corpo, kill feed, placar, **vitória por kills (20)**, respawn de 3s em ponto distante da morte (`src/game/spawnPoints.ts`).
- **HUD completo** (`src/ui/Hud.ts`): barra de vida com cor dinâmica, munição, contador de kills, kill feed, scoreboard (`Tab`), hitmarker (vermelho em headshot), vinheta de dano, tela de morte (quem/com quê + timer) e tela de fim de partida com "jogar novamente".

> **Nota de arquitetura:** todo dano passa por `GameState.applyDamage` — ponto único que vira a autoridade do servidor na fase de rede. Hitboxes usam `metadata.hitbox = { id, part }`; geometria estática usa `metadata.staticGeo` (mesma marcação servirá para o hitscan server-side).

### ✅ Fase 3 — Multiplayer com Colyseus (concluída)
Cobriu os passos **2, 4 (parcial), 5 e 8** do Roadmap: sala online, partida validada no servidor, bots como "jogadores fantasmas" server-side e preenchimento automático de slots com troca bot↔humano.

Implementado:
- **Servidor Colyseus** (`server/`): sala `deathmatch` com schema sincronizado (posição, yaw, vida, kills, deaths, alive por jogador).
  - **Autoridade do servidor**: vida, dano (recalculado com a distância do servidor + tabela de armas), kills, respawn (3s, longe da morte), vitória por kills e reset automático da partida 8s após o fim.
  - **Bots server-side** (`server/BotAi.ts`): mesma IA da Fase 2 (patrulha → LOS → reação → strafe/aproxima/recua), mas rodando no servidor sem Babylon — linha de visão e colisão usam **AABBs de `shared/mapData.ts`** e o acerto usa modelo probabilístico (erro angular vs. tamanho do alvo).
  - **Sala nunca vazia (pilar #1)**: `rebalanceBots()` mantém humanos + bots = 8; humano entra → um bot sai; humano sai → um bot volta.
- **Geometria compartilhada** (`shared/`): o mapa agora é **dados** (`mapData.ts`) usados pelo cliente (render + colisão Babylon) e pelo servidor (física AABB + LOS) — fonte única, sem divergência. Idem armas, config, spawns e nomes.
- **Cliente em rede** (`src/net/`): conexão com nome de jogador (overlay), jogadores remotos (humanos e bots são indistinguíveis, como pede o GDD) com **interpolação** de posição/yaw, tracers de tiros remotos retransmitidos pelo servidor, kill feed/placar/telas alimentados pelo estado do servidor.
- **Velocidade ajustada**: andar 7 → **5.5**, correr 1.6x → **1.5x**.
- Teste de fumaça (`server/smokeTest.ts`): conecta na sala e valida bots se movendo/atirando, morte/respawn e dano server-side.

> **Netcode desta fase (simplificações deliberadas):** a posição dos humanos ainda é client-authoritative (enviada a 20Hz) e o hit é detectado no cliente e **validado** no servidor (alvo vivo, distância do servidor para o falloff). Client-side prediction/reconciliação e lag compensation ficam para a próxima iteração de netcode.

### Estrutura de pastas
```
fps-shooter/
├── index.html               # canvas + HUD + overlay (nome + conexão)
├── shared/                  # código usado por cliente E servidor
│   ├── mapData.ts           # geometria do mapa como AABBs (fonte única)
│   ├── movement.ts          # física do player determinística (prediction)
│   ├── weapons.ts           # stats das 3 armas + falloff
│   ├── spawnPoints.ts       # spawns + "longe de onde morreu"
│   ├── names.ts             # nomes disfarçados dos bots
│   └── config.ts            # sala 8, 20 kills, respawn 3s, porta 2567
├── server/                  # servidor autoritativo (Colyseus)
│   ├── index.ts             # bootstrap (ws://localhost:2567)
│   ├── DeathmatchRoom.ts    # sala: dano, kills, respawn, vitória, bots
│   ├── BotAi.ts             # IA server-side (LOS/colisão via AABB)
│   ├── physics.ts           # moveWithCollisions + segmentBlocked (AABB)
│   ├── schema.ts            # estado sincronizado (@colyseus/schema)
│   └── smokeTest.ts         # teste de fumaça da sala
├── src/                     # cliente (Babylon.js)
│   ├── main.ts              # conexão, reconcile do estado, render loop
│   ├── net/
│   │   ├── NetworkClient.ts # join + leitura do estado
│   │   └── RemotePlayer.ts  # visual interpolado + hitboxes
│   ├── scene/createScene.ts # constrói o mapa a partir de shared/mapData
│   ├── player/              # FpsController + ViewModel
│   ├── game/                # WeaponSystem (hitscan local) + effects
│   └── ui/Hud.ts            # HUD (vida, munição, placar, telas)
├── package.json
└── tsconfig.json            # + server/tsconfig.json (CJS, decorators)
```

### Como rodar
```bash
npm install
npm run server   # servidor Colyseus em ws://localhost:2567
npm run dev      # cliente em http://localhost:5173 (ou 5174)
```
Abra 2 abas para testar multiplayer local. Controles: `WASD` mover · `Mouse` olhar · `Click` atirar · `1/2/3`/scroll trocar arma · `R` recarregar · `Espaço` pular · `Shift` correr · `Tab` placar · `Esc` liberar cursor.

### ✅ Fase 4 — Netcode (prediction + lag compensation) + Configurações (concluída)
Fecha o passo **4** do Roadmap em nível "produção": o servidor agora é autoridade de **tudo**, incluindo posição e detecção de acerto.

Implementado:
- **Física compartilhada e determinística** (`shared/movement.ts`): simulação do player (WASD, pulo, gravidade, degraus, colisão círculo-vs-AABB) em timestep fixo de 60Hz, rodando **idêntica** no cliente e no servidor.
- **Movimento server-authoritative com client-side prediction**:
  - O cliente não envia mais posição — envia **inputs numerados** (`seq`, direção, yaw, pulo, corrida), um por passo fixo.
  - O servidor simula os inputs com a mesma física (cap de 6 inputs/tick contra speedhack) e publica posição + `lastSeq` no estado.
  - **Reconciliação**: o cliente descarta os inputs já reconhecidos e re-simula os pendentes sobre o estado autoritativo. Como a física é determinística, a correção é normalmente invisível.
- **Hitscan server-side com lag compensation**:
  - O cliente envia origem + direções dos pellets; o hit local vira apenas **hitmarker otimista** e efeitos visuais.
  - O servidor guarda **histórico de posições (1s)** de todos os combatentes, mede o **RTT** de cada cliente (ping a cada 2s) e **rebobina** os alvos em `RTT/2 + 100ms` antes de fazer o raycast (esferas para cabeça, AABB para corpo, mapa via slab method).
  - Validações: cadência por arma, nº de pellets, origem a ≤2m do olho server-side, alvo vivo.
- **Menu de configurações** no overlay: slider de **sensibilidade da mira** (0.1x–3x, persistido em `localStorage`). Acessível a qualquer momento com `Esc`.
- Smoke test (`server/smokeTest.ts`) atualizado: valida movimento por inputs (5.50m simulados vs 5.5m esperado), hitscan server-side e rejeição de origem falsa.

> **Simplificações conhecidas:** munição/reload continuam client-side (o servidor limita só a cadência); sem colisão player-vs-player; sem teto/overhangs no mapa (a física vertical não trata, e o mapa atual não tem).

**Ajustes pós-Fase 4:**
- **Indicador de ping** no painel de debug (canto superior esquerdo), medido pelo cliente com eco a cada 2s.
- **Configuração "Bots na sala"** (0–7) no menu de configurações — enviada ao servidor (`setBots`), que adiciona/remove bots respeitando os slots ocupados por humanos. Persistida em `localStorage`.
- **Strafe lateral mais lento** (75% da velocidade de andar, CS-like) em `shared/movement.ts` — vale para prediction e servidor.

### ✅ Fase 5 — Mapa real + Polish + Balanceamento (concluída)
Fecha os passos **6, 9 e 10** do Roadmap — **MVP do GDD completo** (todos os 10 passos).

Implementado:
- **Mapa "Praça"** (`shared/mapData.ts` reescrito): arena 80x80 com zonas de gameplay distintas, como pede a seção 8 do GDD:
  - **Centro:** praça elevada (1m) com escadas ao norte/sul e coberturas em cima — posição de poder disputada.
  - **Noroeste:** armazém com paredes 3.5m (sem teto), duas entradas e caixas internas — combate curto.
  - **Nordeste:** corredor fechado de 14m (zona de escopeta) com caixa no meio.
  - **Sudoeste:** campo aberto com pilares esparsos (zona de rifle).
  - **Sudeste:** composto em L com caixas.
  - Muros centrais bloqueiam a visão leste-oeste pelo meio, forçando rotações.
  - Por ser data-driven, o mapa novo vale automaticamente para render, colisão, prediction, hitscan e LOS dos bots. Spawn points redistribuídos pelas bordas (verificados contra a geometria).
- **Áudio procedural** (`src/game/audio.ts`, WebAudio, sem assets): som por arma (pistola/rifle/escopeta), tiros remotos com volume por distância, hitmarker (agudo extra em headshot), dano recebido, kill confirm, morte, respawn, reload e passos (cadência muda ao correr).
- **Polish visual:** muzzle flash no view model, névoa linear leve para profundidade, materiais distintos por tipo de estrutura (muro/prédio/caixa/plataforma/pilar).
- **Configuração de volume** no menu (persistida em `localStorage`).
- **Balanceamento (passe inicial):** rifle com spread 1.1→1.2 (menos "laser" à distância); escopeta com falloff mais curto (25→22m) para reforçar o papel de curta distância. Ajustes finos dependem de playtests.

### ✅ Fase 6 — Salas, minimapa e arma nos inimigos (concluída)
Primeira fase pós-MVP, a pedido do usuário.

Implementado:
- **Lobby de salas:** ao abrir o jogo, o overlay mostra a lista de salas disponíveis (via `getAvailableRooms` do Colyseus), com quantidade de jogadores humanos (`2/8`) e o mapa (metadata `map` setada pela sala no servidor). Dá para **entrar** numa sala existente ou **criar** uma nova; a lista se atualiza sozinha a cada 3s e tem botão "Atualizar". Se não houver sala, aparece "Nenhuma sala disponível — crie a primeira". Coberto por `server/lobbyTest.ts`.
- **Minimapa** (`src/ui/Minimap.ts`): canvas 2D no canto superior direito, norte fixo. A geometria estática é pré-renderizada uma vez (offscreen canvas) com cores por tipo de estrutura; por cima, a ~15 Hz, desenha inimigos vivos (ponto vermelho + risco na direção da mira) e o player (seta laranja girando com a câmera). Kill feed desceu para baixo do minimapa.
- **Arma na mão dos inimigos** (`RemotePlayer`): caixa + cano presos ao corpo, apontando na direção do yaw sincronizado — dá leitura de para onde cada inimigo está mirando, no mundo e no minimapa.
- **Menu inicial separado do jogo:** a primeira tela é um menu opaco (nada renderiza no fundo — o render loop nem roda fora de partida) com nome, lista de salas, informações de como jogar/arsenal e um botão de engrenagem no canto que abre as configurações. Ao entrar numa sala vai direto para o 3D. **ESC no jogo abre o modal de pausa** com as mesmas configurações + "Voltar ao jogo" / "Sair para o menu" (sai da sala e volta ao lobby, com estado da partida todo resetado). A tela de fim de partida também ganhou botão "Voltar ao menu".

Decisões:
- Lista de salas usa o polling nativo do Colyseus (sem `LobbyRoom` realtime) — suficiente para a escala atual, sem sala extra no servidor.
- Minimapa mostra **todos** os inimigos vivos (sem fog of war) — é um FPS casual com bots; esconder atrás de LOS pode vir depois se ficar forte demais.

### 🔜 Próximos passos (pós-MVP)
Possíveis direções:
- **Deploy**: hospedar o servidor Colyseus (ex.: Colyseus Cloud, VPS) e o cliente (build estático) para jogar com amigos.
- Dívidas técnicas: munição validada no servidor, colisão player-vs-player.
- Feel: head bob, FOV dinâmico ao correr, sway da arma.
- Conteúdo: mais mapas (só editar `mapData.ts`), níveis de dificuldade de bot, modos por time.

---

## 14. Ideias Adicionais (backlog de vibecoding)

Registradas durante a Fase 1 para não esquecer — nenhuma é obrigatória, só sementes:

**Movimentação / feel:**
- Head bob sutil ao andar e "landing dip" ao aterrissar (feedback de peso).
- Coyote time no pulo (pequena janela após sair da borda) — perdoa timing.
- Air control limitado (estilo CS) em vez de controle total no ar.
- Separar velocidade de andar vs. correr por eixo (frente mais rápida que trás).

**Câmera / visual:**
- FOV dinâmico (aumenta levemente ao correr).
- View model (braços/arma) fixo na tela, com sway ao mover o mouse.
- Ajuste de sensibilidade e FOV num menu simples de opções (persistir em `localStorage`).

**Mapa / cena:**
- Sistema de spawn points como dados (array de posições) já preparado para o FFA.
- Marcações visuais de "zonas" (aberta p/ rifle, corredor p/ escopeta) para validar o level design.
- Névoa/skybox leve para dar profundidade sem custo.

**Infra / DX:**
- ESLint + Prettier para manter o código consistente.
- Camada de `InputState` desacoplada (snapshot de teclas por tick) — facilita muito o *prediction* depois.
- Fixed timestep para a física do player (determinismo p/ reconciliação com o servidor).
- Estrutura de "entidades remotas" (outros players/bots) desde já, mesmo que só o local exista agora.

---

*Última atualização: Fase 6 concluída — lobby com lista/criação de salas, minimapa e arma visível nos inimigos. Próximo: deploy ou mais conteúdo.*
