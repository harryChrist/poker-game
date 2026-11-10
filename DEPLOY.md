# Deploy — cardgame.hchrist.com

Um único processo Node (porta **4080**) serve tudo:

| Caminho | O quê |
|---|---|
| `/` | O jogo no navegador (build de `apps/client`) |
| `/socket.io/` | API em tempo real (Socket.IO / WebSocket) |
| `/health` | Status |
| `/desktop/` | App desktop (`MesaDeCartas.exe`) + `version.json` do auto-update (pasta `apps/desktop/release`) |

O banco é **SQLite local** (`data/cartas.db`, criado sozinho) via `node:sqlite` embutido. Requisito: **Node 22.13+** (recomendado 24+).

## Desenvolvimento local

```bash
npm install
npm run dev:server     # http://localhost:4080 (API)
npm run dev:client     # Vite em http://localhost:5173 (aponta para a 4080)
```

Para testar como em produção: `npm run build && npm run start:server` e abra http://localhost:4080.

## VPS com pm2

```bash
git clone <repo> mesa-de-cartas && cd mesa-de-cartas
npm install
cp .env.example .env          # PORT=4080
npm run build                 # build do jogo web + bundle do servidor
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save && pm2 startup
curl http://localhost:4080/health
```

- Atualizar: `git pull && npm install && npm run build && pm2 restart mesa-de-cartas`.
  O jogo (navegador **e** app desktop, que carrega o site) recebe a versão nova na hora.
- Logs: `pm2 logs mesa-de-cartas` · Backup: pasta `data/`.
- **Uma instância só** (as salas ficam em memória). Ao reiniciar, as fichas em mesa voltam para as carteiras.
- O **primeiro usuário registrado vira admin**; `ADMIN_USERNAMES=fulano` no `.env` promove outros.

## Domínio e HTTPS

DNS: registro `A` de `cardgame.hchrist.com` → IP da VPS. Libere 80/443 e deixe a 4080 fechada no firewall (só o proxy acessa).

**Caddy** (`/etc/caddy/Caddyfile`, certificado automático):

```
cardgame.hchrist.com {
    reverse_proxy 127.0.0.1:4080
}
```

**ou Nginx** (com certbot para o HTTPS):

```nginx
server {
    server_name cardgame.hchrist.com;
    location / {
        proxy_pass http://127.0.0.1:4080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
    }
}
```

`sudo certbot --nginx -d cardgame.hchrist.com`

## Atualização automática (push no GitHub → servidor atualizado)

1. Na VPS, o repositório precisa conseguir dar `git fetch` sem senha. Repo público: nada a fazer.
   Repo privado: crie uma deploy key (`ssh-keygen -t ed25519 -f ~/.ssh/poker_deploy -N ""`), adicione a chave pública em
   GitHub → Settings → Deploy keys (só leitura) e use o remote SSH `git@github.com:harryChrist/poker-game.git`.
2. Gere um segredo e coloque no `.env` da VPS:
   ```bash
   echo "DEPLOY_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env && pm2 restart mesa-de-cartas --update-env
   ```
3. GitHub → repositório → Settings → Webhooks → Add webhook:
   - Payload URL: `https://cardgame.hchrist.com/api/deploy/github`
   - Content type: `application/json`
   - Secret: o mesmo valor de `DEPLOY_WEBHOOK_SECRET`
   - Evento: "Just the push event"

A cada push na `main`, o servidor roda `scripts/deploy.sh` (git reset para `origin/main`, `npm install`, `npm run build`,
`pm2 reload`). Log em `data/deploy.log`. Ao reconectar, navegador e app comparam a versão e **recarregam sozinhos**.
Dá para rodar à mão também: `bash scripts/deploy.sh`.

> Cuidado: o deploy faz `git reset --hard`, então não edite arquivos versionados direto na VPS (o `.env` e a pasta `data/` não são afetados).
> O restart encerra as mesas abertas (as fichas voltam para as carteiras).

## App desktop (auto-update)

O `.exe` é só a janela flutuante (bandeja, atalho, sempre no topo, opacidade) que abre `https://cardgame.hchrist.com`.
Para publicar uma versão nova do `.exe`: aumente a versão em `apps/desktop`, rode o build (ver `apps/desktop/README.md`)
e envie `apps/desktop/release/` para o servidor (mesma pasta no repo). Os apps instalados verificam `/desktop/version.json`
ao abrir e a cada 6 h e se atualizam sozinhos.

Link de download para os amigos: `https://cardgame.hchrist.com/desktop/MesaDeCartas.exe`
