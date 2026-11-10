# Handoff: o que está pronto e o que falta

Este documento é para quem vai **colocar o projeto no ar em `cardgame.hchrist.com`** e terminar as pendências.
Contexto técnico: [ARCHITECTURE.md](ARCHITECTURE.md) · passo a passo do servidor: [DEPLOY.md](DEPLOY.md) ·
app desktop: [apps/desktop/README.md](apps/desktop/README.md).

## Pronto (feito e testado localmente)

- **Servidor** (`apps/server`): Node + Socket.IO + SQLite local (`node:sqlite`, sem instalar banco). Porta **4080**.
  Ele serve num só processo a API em `/socket.io/`, o jogo web em `/`, o app desktop em `/desktop/`, o `/health`
  e o webhook de deploy em `/api/deploy/github`.
- **9 jogos com bots** (`packages/games`): Poker, Blackjack, Truco Paulista, Bisca, Sueca, Copas, Fodinha, Cacheta e Pife.
  São 94 testes (`npm test`). Cada um teve uma partida completa testada no servidor real.
- **Web app** (`apps/client`): login, lobby, salas públicas/privadas, chat, ranking, histórico, admin, telas dos 9 jogos
  revisadas em 340x390 / 420x570 / 1280x720 e animações de carta.
  As salas têm tempo por jogada configurável, incluindo "Sem limite", e a opção "joga automático" ou "sai da mesa" quando o tempo acaba.
- **App desktop** (`apps/desktop`): `.exe` de ~430 KB em C# (.NET Framework 4.8, que já vem no Windows) + WebView2.
  É uma janela flutuante que abre o site, com bandeja, atalho global, sempre no topo, opacidade e lembrar posição.
  Tem auto-update via `/desktop/version.json`.
- **Atualização:** `scripts/deploy.sh` (pull + install + build + `pm2 reload`), rodado na mão na VPS. Existe um webhook opcional que dispara isso a cada push, desligado por padrão.
  Navegador e app recarregam sozinhos quando o servidor muda de versão (`server:hello` com o `buildId`).
- **GitHub Action** (`.github/workflows/desktop-release.yml`): publica o `.exe` em Releases quando
  `apps/desktop/release/version.json` muda de versão.

## A fazer (em ordem)

### 1. Colocar no ar
- [ ] VPS com **Node 24+**, `git`, `pm2` (`npm i -g pm2`) e `util-linux` (`flock`/`setsid`, normalmente já vem).
- [ ] Clonar e subir o servidor:
  ```bash
  git clone https://github.com/harryChrist/poker-game.git && cd poker-game
  npm install
  cp .env.example .env
  npm run build
  pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
  curl http://localhost:4080/health
  ```
- [ ] DNS: registro `A` de `cardgame.hchrist.com` apontando para a VPS.
- [ ] Proxy reverso + HTTPS (Caddy ou Nginx, os dois prontos no DEPLOY.md) para `127.0.0.1:4080`, **com WebSocket**.
  Feche a 4080 no firewall.
- [ ] **Logo em seguida, crie a conta do dono no site.** O **primeiro usuário registrado vira admin**.
  Também dá para garantir pelo `.env` com `ADMIN_USERNAMES=<usuario>`.

### 2. Atualizações (deploy manual)
O dono prefere atualizar **na mão**: depois de dar push, na VPS rode
```bash
cd poker-game && bash scripts/deploy.sh
```
Isso faz pull, install, build e `pm2 reload`, com log na tela. Quem estiver com o jogo aberto recarrega sozinho na versão nova.
**Não configure webhook** e deixe `DEPLOY_WEBHOOK_SECRET` vazio: assim a rota `/api/deploy/github` fica desligada (404).
- [ ] Rodar o `scripts/deploy.sh` uma vez para validar. **Ele nunca rodou em Linux de verdade.**

### 3. Release do .exe no GitHub
- [ ] Ver na aba **Actions** se "Publicar app desktop" rodou e criou o release `desktop-v1.0.0`.
  Se não rodou, dispare à mão ("Run workflow").
- [ ] Testar o link `https://github.com/harryChrist/poker-game/releases/latest/download/MesaDeCartas.exe`.

### 4. Conferências manuais (não verificadas ainda)
- [ ] App desktop: menu e clique do ícone da bandeja, balões, redimensionar pelas bordas, posição restaurada após
  reiniciar, links externos abrindo no navegador.
- [ ] Jogar de verdade com 2+ pessoas pela internet (até agora só servidor local + bots).
- [ ] Reconexão: derrubar a internet no meio de uma mão e voltar, e conferir se o jogador volta para o mesmo lugar.

## Pontos conhecidos / ideias de melhoria

- Cada deploy **reinicia o servidor**: as mesas abertas acabam e as fichas voltam para as carteiras.
  Melhoria possível: avisar as salas antes do restart, ou só aplicar quando não houver partidas.
- Visual: Poker com 9 jogadores e Fodinha com 8 ficam apertados na janela mínima (nada se sobrepõe, mas é denso).
  O Blackjack em tela cheia sobra espaço nas laterais.
- `deploy.sh` faz `git reset --hard origin/main`: **não edite arquivos versionados direto na VPS**.
  O `.env` e a pasta `data/` não são afetados.
- O banco é `data/cartas.db`. Para backup, copie a pasta `data/` (por exemplo, num cron diário).

## Como publicar uma versão nova

- **Jogo, servidor ou telas:** commit + push na `main` e depois `bash scripts/deploy.sh` na VPS.
- **O `.exe`:** precisa ser gerado no Windows, porque usa o `csc` do .NET Framework.
  1. Aumente a versão em `apps/desktop/src/AssemblyInfo.cs`.
  2. Rode `npm run build:exe`.
  3. Faça commit de `apps/desktop/release/` e push.
  4. O servidor passa a oferecer o exe novo (os apps se atualizam sozinhos) e a Action cria o Release.
