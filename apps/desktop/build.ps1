# Compila o Mesa de Cartas (WinForms + WebView2) em um unico MesaDeCartas.exe minusculo.
#   powershell -ExecutionPolicy Bypass -File apps/desktop/build.ps1 [-Version 1.0.1] [-OutDir <pasta>]
param(
    [string]$Version = '',
    [string]$OutDir = ''
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem

$WebView2Version = '1.0.3595.46'   # versao FIXA do pacote NuGet Microsoft.Web.WebView2

$root = $PSScriptRoot
$deps = Join-Path $root '.deps'
$obj = Join-Path $root 'obj'
if (-not $OutDir) { $OutDir = Join-Path $root 'release' }
New-Item -ItemType Directory -Force $deps, $obj, $OutDir | Out-Null

# --- 1. pacote NuGet (cache em .deps) -------------------------------------------------
$pkgDir = Join-Path $deps "Microsoft.Web.WebView2.$WebView2Version"
if (-not (Test-Path (Join-Path $pkgDir 'lib\net462\Microsoft.Web.WebView2.Core.dll'))) {
    $zip = Join-Path $deps "Microsoft.Web.WebView2.$WebView2Version.zip"
    if (-not (Test-Path $zip)) {
        Write-Host "Baixando Microsoft.Web.WebView2 $WebView2Version ..."
        Invoke-WebRequest -UseBasicParsing -Uri "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/$WebView2Version" -OutFile $zip
    }
    if (Test-Path $pkgDir) { Remove-Item -Recurse -Force $pkgDir }
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $pkgDir)
}
$core = Join-Path $pkgDir 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$wf = Join-Path $pkgDir 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$ldx64 = Join-Path $pkgDir 'runtimes\win-x64\native\WebView2Loader.dll'
$ldx86 = Join-Path $pkgDir 'runtimes\win-x86\native\WebView2Loader.dll'

# --- 2. icone (PNG dentro de ICO) -----------------------------------------------------
$ico = Join-Path $root 'app.ico'
if (-not (Test-Path $ico)) {
    $png = Join-Path $root '..\client\build\icon.png'
    $src = [Drawing.Image]::FromFile((Resolve-Path $png))
    $sizes = 16, 24, 32, 48, 64, 256
    $images = @()
    foreach ($s in $sizes) {
        $bmp = New-Object Drawing.Bitmap $s, $s, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = 'HighQualityBicubic'
        $g.SmoothingMode = 'HighQuality'
        $g.PixelOffsetMode = 'HighQuality'
        $g.DrawImage($src, 0, 0, $s, $s)
        $g.Dispose()
        $ms = New-Object IO.MemoryStream
        $bmp.Save($ms, [Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $images += , @{ Size = $s; Data = $ms.ToArray() }
    }
    $src.Dispose()
    $out = New-Object IO.MemoryStream
    $w = New-Object IO.BinaryWriter $out
    $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$images.Count)
    $offset = 6 + 16 * $images.Count
    foreach ($i in $images) {
        $dim = if ($i.Size -ge 256) { 0 } else { $i.Size }
        $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
        $w.Write([uint16]1); $w.Write([uint16]32)
        $w.Write([uint32]$i.Data.Length); $w.Write([uint32]$offset)
        $offset += $i.Data.Length
    }
    foreach ($i in $images) { $w.Write($i.Data) }
    $w.Flush()
    [IO.File]::WriteAllBytes($ico, $out.ToArray())
    Write-Host "Gerado $ico"
}

# --- 3. recursos comprimidos (gzip) -----------------------------------------------------
function GzipTo($from, $to) {
    $in = [IO.File]::ReadAllBytes($from)
    $fs = [IO.File]::Create($to)
    $gz = New-Object IO.Compression.GZipStream $fs, ([IO.Compression.CompressionLevel]::Optimal)
    $gz.Write($in, 0, $in.Length)
    $gz.Dispose(); $fs.Dispose()
}
GzipTo $core (Join-Path $obj 'core.dll.gz')
GzipTo $wf (Join-Path $obj 'winforms.dll.gz')
GzipTo $ldx64 (Join-Path $obj 'loader.x64.dll.gz')
GzipTo $ldx86 (Join-Path $obj 'loader.x86.dll.gz')

# --- 4. versao ------------------------------------------------------------------------
$infoSrc = Join-Path $root 'src\AssemblyInfo.cs'
$sources = @(Get-ChildItem (Join-Path $root 'src') -Filter *.cs | Where-Object { $_.Name -ne 'AssemblyInfo.cs' } | ForEach-Object { $_.FullName })
$text = Get-Content $infoSrc -Raw
if ($Version) {
    $text = [regex]::Replace($text, 'AssemblyVersion\("[^"]*"\)', "AssemblyVersion(`"$Version.0`")")
    $text = [regex]::Replace($text, 'AssemblyFileVersion\("[^"]*"\)', "AssemblyFileVersion(`"$Version`")")
}
$infoUsed = Join-Path $obj 'AssemblyInfo.cs'
[IO.File]::WriteAllText($infoUsed, $text, (New-Object Text.UTF8Encoding($false)))
$sources += $infoUsed
$ver = [regex]::Match($text, 'AssemblyFileVersion\("([^"]*)"\)').Groups[1].Value

# --- 5. compilacao ----------------------------------------------------------------------
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe nao encontrado: $csc" }
$exe = Join-Path $OutDir 'MesaDeCartas.exe'
if (Test-Path $exe) { Remove-Item -Force $exe }
$cscArgs = @(
    '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/debug-', '/utf8output',
    "/out:$exe", "/win32icon:$ico", "/win32manifest:$(Join-Path $root 'app.manifest')",
    '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll', '/r:System.Web.Extensions.dll',
    "/r:$core", "/r:$wf",
    "/resource:$(Join-Path $obj 'core.dll.gz'),core.dll.gz",
    "/resource:$(Join-Path $obj 'winforms.dll.gz'),winforms.dll.gz",
    "/resource:$(Join-Path $obj 'loader.x64.dll.gz'),loader.x64.dll.gz",
    "/resource:$(Join-Path $obj 'loader.x86.dll.gz'),loader.x86.dll.gz",
    "/resource:$ico,app.ico"
) + $sources
& $csc $cscArgs
if ($LASTEXITCODE -ne 0) { throw "Falha na compilacao (csc exit $LASTEXITCODE)" }

# --- 6. version.json --------------------------------------------------------------------
$sha = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
$vj = '{ "version": "' + $ver + '", "url": "/desktop/MesaDeCartas.exe", "sha256": "' + $sha + '" }'
[IO.File]::WriteAllText((Join-Path $OutDir 'version.json'), $vj, (New-Object Text.UTF8Encoding($false)))

$kb = [math]::Round((Get-Item $exe).Length / 1KB, 1)
Write-Host "OK: $exe  versao $ver  $kb KB  sha256 $sha"
