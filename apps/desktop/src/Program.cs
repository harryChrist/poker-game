using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Windows.Forms;

namespace MesaDeCartas
{
    static class Program
    {
        public const string AppName = "Mesa de Cartas";
        public const string DefaultUrl = "https://cardgame.hchrist.com";

        public static string ExePath;
        public static string DataDir;
        public static string[] Args;

        [STAThread]
        static int Main(string[] args)
        {
            Args = args;
            ExePath = Application.ExecutablePath;
            DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MesaDeCartas");
            try { Directory.CreateDirectory(DataDir); } catch { }

            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbedded;
            AppDomain.CurrentDomain.UnhandledException += delegate(object s, UnhandledExceptionEventArgs e)
            {
                Log.Write("UnhandledException: " + e.ExceptionObject);
            };
            return Run();
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        static int Run()
        {
            bool restarted = HasArg("--restarted");
            bool created;
            Mutex mutex = new Mutex(true, "Local\\MesaDeCartas.Instance", out created);
            if (!created)
            {
                // Depois de uma atualizacao a instancia antiga ainda esta saindo: espera um pouco
                bool got = false;
                if (restarted)
                {
                    try { got = mutex.WaitOne(10000); }
                    catch (AbandonedMutexException) { got = true; }
                }
                if (!got)
                {
                    try
                    {
                        EventWaitHandle.OpenExisting("Local\\MesaDeCartas.Show").Set();
                    }
                    catch { }
                    return 0;
                }
            }

            CleanupOld();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
            GC.KeepAlive(mutex);
            return 0;
        }

        public static bool HasArg(string name)
        {
            foreach (string a in Args)
                if (string.Equals(a, name, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        public static string GetArg(string prefix)
        {
            foreach (string a in Args)
                if (a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return a.Substring(prefix.Length);
            return null;
        }

        /// <summary>Apaga o MesaDeCartas.exe.old deixado por uma atualizacao anterior</summary>
        static void CleanupOld()
        {
            try
            {
                string old = ExePath + ".old";
                if (File.Exists(old)) File.Delete(old);
            }
            catch (Exception ex) { Log.Write("cleanup: " + ex.Message); }
        }

        /* ---------------- recursos embutidos ---------------- */

        public static byte[] ReadResource(string name)
        {
            Assembly asm = typeof(Program).Assembly;
            using (Stream s = asm.GetManifestResourceStream(name))
            {
                if (s == null) return null;
                using (MemoryStream ms = new MemoryStream())
                {
                    if (name.EndsWith(".gz"))
                    {
                        using (GZipStream gz = new GZipStream(s, CompressionMode.Decompress)) gz.CopyTo(ms);
                    }
                    else s.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }

        static Assembly ResolveEmbedded(object sender, ResolveEventArgs args)
        {
            string n = new AssemblyName(args.Name).Name;
            string res = null;
            if (n == "Microsoft.Web.WebView2.Core") res = "core.dll.gz";
            else if (n == "Microsoft.Web.WebView2.WinForms") res = "winforms.dll.gz";
            if (res == null) return null;
            byte[] data = ReadResource(res);
            return data == null ? null : Assembly.Load(data);
        }

        /// <summary>Extrai o WebView2Loader.dll nativo e devolve a pasta onde ele esta</summary>
        public static string ExtractLoader()
        {
            string ver = typeof(Program).Assembly.GetName().Version.ToString();
            string dir = Path.Combine(DataDir, "bin", ver);
            Directory.CreateDirectory(dir);
            string file = Path.Combine(dir, "WebView2Loader.dll");
            byte[] data = ReadResource(Environment.Is64BitProcess ? "loader.x64.dll.gz" : "loader.x86.dll.gz");
            if (data == null) throw new InvalidOperationException("WebView2Loader embutido ausente");
            if (!File.Exists(file) || new FileInfo(file).Length != data.Length)
            {
                try { File.WriteAllBytes(file, data); }
                catch (IOException) { if (!File.Exists(file)) throw; }
            }
            // limpa pastas de versoes antigas
            try
            {
                foreach (string d in Directory.GetDirectories(Path.Combine(DataDir, "bin")))
                    if (!string.Equals(Path.GetFileName(d), ver, StringComparison.OrdinalIgnoreCase))
                        try { Directory.Delete(d, true); } catch { }
            }
            catch { }
            return dir;
        }
    }

    static class Log
    {
        static readonly object Lock = new object();

        public static void Write(string msg)
        {
            try
            {
                lock (Lock)
                {
                    string file = Path.Combine(Program.DataDir, "log.txt");
                    try
                    {
                        FileInfo fi = new FileInfo(file);
                        if (fi.Exists && fi.Length > 256 * 1024) File.Delete(file);
                    }
                    catch { }
                    File.AppendAllText(file, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + msg + Environment.NewLine);
                }
            }
            catch { }
        }
    }
}
