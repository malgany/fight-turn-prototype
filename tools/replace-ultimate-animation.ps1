param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [Parameter(Mandatory = $true)][ValidatePattern("^[a-z0-9-]+$")][string]$CharacterDirectory,
  [Parameter(Mandatory = $true)][string]$SourceVideo,
  [ValidateRange(1, 240)][int]$OutputFps = 30,
  [ValidateRange(1, 10000)][int]$ExpectedFrameCount = 176,
  [ValidateRange(1, 10000)][int]$PlaybackFrameLimit = 120,
  [ValidateRange(0, 100)][int]$WebpQuality = 82,
  [ValidateSet("high", "medium", "low")][string]$Profile = "high",
  [ValidateRange(0, 4096)][int]$MaxDimension = 0
)

$ErrorActionPreference = "Stop"

foreach ($tool in @("ffmpeg", "ffprobe")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool was not found in PATH."
  }
}

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$SourceVideo = (Resolve-Path -LiteralPath $SourceVideo).Path
$assetsRoot = (Resolve-Path -LiteralPath (Join-Path $ProjectRoot "assets")).Path
$profileDirectory = switch ($Profile) {
  "medium" { "characters-lite" }
  "low" { "characters-low" }
  default { "characters" }
}
$charactersRoot = (Resolve-Path -LiteralPath (Join-Path $assetsRoot $profileDirectory)).Path
$outputDirectory = Join-Path $charactersRoot "$CharacterDirectory-ultimate"
$operationId = [guid]::NewGuid().ToString("N")
$stagingDirectory = Join-Path $assetsRoot ".$CharacterDirectory-ultimate-staging-$operationId"
$backupDirectory = Join-Path $assetsRoot ".$CharacterDirectory-ultimate-backup-$operationId"
$tempRoot = [System.IO.Path]::GetFullPath((Join-Path ([System.IO.Path]::GetTempPath()) "fight-turn-ultimate-$operationId"))

function Assert-ChildPath([string]$Path, [string]$Root, [string]$Label) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $fullRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $fullPath.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label is outside its allowed root: $fullPath"
  }
  return $fullPath
}

function Remove-SafeDirectory([string]$Path, [string]$Root, [string]$Label) {
  $safePath = Assert-ChildPath $Path $Root $Label
  if (Test-Path -LiteralPath $safePath -PathType Container) {
    Remove-Item -LiteralPath $safePath -Recurse -Force
  }
}

$outputDirectory = Assert-ChildPath $outputDirectory $charactersRoot "Ultimate output directory"
$stagingDirectory = Assert-ChildPath $stagingDirectory $assetsRoot "Ultimate staging directory"
$backupDirectory = Assert-ChildPath $backupDirectory $assetsRoot "Ultimate backup directory"
$tempRoot = Assert-ChildPath $tempRoot ([System.IO.Path]::GetTempPath()) "Ultimate temporary directory"

$greenKeyerSource = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class FightTurnUltimateGreenKeyer {
  public static void ProcessDirectory(string inputDir, string outputDir) {
    Directory.CreateDirectory(outputDir);
    foreach (string input in Directory.GetFiles(inputDir, "*.png")) {
      Process(input, Path.Combine(outputDir, Path.GetFileName(input)));
    }
  }

  public static void Process(string input, string output) {
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
          int index = row + x * 4;
          int blue = pixels[index];
          int green = pixels[index + 1];
          int red = pixels[index + 2];
          int maxRedBlue = Math.Max(red, blue);
          int greenLead = green - maxRedBlue;
          bool greenScreen = green > 45 &&
            (greenLead > 8 || (green > 95 && green > red * 1.04 && green > blue * 1.04));

          if (greenScreen) {
            pixels[index + 3] = 0;
          } else if (greenLead > 10) {
            pixels[index + 1] = (byte)Math.Min(green, Math.Max(0, (red + blue) / 2));
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

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $greenKeyerSource

$rawDirectory = Join-Path $tempRoot "raw"
$keyedDirectory = Join-Path $tempRoot "keyed"
$encodedDirectory = Join-Path $tempRoot "encoded"
$published = $false

try {
  New-Item -ItemType Directory -Path $rawDirectory, $keyedDirectory, $encodedDirectory, $stagingDirectory -Force | Out-Null

  $rawPattern = Join-Path $rawDirectory "%03d.png"
  & ffmpeg -hide_banner -loglevel error -y -i $SourceVideo -vf "fps=$OutputFps" -frames:v $ExpectedFrameCount -start_number 1 $rawPattern
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed while extracting $SourceVideo."
  }

  $rawFrames = @(Get-ChildItem -LiteralPath $rawDirectory -File -Filter "*.png" | Sort-Object Name)
  if ($rawFrames.Count -ne $ExpectedFrameCount) {
    throw "Expected $ExpectedFrameCount frames at ${OutputFps}fps, found $($rawFrames.Count)."
  }

  [FightTurnUltimateGreenKeyer]::ProcessDirectory($rawDirectory, $keyedDirectory)
  $keyedFrames = @(Get-ChildItem -LiteralPath $keyedDirectory -File -Filter "*.png" | Sort-Object Name)
  if ($keyedFrames.Count -ne $ExpectedFrameCount) {
    throw "Expected $ExpectedFrameCount transparent PNGs, found $($keyedFrames.Count)."
  }

  $encodedPattern = Join-Path $encodedDirectory "$CharacterDirectory-ultimate-%03d.webp"
  $encodeArguments = @(
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-framerate", $OutputFps,
    "-start_number", "1",
    "-i", (Join-Path $keyedDirectory "%03d.png"),
    "-frames:v", $ExpectedFrameCount,
    "-fps_mode", "passthrough"
  )

  if ($MaxDimension -gt 0) {
    $sourceProbe = (& ffprobe -v error -select_streams v:0 -show_entries "stream=width,height" -of json $SourceVideo | ConvertFrom-Json).streams[0]
    $sourceWidth = [int]$sourceProbe.width
    $sourceHeight = [int]$sourceProbe.height
    if ([math]::Max($sourceWidth, $sourceHeight) -gt $MaxDimension) {
      if ($sourceWidth -ge $sourceHeight) {
        $targetWidth = $MaxDimension
        $targetHeight = [int](2 * [math]::Round(($sourceHeight * $targetWidth / $sourceWidth) / 2))
      } else {
        $targetHeight = $MaxDimension
        $targetWidth = [int](2 * [math]::Round(($sourceWidth * $targetHeight / $sourceHeight) / 2))
      }
      $encodeArguments += @("-vf", "scale=${targetWidth}:${targetHeight}:flags=lanczos")
    }
  }

  $encodeArguments += @(
    "-c:v", "libwebp",
    "-lossless", "0",
    "-compression_level", "6",
    "-quality", $WebpQuality,
    "-preset", "picture",
    "-map_metadata", "-1",
    "-start_number", "1",
    $encodedPattern
  )
  & ffmpeg @encodeArguments
  if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg failed while encoding the Ultimate WebP frames."
  }

  $encodedFrames = @(Get-ChildItem -LiteralPath $encodedDirectory -File -Filter "*.webp" | Sort-Object Name)
  if ($encodedFrames.Count -ne $ExpectedFrameCount) {
    throw "Expected $ExpectedFrameCount encoded WebPs, found $($encodedFrames.Count)."
  }

  $publishedFrameNumbers = New-Object System.Collections.Generic.List[int]
  if ($ExpectedFrameCount -le $PlaybackFrameLimit) {
    1..$ExpectedFrameCount | ForEach-Object { $publishedFrameNumbers.Add($_) }
  } elseif ($PlaybackFrameLimit -eq 1) {
    $publishedFrameNumbers.Add(1)
  } else {
    $lastIndex = $ExpectedFrameCount - 1
    for ($index = 0; $index -lt $PlaybackFrameLimit; $index += 1) {
      $sourceIndex = [int][math]::Floor((($index * $lastIndex) / ($PlaybackFrameLimit - 1)) + 0.5)
      $publishedFrameNumbers.Add($sourceIndex + 1)
    }
  }

  foreach ($frameNumber in $publishedFrameNumbers) {
    $fileName = "$CharacterDirectory-ultimate-$($frameNumber.ToString('D3')).webp"
    [System.IO.File]::Copy(
      (Join-Path $encodedDirectory $fileName),
      (Join-Path $stagingDirectory $fileName),
      $true
    )
  }

  $stagedFrames = @(Get-ChildItem -LiteralPath $stagingDirectory -File -Filter "*.webp" | Sort-Object Name)
  $expectedPublishedCount = [math]::Min($ExpectedFrameCount, $PlaybackFrameLimit)
  if ($stagedFrames.Count -ne $expectedPublishedCount) {
    throw "Expected $expectedPublishedCount published WebPs, found $($stagedFrames.Count)."
  }

  $probe = @(& ffprobe -v error -select_streams v:0 -show_entries "stream=width,height,pix_fmt" -of "csv=p=0" $stagedFrames[0].FullName)
  if ($LASTEXITCODE -ne 0 -or $probe.Count -ne 1 -or -not $probe[0].Contains("a")) {
    throw "The generated WebPs did not preserve an alpha channel. Probe: $probe"
  }

  if (Test-Path -LiteralPath $backupDirectory) {
    throw "Unexpected existing backup directory: $backupDirectory"
  }
  if (Test-Path -LiteralPath $outputDirectory) {
    Move-Item -LiteralPath $outputDirectory -Destination $backupDirectory
  }

  try {
    Move-Item -LiteralPath $stagingDirectory -Destination $outputDirectory
    $published = $true
  } catch {
    if (Test-Path -LiteralPath $backupDirectory -PathType Container) {
      Move-Item -LiteralPath $backupDirectory -Destination $outputDirectory
    }
    throw
  }

  Remove-SafeDirectory $backupDirectory $assetsRoot "Ultimate backup directory"
  $totalBytes = (Get-ChildItem -LiteralPath $outputDirectory -File -Filter "*.webp" | Measure-Object Length -Sum).Sum
  Write-Output ("{0}/{1}: {2} source frames -> {3} published WebPs ({4:N2} MiB; {5})" -f `
    $CharacterDirectory, $Profile, $ExpectedFrameCount, $stagedFrames.Count, ($totalBytes / 1MB), $probe[0])
} finally {
  Remove-SafeDirectory $tempRoot ([System.IO.Path]::GetTempPath()) "Ultimate temporary directory"
  if (-not $published) {
    Remove-SafeDirectory $stagingDirectory $assetsRoot "Ultimate staging directory"
  }
  if ((Test-Path -LiteralPath $backupDirectory -PathType Container) -and -not (Test-Path -LiteralPath $outputDirectory)) {
    Move-Item -LiteralPath $backupDirectory -Destination $outputDirectory
  }
}
