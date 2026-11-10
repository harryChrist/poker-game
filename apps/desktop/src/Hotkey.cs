using System;
using System.Runtime.InteropServices;

namespace MesaDeCartas
{
    /// <summary>Converte aceleradores no estilo Electron para RegisterHotKey</summary>
    static class Hotkey
    {
        public const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_WIN = 8, MOD_NOREPEAT = 0x4000;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        public static bool TryParse(string accel, out uint mods, out uint vk)
        {
            mods = 0;
            vk = 0;
            if (string.IsNullOrEmpty(accel)) return false;
            string[] parts = accel.Split('+');
            bool haveKey = false;
            for (int i = 0; i < parts.Length; i++)
            {
                string p = parts[i].Trim();
                if (p.Length == 0) return false;
                string l = p.ToLowerInvariant();
                switch (l)
                {
                    case "commandorcontrol": case "cmdorctrl": case "control": case "ctrl": case "command": case "cmd":
                        mods |= MOD_CONTROL; continue;
                    case "alt": case "option":
                        mods |= MOD_ALT; continue;
                    case "shift":
                        mods |= MOD_SHIFT; continue;
                    case "super": case "meta": case "win": case "windows":
                        mods |= MOD_WIN; continue;
                }
                if (haveKey) return false;
                uint k = KeyCode(p, l);
                if (k == 0) return false;
                vk = k;
                haveKey = true;
            }
            return haveKey;
        }

        static uint KeyCode(string p, string l)
        {
            if (p.Length == 1)
            {
                char c = char.ToUpperInvariant(p[0]);
                if (c >= 'A' && c <= 'Z') return c;
                if (c >= '0' && c <= '9') return c;
                switch (c)
                {
                    case '-': return 0xBD;
                    case '=': return 0xBB;
                    case ',': return 0xBC;
                    case '.': return 0xBE;
                    case '/': return 0xBF;
                    case '`': return 0xC0;
                    case ';': return 0xBA;
                    case '[': return 0xDB;
                    case ']': return 0xDD;
                    case '\\': return 0xDC;
                }
                return 0;
            }
            if (l.Length >= 2 && l[0] == 'f')
            {
                int n;
                if (int.TryParse(l.Substring(1), out n) && n >= 1 && n <= 24) return (uint)(0x70 + n - 1);
            }
            switch (l)
            {
                case "space": return 0x20;
                case "enter": case "return": return 0x0D;
                case "tab": return 0x09;
                case "backspace": return 0x08;
                case "delete": case "del": return 0x2E;
                case "insert": case "ins": return 0x2D;
                case "home": return 0x24;
                case "end": return 0x23;
                case "pageup": return 0x21;
                case "pagedown": return 0x22;
                case "up": return 0x26;
                case "down": return 0x28;
                case "left": return 0x25;
                case "right": return 0x27;
                case "escape": case "esc": return 0x1B;
                case "plus": return 0xBB;
            }
            return 0;
        }
    }
}
