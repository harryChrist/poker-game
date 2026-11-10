# Mesa de Cartas — Arquitetura

Jogo de cartas multiplayer para amigos: jogável no navegador (https://cardgame.hchrist.com) e por um app desktop minúsculo (janela flutuante) + servidor Node.
Fichas virtuais (sem dinheiro real). Interface toda em português do Brasil.

## Monorepo (npm workspaces)

```
packages/shared   Contrato: tipos de carta, metadados dos jogos, interface dos motores, protocolo Socket.IO
packages/games    Motores de regras (puros, testáveis) + bots. Um diretório por jogo.
apps/server       Node + Socket.IO + SQLite (node:sqlite). Contas, carteira, lobby, salas, chat, ranking, admin.
apps/client       React + Vite. A web app do jogo (servida pelo servidor em /).
apps/desktop      App Windows nativo (C# .NET Framework 4.8 + WebView2, ~430 KB) que abre o site numa janela flutuante, com auto-update.
```

Pacotes de workspace exportam TypeScript direto (`exports: ./src/index.ts`); tsx (servidor), Vite (cliente) e esbuild (build) compilam.

## Decisões

| Tema | Decisão |
|---|---|
| Dinheiro | Fichas virtuais. Saldo inicial 10.000. Recarga grátis para 10.000 quando saldo + fichas em jogo < 1.000 (cooldown 10 min). Bônus de 1.000 a cada hora. Valores via env. |
| Contas | Usuário + senha (scrypt). Token de sessão aleatório (guardado com hash sha256), validade 30 dias. Primeiro usuário registrado vira admin; `ADMIN_USERNAMES` no env também. |
| Tempo real | Socket.IO (websocket). Reconexão automática; o assento é mantido e, enquanto desconectado, o servidor aplica `timeoutAction` quando o tempo estoura. |
| Bots | Preenchem vagas (host adiciona, ou automaticamente ao começar partida). Fichas dos bots são virtuais (não saem de carteira nenhuma). |
| Economia session (poker, blackjack) | Jogador senta com buy-in (sai da carteira → escrow). Ao levantar, `cashOut` volta. Escrow persistido no SQLite após cada passo; se o servidor cair, no boot o escrow é devolvido à carteira. |
| Economia match (demais) | Ao começar, cada humano paga `stake` (escrow). No fim, pote = stake × nº de assentos (bots incluídos) dividido entre `winners`. Humano que sai no meio perde a aposta e vira bot. |
| Salas | Lista pública no lobby + salas privadas por código de 6 caracteres. Host configura, adiciona bots, inicia. Espectadores permitidos. Sala sem humanos por 2 min é fechada. |
| Chat | Por sala, 200 caracteres, rate limit, últimas 50 mensagens em memória. |
| Ranking / histórico | Ranking por total de fichas (saldo + em jogo) e vitórias. Histórico por usuário (partidas match e sessões de mesa). |
| Admin | No próprio app (aba visível só para admin): usuários, ajustar saldo, banir, promover, resetar senha, salas ativas, fechar sala (devolve escrow). |
| Janela (app desktop) | Sem borda, arrastável, redimensionável (mín. 340x460), lembra posição/tamanho, sempre-no-topo (toggle), opacidade ajustável, atalho global para esconder/mostrar (padrão Ctrl+Shift+Espaço), ícone na bandeja; fechar = minimizar para bandeja. |
| Deploy | Servidor Node direto (local ou VPS com pm2, ver DEPLOY.md). Banco SQLite local em arquivo. Cliente aponta para URL configurável. |

## Jogos

| id | Jogo | Economia | Jogadores |
|---|---|---|---|
| poker | Texas Hold'em No-Limit | session | 2–9 |
| blackjack | Blackjack (S17, BJ 3:2) | session | 1–7 |
| truco | Truco Paulista (vira/manilha) | match | 2 ou 4 (duplas) |
| bisca | Bisca de 3 cartas | match | 2 ou 4 (duplas) |
| sueca | Sueca | match | 4 (duplas) |
| copas | Copas (Hearts) | match | 4 |
| fodinha | Fodinha | match | 2–8 |
| cacheta | Cacheta | match | 2–6 |
| pife | Pife | match | 2–6 |

Contratos: `packages/shared/src/engine.ts` (motores), `packages/shared/src/protocol.ts` (socket),
`packages/shared/src/games.ts` (metadados/config), `apps/client/src/games/types.ts` (props das telas de jogo),
`apps/client/src/ui/cards.tsx` (componentes visuais de carta/assento/fichas).

## Comandos

```bash
npm run dev:server      # servidor em http://localhost:4080
npm run dev:client      # web app no Vite (http://localhost:5173), falando com a 4080
npm test                # testes (vitest)
npm run typecheck
npm run build           # build da web app + bundle do servidor
npm run build:exe       # gera apps/desktop/release/MesaDeCartas.exe + version.json
```
