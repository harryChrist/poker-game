# Mesa de Cartas

Jogos de cartas online entre amigos, com fichas virtuais: **Poker Texas Hold'em, Blackjack, Truco Paulista, Bisca, Sueca, Copas, Fodinha, Cacheta e Pife**. Bots completam as mesas.

- **Jogar no navegador:** https://cardgame.hchrist.com
- **Baixar o app para Windows** (janela flutuante, ~430 KB, atualiza sozinho):
  [MesaDeCartas.exe](https://github.com/harryChrist/poker-game/releases/latest/download/MesaDeCartas.exe)
  — também em https://cardgame.hchrist.com/desktop/MesaDeCartas.exe

O app desktop precisa do WebView2, que já vem no Windows 10/11.

## Como as atualizações chegam

| O que mudou | Como chega aos jogadores |
|---|---|
| Jogo, telas, regras, servidor | `git push` na `main` e depois `bash scripts/deploy.sh` na VPS (pull + build + restart) → navegador e app recarregam sozinhos na versão nova |
| O próprio `.exe` (janela, bandeja, atalhos) | Aumente a versão, `npm run build:exe`, commit + push → o servidor passa a oferecer o exe novo em `/desktop/version.json` (os apps se atualizam sozinhos) e a GitHub Action publica um Release |

## Desenvolvimento

```bash
npm install
npm run dev:server     # API + jogo em http://localhost:4080
npm run dev:client     # Vite em http://localhost:5173 (hot reload)
npm test
npm run build          # web app + servidor
npm run build:exe      # app desktop (Windows)
```

Galeria das telas de jogo sem servidor (dev): http://localhost:5173/?gallery=all

Mais detalhes: [HANDOFF.md](HANDOFF.md) (o que falta para pôr no ar) · [ARCHITECTURE.md](ARCHITECTURE.md) · [DEPLOY.md](DEPLOY.md) · [apps/desktop/README.md](apps/desktop/README.md)
