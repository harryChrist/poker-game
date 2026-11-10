# Mesa de Cartas - app desktop (Windows)

Janela flutuante minúscula (um único `.exe`, ~430 KB) que carrega a web app do servidor
(`https://cardgame.hchrist.com`) dentro de um WebView2. Todo update do jogo chega pelo servidor; só o
próprio `.exe` tem auto-update. Feito em C# (WinForms, .NET Framework 4.8 já presente no Windows) + WebView2 Runtime.

## Compilar

```
powershell -ExecutionPolicy Bypass -File apps/desktop/build.ps1
```

Usa o `csc.exe` do .NET Framework (sem SDK). Na 1ª vez baixa o pacote NuGet `Microsoft.Web.WebView2`
(versão fixa) para `apps/desktop/.deps`. Saída em `apps/desktop/release/`: `MesaDeCartas.exe` e `version.json`.
Opções: `-Version 1.0.1` (sobrescreve a versão de `src/AssemblyInfo.cs`) e `-OutDir <pasta>`.

## Rodar em desenvolvimento

```
apps\desktop\release\MesaDeCartas.exe --url=http://localhost:5173 --no-update
```

Argumentos: `--url=` (sobrescreve a URL; também dá para fixar `"url"` em `settings.json`), `--no-update`, `--devtools`.
Dados em `%LOCALAPPDATA%\MesaDeCartas` (`settings.json`, `log.txt`, `webview\`).

## Publicar uma atualização

1. Aumente `AssemblyVersion`/`AssemblyFileVersion` em `src/AssemblyInfo.cs` (ou passe `-Version`).
2. Rode o build.
3. Copie o conteúdo de `apps/desktop/release/` para o servidor; ele serve `/desktop/` a partir de
   `apps/desktop/release` (`/desktop/version.json` e `/desktop/MesaDeCartas.exe`).

Os apps abertos conferem `{url}/desktop/version.json` ao iniciar e a cada 6 h; se a versão for maior, baixam o exe,
validam o SHA-256, trocam o arquivo (o antigo vira `MesaDeCartas.exe.old`, apagado no próximo início) e reiniciam.

## Ponte `window.desktop`

Injetada só na origem configurada. Comandos (`window.chrome.webview.postMessage({id, cmd, args})`):
`minimize`, `hide`, `quit`, `getSettings`, `setAlwaysOnTop`, `setOpacity`, `setHotkey`, `startDrag` (reserva, não usado).
Eventos de configuração chegam como `{event:'settings', data}`.
