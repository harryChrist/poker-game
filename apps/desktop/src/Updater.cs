using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace MesaDeCartas
{
    /// <summary>Auto-update do proprio .exe via {url}/desktop/version.json</summary>
    static class Updater
    {
        static int busy;

        static byte[] Get(string url, int timeoutMs)
        {
            HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
            req.Timeout = timeoutMs;
            req.ReadWriteTimeout = timeoutMs;
            req.UserAgent = "MesaDeCartas/" + typeof(Updater).Assembly.GetName().Version;
            req.CachePolicy = new System.Net.Cache.RequestCachePolicy(System.Net.Cache.RequestCacheLevel.NoCacheNoStore);
            using (WebResponse resp = req.GetResponse())
            using (Stream s = resp.GetResponseStream())
            using (MemoryStream ms = new MemoryStream())
            {
                s.CopyTo(ms);
                return ms.ToArray();
            }
        }

        /// <summary>Roda em thread de segundo plano. Devolve true se o exe foi trocado (reiniciar).</summary>
        public static bool CheckAndApply(string baseUrl)
        {
            if (System.Threading.Interlocked.Exchange(ref busy, 1) == 1) return false;
            string tmp = null;
            try
            {
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)(3072 | 12288 | 768);
                Uri baseUri = new Uri(baseUrl.TrimEnd('/') + "/");
                Uri verUri = new Uri(baseUri, "desktop/version.json");
                string json = Encoding.UTF8.GetString(Get(verUri.ToString(), 15000));
                Dictionary<string, object> info = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                string verStr = info.ContainsKey("version") ? Convert.ToString(info["version"]) : null;
                string urlStr = info.ContainsKey("url") ? Convert.ToString(info["url"]) : null;
                string sha = info.ContainsKey("sha256") ? Convert.ToString(info["sha256"]) : null;
                if (string.IsNullOrEmpty(verStr) || string.IsNullOrEmpty(urlStr) || string.IsNullOrEmpty(sha)) return false;

                Version remote = new Version(verStr);
                Version local = typeof(Updater).Assembly.GetName().Version;
                if (remote <= local)
                {
                    Log.Write("update: nenhuma versao nova (local " + local + ", servidor " + remote + ")");
                    return false;
                }
                Log.Write("update: nova versao " + remote + " (local " + local + ")");

                Uri exeUri = new Uri(baseUri, urlStr);
                if (!string.Equals(exeUri.Host, baseUri.Host, StringComparison.OrdinalIgnoreCase))
                {
                    Log.Write("update: host do download diferente, ignorado");
                    return false;
                }
                byte[] data = Get(exeUri.ToString(), 120000);
                string hash = BitConverter.ToString(SHA256.Create().ComputeHash(data)).Replace("-", "");
                if (!string.Equals(hash, sha.Trim(), StringComparison.OrdinalIgnoreCase))
                {
                    Log.Write("update: sha256 invalido (" + hash + " != " + sha + ")");
                    return false;
                }
                tmp = Path.Combine(Path.GetTempPath(), "MesaDeCartas-" + remote + "-" + Guid.NewGuid().ToString("N").Substring(0, 6) + ".exe");
                File.WriteAllBytes(tmp, data);

                string exe = Program.ExePath;
                string old = exe + ".old";
                try { if (File.Exists(old)) File.Delete(old); } catch { }
                File.Move(exe, old); // o Windows permite renomear um exe em execucao
                try
                {
                    File.Move(tmp, exe);
                }
                catch (Exception ex)
                {
                    Log.Write("update: falha ao colocar novo exe, revertendo: " + ex.Message);
                    try { File.Move(old, exe); } catch { }
                    throw;
                }
                tmp = null;
                Log.Write("update: exe substituido por " + remote);
                return true;
            }
            catch (Exception ex)
            {
                Log.Write("update: " + ex.Message);
                return false;
            }
            finally
            {
                if (tmp != null) { try { File.Delete(tmp); } catch { } }
                System.Threading.Interlocked.Exchange(ref busy, 0);
            }
        }
    }
}
