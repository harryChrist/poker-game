using System;
using System.IO;
using System.Web.Script.Serialization;

namespace MesaDeCartas
{
    public class BoundsData
    {
        public int x;
        public int y;
        public int width;
        public int height;
    }

    /// <summary>settings.json em %LOCALAPPDATA%\MesaDeCartas</summary>
    public class AppSettings
    {
        public BoundsData bounds;
        public bool alwaysOnTop = true;
        public double opacity = 1;
        public string hotkey = "CommandOrControl+Shift+Space";
        public string url;
        public bool trayHintShown;

        static string FilePath { get { return Path.Combine(Program.DataDir, "settings.json"); } }

        public static AppSettings Load()
        {
            AppSettings s = null;
            try
            {
                if (File.Exists(FilePath))
                    s = new JavaScriptSerializer().Deserialize<AppSettings>(File.ReadAllText(FilePath));
            }
            catch (Exception ex) { Log.Write("settings load: " + ex.Message); }
            if (s == null) s = new AppSettings();
            if (double.IsNaN(s.opacity)) s.opacity = 1;
            s.opacity = Math.Min(1, Math.Max(0.3, s.opacity));
            if (string.IsNullOrEmpty(s.hotkey)) s.hotkey = "CommandOrControl+Shift+Space";
            return s;
        }

        public void Save()
        {
            try
            {
                Directory.CreateDirectory(Program.DataDir);
                File.WriteAllText(FilePath, new JavaScriptSerializer().Serialize(this));
            }
            catch (Exception ex) { Log.Write("settings save: " + ex.Message); }
        }
    }
}
