param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [string]$ComboSource,
  [string]$PokeSource,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

foreach ($tool in @("ffmpeg", "ffprobe")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool was not found in PATH."
  }
}

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$effectsRoot = (Resolve-Path -LiteralPath (Join-Path $ProjectRoot "assets\effects")).Path
$audioRoot = (Resolve-Path -LiteralPath (Join-Path $ProjectRoot "assets\audio")).Path

if (-not $ComboSource -and -not $PokeSource) {
  throw "Provide at least one effect source."
}

foreach ($source in @($ComboSource, $PokeSource) | Where-Object { $_ }) {
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Source file not found: $source"
  }
}

$code = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class FightTurnEffectGreenKeyer {
  public static void ProcessDirectory(string inputDir, string outputDir) {
    Directory.CreateDirectory(outputDir);
    foreach (string input in Directory.GetFiles(inputDir, "*.png")) {
      Process(input, Path.Combine(outputDir, Path.GetFileName(input)));
    }
  }

  private static void Process(string input, string output) {
    using (var src = new Bitmap(input))
    using (var bmp = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb)) {
      using (var graphics = Graphics.FromImage(bmp)) {
        graphics.DrawImage(src, 0, 0, src.Width, src.Height);
      }

      var rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
      var data = bmp.LockBits(rect, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
      int length = Math.Abs(data.Stride) * bmp.Height;
      byte[] pixels = new byte[length];
      Marshal.Copy(data.Scan0, pixels, 0, length);

      for (int y = 0; y < bmp.Height; y++) {
        int row = y * data.Stride;
        for (int x = 0; x < bmp.Width; x++) {
          int i = row + x * 4;
          int b = pixels[i];
          int g = pixels[i + 1];
          int r = pixels[i + 2];
          int maxRb = Math.Max(r, b);
          int maxRgb = Math.Max(g, maxRb);
          int greenLead = g - maxRb;
          bool greenScreen = g > 45 && (greenLead > 8 || (g > 95 && g > r * 1.04 && g > b * 1.04));
          bool blackScreen = maxRgb < 36;

          if (greenScreen || blackScreen) {
            pixels[i + 3] = 0;
          } else if (maxRgb < 72) {
            pixels[i + 3] = (byte)Math.Min(pixels[i + 3], ((maxRgb - 36) * 255) / 36);
          } else if (greenLead > 10) {
            pixels[i + 1] = (byte)Math.Min(g, Math.Max(0, (r + b) / 2));
          }
        }
      }

      Marshal.Copy(pixels, 0, data.Scan0, length);
      bmp.UnlockBits(data);
      bmp.Save(output, ImageFormat.Png);
    }
  }
}
'@

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $code

function Resolve-SafeOutput([string]$root, [string]$name) {
  $target = Join-Path $root $name
  $parent = (Resolve-Path -LiteralPath (Split-Path -Parent $target)).Path
  if (-not $parent.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe output path: $target"
  }
  return $target
}

function Convert-Effect([string]$name, [string]$source, [int]$maxWidth) {
  $outDir = Resolve-SafeOutput $effectsRoot $name
  if (Test-Path -LiteralPath $outDir) {
    if (-not $Force) {
      throw "Output already exists: $outDir"
    }
    $resolved = (Resolve-Path -LiteralPath $outDir).Path
    if (-not $resolved.StartsWith($effectsRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Unsafe existing output path: $resolved"
    }
    Remove-Item -LiteralPath $outDir -Recurse -Force
  }

  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
  $tempRoot = Join-Path $env:TEMP ("fight-turn-effect-" + $name + "-" + [guid]::NewGuid().ToString("N"))
  $rawDir = Join-Path $tempRoot "raw"
  $keyedDir = Join-Path $tempRoot "keyed"

  try {
    New-Item -ItemType Directory -Force -Path $rawDir, $keyedDir | Out-Null
    $filter = "fps=30,scale='min(iw,$maxWidth)':-2"
    ffmpeg -y -i $source -vf $filter (Join-Path $rawDir "%03d.png") -loglevel error
    [FightTurnEffectGreenKeyer]::ProcessDirectory($rawDir, $keyedDir)
    ffmpeg -y -framerate 30 -i (Join-Path $keyedDir "%03d.png") -c:v libwebp -fps_mode passthrough -lossless 0 -compression_level 6 -q:v 80 (Join-Path $outDir ($name + "-%03d.webp")) -loglevel error
  } finally {
    if (Test-Path -LiteralPath $tempRoot) {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
  }

  $frameCount = (Get-ChildItem -LiteralPath $outDir -Filter "*.webp").Count
  if ($frameCount -le 0) {
    throw "No frames generated for $name."
  }

  $audioPath = Resolve-SafeOutput $audioRoot ($name + ".mp3")
  ffmpeg -y -i $source -vn -c:a libmp3lame -b:a 192k $audioPath -loglevel error
  Write-Output "$name`: $frameCount frames and $audioPath"
}

if ($ComboSource) {
  Convert-Effect "combo-impact" $ComboSource 960
}

if ($PokeSource) {
  Convert-Effect "poke-impact" $PokeSource 960
}
