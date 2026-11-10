// pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'mesa-de-cartas',
      cwd: __dirname,
      script: 'apps/server/dist/server.mjs',
      node_args: `--env-file-if-exists=${__dirname}/.env`, // caminho absoluto: o pm2 não inicia o node na pasta do projeto
      instances: 1, // estado das salas fica em memória: NÃO usar cluster
      autorestart: true,
      max_memory_restart: '500M',
      kill_timeout: 10000, // tempo para devolver as fichas das mesas ao desligar
      treekill: false, // não matar o script de deploy (filho do servidor) ao recarregar
      time: true,
    },
  ],
};
