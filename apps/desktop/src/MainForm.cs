using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MesaDeCartas
{
    class MainForm : Form
    {
        const int WM_HOTKEY = 0x0312, WM_NCHITTEST = 0x0084, WM_NCLBUTTONDOWN = 0x00A1;
        const int HTCLIENT = 1, HTCAPTION = 2, HTLEFT = 10, HTRIGHT = 11, HTTOP = 12, HTTOPLEFT = 13,
                  HTTOPRIGHT = 14, HTBOTTOM = 15, HTBOTTOMLEFT = 16, HTBOTTOMRIGHT = 17;
        const int HOTKEY_ID = 1;

        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);

        static readonly Color BgColor = Color.FromArgb(0x12, 0x16, 0x14);
        readonly JavaScriptSerializer json = new JavaScriptSerializer();

        readonly AppSettings settings;
        readonly string startUrl;   // URL efetiva (argumento > settings.json > padrao)
        readonly string origin;     // esquema + host + porta permitidos para a ponte
        readonly float scale;

        WebView2 web;
        NotifyIcon tray;
        ToolStripMenuItem miToggle, miTop;
        System.Windows.Forms.Timer saveTimer, retryTimer;
        System.Threading.Timer updateTimer;
        EventWaitHandle showEvent;

        bool quitting;
        bool showingOffline;
        string hotkeyError;
        bool hotkeyRegistered;

        public MainForm()
        {
            settings = AppSettings.Load();
            string u = Program.GetArg("--url=");
            if (string.IsNullOrEmpty(u)) u = settings.url;
            if (string.IsNullOrEmpty(u)) u = Program.DefaultUrl;
            startUrl = u.Trim();
            try { origin = new Uri(startUrl).GetLeftPart(UriPartial.Authority); }
            catch { startUrl = Program.DefaultUrl; origin = Program.DefaultUrl; }

            using (Graphics g = CreateGraphics()) scale = g.DpiX / 96f;

            Text = Program.AppName;
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            BackColor = BgColor;
            ShowInTaskbar = true;
            KeyPreview = false;
            MinimumSize = new Size(S(340), S(460));
            Padding = new Padding(S(6)); // margem para redimensionar pelas bordas (fora do WebView2)
            TopMost = settings.alwaysOnTop;
            Opacity = settings.opacity;
            Icon = LoadIcon(SystemInformation.IconSize);

            ApplyInitialBounds();

            web = new WebView2();
            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = BgColor;
            Controls.Add(web);

            CreateTray();

            saveTimer = new System.Windows.Forms.Timer();
            saveTimer.Interval = 500;
            saveTimer.Tick += delegate { saveTimer.Stop(); SaveBoundsNow(); };

            retryTimer = new System.Windows.Forms.Timer();
            retryTimer.Interval = 10000;
            retryTimer.Tick += delegate
            {
                if (showingOffline && web.CoreWebView2 != null) Navigate();
            };
            retryTimer.Start();

            StartSingleInstanceListener();
        }

        int S(int v) { return (int)Math.Round(v * scale); }

        Icon LoadIcon(Size size)
        {
            try
            {
                byte[] data = Program.ReadResource("app.ico");
                if (data != null) return new Icon(new MemoryStream(data), size);
            }
            catch (Exception ex) { Log.Write("icon: " + ex.Message); }
            return null;
        }

        /* ------------------------------------------------------------------ */
        /* Posicao e tamanho                                                   */
        /* ------------------------------------------------------------------ */

        void ApplyInitialBounds()
        {
            Rectangle wa = Screen.PrimaryScreen.WorkingArea;
            int w = S(420), h = S(640);
            BoundsData b = settings.bounds;
            if (b != null && b.width > 0 && b.height > 0)
            {
                w = Math.Max(S(340), b.width);
                h = Math.Max(S(460), b.height);
            }
            w = Math.Min(w, wa.Width);
            h = Math.Min(h, wa.Height);
            bool placed = false;
            int x = 0, y = 0;
            if (b != null && b.width > 0)
            {
                Rectangle r = new Rectangle(b.x, b.y, w, h);
                foreach (Screen s in Screen.AllScreens)
                {
                    Rectangle i = Rectangle.Intersect(r, s.WorkingArea);
                    if (i.Width >= 120 && i.Height >= 60) { placed = true; break; }
                }
                x = b.x;
                y = b.y;
            }
            if (!placed)
            {
                x = wa.X + (wa.Width - w) / 2;
                y = wa.Y + (wa.Height - h) / 2;
            }
            StartPosition = FormStartPosition.Manual;
            SetBounds(x, y, w, h);
        }

        void SaveBoundsNow()
        {
            if (!Visible || WindowState == FormWindowState.Minimized) return;
            Rectangle r = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            settings.bounds = new BoundsData { x = r.X, y = r.Y, width = r.Width, height = r.Height };
            settings.Save();
        }

        protected override void OnMove(EventArgs e)
        {
            base.OnMove(e);
            if (saveTimer != null && Visible) { saveTimer.Stop(); saveTimer.Start(); }
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (saveTimer != null && Visible) { saveTimer.Stop(); saveTimer.Start(); }
        }

        /// <summary>Janela sem borda: as bordas (Padding) devolvem HT* para redimensionar</summary>
        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == HOTKEY_ID)
            {
                ToggleWindow();
                return;
            }
            if (m.Msg == WM_NCHITTEST)
            {
                base.WndProc(ref m);
                if (WindowState == FormWindowState.Normal && m.Result.ToInt64() == HTCLIENT)
                {
                    long lp = m.LParam.ToInt64();
                    int sx = (short)(lp & 0xFFFF), sy = (short)((lp >> 16) & 0xFFFF);
                    Point p = PointToClient(new Point(sx, sy));
                    int b = S(6);
                    bool l = p.X < b, r = p.X >= ClientSize.Width - b, t = p.Y < b, bt = p.Y >= ClientSize.Height - b;
                    int hit = 0;
                    if (t && l) hit = HTTOPLEFT;
                    else if (t && r) hit = HTTOPRIGHT;
                    else if (bt && l) hit = HTBOTTOMLEFT;
                    else if (bt && r) hit = HTBOTTOMRIGHT;
                    else if (l) hit = HTLEFT;
                    else if (r) hit = HTRIGHT;
                    else if (t) hit = HTTOP;
                    else if (bt) hit = HTBOTTOM;
                    if (hit != 0) m.Result = (IntPtr)hit;
                }
                return;
            }
            base.WndProc(ref m);
        }

        /* ------------------------------------------------------------------ */
        /* Mostrar / esconder                                                  */
        /* ------------------------------------------------------------------ */

        bool IsShown { get { return Visible && WindowState != FormWindowState.Minimized; } }

        public void ShowWindow()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            if (!Visible) Show();
            bool t = settings.alwaysOnTop;
            TopMost = true;
            TopMost = t;
            Activate();
            SetForegroundWindow(Handle);
            RefreshTray();
        }

        public void HideWindow()
        {
            SaveBoundsNow();
            Hide();
            RefreshTray();
        }

        void ToggleWindow()
        {
            if (IsShown) HideWindow(); else ShowWindow();
        }

        /// <summary>Chamado quando uma segunda instancia pede para trazer esta para frente</summary>
        void StartSingleInstanceListener()
        {
            try
            {
                showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\MesaDeCartas.Show");
                Thread t = new Thread(delegate()
                {
                    while (true)
                    {
                        showEvent.WaitOne();
                        try
                        {
                            if (IsHandleCreated && !IsDisposed) BeginInvoke(new MethodInvoker(ShowWindow));
                        }
                        catch { }
                    }
                });
                t.IsBackground = true;
                t.Start();
            }
            catch (Exception ex) { Log.Write("showEvent: " + ex.Message); }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!quitting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                HideWindow();
                if (!settings.trayHintShown)
                {
                    settings.trayHintShown = true;
                    settings.Save();
                    tray.ShowBalloonTip(6000, Program.AppName,
                        "O app continua rodando na bandeja do sistema. Clique no ícone para mostrar de novo ou use o atalho global.",
                        ToolTipIcon.Info);
                }
                return;
            }
            base.OnFormClosing(e);
        }

        public void QuitApp()
        {
            if (quitting) return;
            quitting = true;
            SaveBoundsNow();
            try { if (hotkeyRegistered) Hotkey.UnregisterHotKey(Handle, HOTKEY_ID); } catch { }
            if (updateTimer != null) updateTimer.Dispose();
            tray.Visible = false;
            tray.Dispose();
            try { web.Dispose(); } catch { }
            Application.Exit();
        }

        /* ------------------------------------------------------------------ */
        /* Bandeja                                                             */
        /* ------------------------------------------------------------------ */

        void CreateTray()
        {
            tray = new NotifyIcon();
            tray.Text = Program.AppName;
            Icon ic = LoadIcon(SystemInformation.SmallIconSize);
            tray.Icon = ic ?? SystemIcons.Application;

            ContextMenuStrip menu = new ContextMenuStrip();
            miToggle = new ToolStripMenuItem("Esconder");
            miToggle.Click += delegate { ToggleWindow(); };
            miTop = new ToolStripMenuItem("Sempre no topo");
            miTop.Click += delegate { SetAlwaysOnTop(!settings.alwaysOnTop); };
            ToolStripMenuItem miQuit = new ToolStripMenuItem("Sair");
            miQuit.Click += delegate { QuitApp(); };
            menu.Items.Add(miToggle);
            menu.Items.Add(miTop);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(miQuit);
            menu.Opening += delegate { RefreshTray(); };
            tray.ContextMenuStrip = menu;
            tray.MouseClick += delegate(object s, MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Left) ToggleWindow();
            };
            tray.Visible = true;
            RefreshTray();
        }

        void RefreshTray()
        {
            if (miToggle == null) return;
            miToggle.Text = IsShown ? "Esconder" : "Mostrar";
            miTop.Checked = settings.alwaysOnTop;
        }

        /* ------------------------------------------------------------------ */
        /* Configuracoes (ponte window.desktop)                                */
        /* ------------------------------------------------------------------ */

        Dictionary<string, object> PublicSettings()
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["alwaysOnTop"] = settings.alwaysOnTop;
            d["opacity"] = settings.opacity;
            d["hotkey"] = settings.hotkey;
            d["hotkeyError"] = hotkeyError;
            return d;
        }

        void Broadcast()
        {
            RefreshTray();
            Dictionary<string, object> msg = new Dictionary<string, object>();
            msg["event"] = "settings";
            msg["data"] = PublicSettings();
            PostToPage(msg);
        }

        void PostToPage(object msg)
        {
            try
            {
                if (web != null && web.CoreWebView2 != null && !showingOffline)
                    web.CoreWebView2.PostWebMessageAsJson(json.Serialize(msg));
            }
            catch (Exception ex) { Log.Write("post: " + ex.Message); }
        }

        void SetAlwaysOnTop(bool v)
        {
            settings.alwaysOnTop = v;
            TopMost = v;
            settings.Save();
            Broadcast();
        }

        void SetOpacity(double v)
        {
            if (double.IsNaN(v) || double.IsInfinity(v)) v = 1;
            settings.opacity = Math.Min(1, Math.Max(0.3, v));
            Opacity = settings.opacity;
            settings.Save();
            Broadcast();
        }

        /* ---- atalho global ---- */

        string TryRegister(string accel)
        {
            uint mods, vk;
            if (!Hotkey.TryParse(accel, out mods, out vk)) return "Atalho inválido.";
            if (!Hotkey.RegisterHotKey(Handle, HOTKEY_ID, mods | Hotkey.MOD_NOREPEAT, vk))
                return "Não foi possível registrar o atalho (talvez já esteja em uso por outro programa).";
            hotkeyRegistered = true;
            return null;
        }

        void Unregister()
        {
            if (hotkeyRegistered) Hotkey.UnregisterHotKey(Handle, HOTKEY_ID);
            hotkeyRegistered = false;
        }

        Dictionary<string, object> ApplyHotkey(string accel)
        {
            string previous = settings.hotkey;
            bool previousWorked = hotkeyError == null;
            Unregister();
            string err = TryRegister(accel);
            Dictionary<string, object> res = new Dictionary<string, object>();
            if (err != null)
            {
                if (previousWorked) TryRegister(previous);
                res["ok"] = false;
                res["error"] = err;
                return res;
            }
            settings.hotkey = accel;
            hotkeyError = null;
            settings.Save();
            Broadcast();
            res["ok"] = true;
            return res;
        }

        void RegisterInitialHotkey()
        {
            string err = TryRegister(settings.hotkey);
            if (err != null)
            {
                hotkeyError = err;
                tray.ShowBalloonTip(6000, Program.AppName,
                    "O atalho global " + settings.hotkey.Replace("CommandOrControl", "Ctrl") +
                    " não pôde ser registrado. Escolha outro em Configurações.", ToolTipIcon.Warning);
            }
            Log.Write("hotkey " + settings.hotkey + ": " + (err ?? "ok"));
        }

        /* ------------------------------------------------------------------ */
        /* WebView2                                                            */
        /* ------------------------------------------------------------------ */

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            RegisterInitialHotkey();
            InitWebView();
            // auto-update: ao abrir (apos alguns segundos) e a cada 6 h
            updateTimer = new System.Threading.Timer(delegate { UpdateTick(); }, null, 8000, 6 * 60 * 60 * 1000);
        }

        async void InitWebView()
        {
            try
            {
                CoreWebView2Environment.SetLoaderDllFolderPath(Program.ExtractLoader());
                string userData = Path.Combine(Program.DataDir, "webview");
                CoreWebView2Environment env = await CoreWebView2Environment.CreateAsync(null, userData, null);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception ex)
            {
                Log.Write("webview init: " + ex);
                MessageBox.Show(this,
                    "Não foi possível iniciar o WebView2 Runtime.\n\nInstale em https://go.microsoft.com/fwlink/p/?LinkId=2124703 e abra o app de novo.\n\n" + ex.Message,
                    Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                QuitApp();
                return;
            }

            CoreWebView2 core = web.CoreWebView2;
            CoreWebView2Settings st = core.Settings;
            st.IsNonClientRegionSupportEnabled = true; // -webkit-app-region: drag
            st.AreDefaultContextMenusEnabled = false;
            st.IsStatusBarEnabled = false;
            st.IsZoomControlEnabled = false;
            st.IsPasswordAutosaveEnabled = false;
            st.IsGeneralAutofillEnabled = false;
            st.IsBuiltInErrorPageEnabled = false;
            bool dev = Program.HasArg("--devtools");
            st.AreDevToolsEnabled = dev;

            string script = BridgeScript.Replace("__ORIGIN__", json.Serialize(origin));
            await core.AddScriptToExecuteOnDocumentCreatedAsync(script);

            core.WebMessageReceived += OnWebMessage;
            core.NavigationStarting += OnNavigationStarting;
            core.NavigationCompleted += OnNavigationCompleted;
            core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs a)
            {
                a.Handled = true;
                OpenExternal(a.Uri);
            };
            core.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs a)
            {
                a.State = CoreWebView2PermissionState.Deny;
            };
            core.ProcessFailed += delegate(object s, CoreWebView2ProcessFailedEventArgs a)
            {
                Log.Write("webview process failed: " + a.ProcessFailedKind);
                if (a.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited ||
                    a.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
                    BeginInvoke(new MethodInvoker(Navigate));
            };

            Log.Write("webview pronto; url=" + startUrl + " origin=" + origin);
            Navigate();
        }

        void Navigate()
        {
            try { web.CoreWebView2.Navigate(startUrl); }
            catch (Exception ex) { Log.Write("navigate: " + ex.Message); }
        }

        bool SameOrigin(string url)
        {
            try
            {
                return string.Equals(new Uri(url).GetLeftPart(UriPartial.Authority), origin, StringComparison.OrdinalIgnoreCase);
            }
            catch { return false; }
        }

        void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            string uri = e.Uri ?? "";
            if (uri.StartsWith("app://", StringComparison.OrdinalIgnoreCase))
            {
                e.Cancel = true;
                string cmd = uri.Substring(6).Trim('/');
                if (cmd == "hide") HideWindow();
                else if (cmd == "minimize") WindowState = FormWindowState.Minimized;
                else if (cmd == "quit") QuitApp();
                return;
            }
            if (uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
                return;
            if (e.IsRedirected || SameOrigin(uri))
            {
                showingOffline = false;
                return;
            }
            // nunca navega para fora do app: abre no navegador padrao
            e.Cancel = true;
            OpenExternal(uri);
        }

        void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (showingOffline) return;
            bool failed = !e.IsSuccess && e.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled;
            int code = 0;
            try { code = e.HttpStatusCode; } catch { }
            if (e.IsSuccess && code >= 500) failed = true;
            Log.Write("navegacao: ok=" + e.IsSuccess + " erro=" + e.WebErrorStatus + " http=" + code);
            if (failed) ShowOffline();
        }

        void ShowOffline()
        {
            showingOffline = true;
            string url = WebUtility.HtmlEncode(startUrl);
            string html = OfflineHtml.Replace("__URL__", url);
            try { web.CoreWebView2.NavigateToString(html); }
            catch (Exception ex) { Log.Write("offline page: " + ex.Message); }
        }

        static void OpenExternal(string url)
        {
            try
            {
                Uri u = new Uri(url);
                if (u.Scheme == Uri.UriSchemeHttp || u.Scheme == Uri.UriSchemeHttps)
                    Process.Start(new ProcessStartInfo(u.ToString()) { UseShellExecute = true });
            }
            catch (Exception ex) { Log.Write("openExternal: " + ex.Message); }
        }

        /* ---- mensagens da pagina ---- */

        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                if (!SameOrigin(e.Source)) { Log.Write("bridge: origem recusada " + e.Source); return; }
                Dictionary<string, object> msg = json.DeserializeObject(e.WebMessageAsJson) as Dictionary<string, object>;
                if (msg == null || !msg.ContainsKey("cmd")) return;
                string cmd = Convert.ToString(msg["cmd"]);
                int id = msg.ContainsKey("id") ? Convert.ToInt32(msg["id"]) : 0;
                List<object> args = new List<object>();
                if (msg.ContainsKey("args") && msg["args"] is IEnumerable)
                    foreach (object o in (IEnumerable)msg["args"]) args.Add(o);
                Log.Write("bridge: " + cmd + (args.Count > 0 ? " " + Convert.ToString(args[0]) : ""));

                object result = null;
                string error = null;
                switch (cmd)
                {
                    case "minimize": WindowState = FormWindowState.Minimized; break;
                    case "hide": HideWindow(); break;
                    case "quit": QuitApp(); return;
                    case "getSettings": result = PublicSettings(); break;
                    case "setAlwaysOnTop":
                        SetAlwaysOnTop(args.Count > 0 && args[0] is bool && (bool)args[0]);
                        break;
                    case "setOpacity":
                        SetOpacity(args.Count > 0 && args[0] != null ? Convert.ToDouble(args[0]) : 1);
                        break;
                    case "setHotkey":
                        {
                            string a = args.Count > 0 ? Convert.ToString(args[0]) : null;
                            if (string.IsNullOrWhiteSpace(a))
                            {
                                Dictionary<string, object> r = new Dictionary<string, object>();
                                r["ok"] = false;
                                r["error"] = "Atalho vazio.";
                                result = r;
                            }
                            else result = ApplyHotkey(a.Trim());
                            break;
                        }
                    case "startDrag":
                        ReleaseCapture();
                        SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
                        break;
                    default: error = "comando desconhecido: " + cmd; break;
                }

                if (id > 0)
                {
                    Dictionary<string, object> reply = new Dictionary<string, object>();
                    reply["id"] = id;
                    if (error != null) reply["error"] = error; else reply["result"] = result;
                    PostToPage(reply);
                }
            }
            catch (Exception ex) { Log.Write("bridge erro: " + ex.Message); }
        }

        /* ------------------------------------------------------------------ */
        /* Auto-update                                                         */
        /* ------------------------------------------------------------------ */

        void UpdateTick()
        {
            if (Program.HasArg("--no-update")) return;
            if (Updater.CheckAndApply(startUrl))
            {
                // Logo ao abrir (ninguém está jogando ainda): reinicia já na versão nova.
                // Depois disso (pode estar no meio de uma partida): o exe novo já está no lugar e vale na próxima abertura.
                bool justOpened = (DateTime.Now - Process.GetCurrentProcess().StartTime).TotalSeconds < 45;
                if (justOpened)
                {
                    try { BeginInvoke(new MethodInvoker(RestartAfterUpdate)); } catch { }
                }
                else
                {
                    try
                    {
                        BeginInvoke(new MethodInvoker(delegate
                        {
                            try { tray.ShowBalloonTip(5000, Program.AppName, "Atualização instalada. Ela vale na próxima vez que você abrir o app.", ToolTipIcon.Info); } catch { }
                        }));
                    }
                    catch { }
                }
            }
        }

        void RestartAfterUpdate()
        {
            try { tray.ShowBalloonTip(3000, Program.AppName, "Atualizado, reiniciando", ToolTipIcon.Info); } catch { }
            System.Windows.Forms.Timer t = new System.Windows.Forms.Timer();
            t.Interval = 1500;
            t.Tick += delegate
            {
                t.Stop();
                try
                {
                    StringBuilder sb = new StringBuilder("--restarted");
                    foreach (string a in Program.Args)
                        if (!string.Equals(a, "--restarted", StringComparison.OrdinalIgnoreCase))
                            sb.Append(" \"").Append(a.Replace("\"", "\\\"")).Append("\"");
                    Log.Write("reiniciando apos update");
                    Process.Start(new ProcessStartInfo(Program.ExePath, sb.ToString()) { UseShellExecute = false });
                }
                catch (Exception ex) { Log.Write("restart: " + ex.Message); }
                QuitApp();
            };
            t.Start();
        }

        /* ------------------------------------------------------------------ */
        /* Textos / scripts embutidos                                          */
        /* ------------------------------------------------------------------ */

        const string BridgeScript = @"(function () {
  try {
    if (window.top !== window) return;
    if (location.origin !== __ORIGIN__) return;
    var wv = window.chrome && window.chrome.webview;
    if (!wv || window.desktop) return;
    var seq = 0, pending = {}, subs = [];
    wv.addEventListener('message', function (e) {
      var m = e.data;
      if (!m || typeof m !== 'object') return;
      if (m.event === 'settings') {
        subs.slice().forEach(function (f) { try { f(m.data); } catch (_) {} });
        return;
      }
      var p = pending[m.id];
      if (!p) return;
      delete pending[m.id];
      if (m.error) p.rej(new Error(m.error)); else p.res(m.result);
    });
    function call(cmd, args) {
      return new Promise(function (res, rej) {
        var id = ++seq;
        pending[id] = { res: res, rej: rej };
        wv.postMessage({ id: id, cmd: cmd, args: args || [] });
      });
    }
    function fire(cmd) { wv.postMessage({ id: 0, cmd: cmd, args: [] }); }
    window.desktop = Object.freeze({
      minimize: function () { fire('minimize'); },
      hide: function () { fire('hide'); },
      quit: function () { fire('quit'); },
      getSettings: function () { return call('getSettings'); },
      setAlwaysOnTop: function (v) { return call('setAlwaysOnTop', [!!v]); },
      setOpacity: function (v) { return call('setOpacity', [Number(v)]); },
      setHotkey: function (a) { return call('setHotkey', [String(a)]); },
      onSettingsChanged: function (cb) {
        subs.push(cb);
        return function () { var i = subs.indexOf(cb); if (i >= 0) subs.splice(i, 1); };
      }
    });
  } catch (_) {}
})();";

        const string OfflineHtml = @"<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><title>Mesa de Cartas</title>
<style>
html,body{margin:0;height:100%;background:#121614;color:#e8efe9;font:15px 'Segoe UI',sans-serif;overflow:hidden}
.bar{height:34px;display:flex;align-items:center;justify-content:flex-end;-webkit-app-region:drag;background:#0c0f0d}
.bar a{-webkit-app-region:no-drag;color:#9fb0a5;text-decoration:none;width:40px;height:34px;line-height:34px;text-align:center;font-size:16px}
.bar a:hover{background:#1f2823;color:#fff}
.box{display:flex;flex-direction:column;align-items:center;justify-content:center;height:calc(100% - 34px);text-align:center;padding:0 24px}
h1{font-size:20px;margin:0 0 8px}p{color:#9fb0a5;margin:0 0 20px;line-height:1.4}
button{background:#2f9e62;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-size:15px;cursor:pointer}
button:hover{background:#38b16f}small{display:block;margin-top:16px;color:#6c7d72}
</style></head><body>
<div class='bar'><a href='app://minimize' title='Minimizar'>&#8211;</a><a href='app://hide' title='Esconder na bandeja'>&#10005;</a></div>
<div class='box'><h1>&#9824; Sem conex&atilde;o</h1>
<p>N&atilde;o foi poss&iacute;vel carregar a Mesa de Cartas.<br>Verifique sua internet ou se o servidor est&aacute; no ar.</p>
<button onclick=""location.href='__URL__'"">Tentar de novo</button>
<small>Tentando novamente automaticamente a cada 10 segundos...</small></div>
</body></html>";
    }
}
