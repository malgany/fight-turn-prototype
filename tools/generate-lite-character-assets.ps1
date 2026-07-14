param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [ValidateSet("characters-lite", "characters-low")][string]$OutputDirectory = "characters-lite",
  [ValidateRange(1, 8192)][int]$MaxDimension = 512,
  [ValidateRange(0, 100)][int]$Quality = 82
)

$ErrorActionPreference = "Stop"

foreach ($tool in @("ffmpeg", "ffprobe")) {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "$tool was not found in PATH."
  }
}

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$assetsRoot = (Resolve-Path -LiteralPath (Join-Path $ProjectRoot "assets")).Path
$charactersRoot = (Resolve-Path -LiteralPath (Join-Path $assetsRoot "characters")).Path
$outputRoot = Join-Path $assetsRoot $OutputDirectory
$stagingRoot = Join-Path $assetsRoot (".$OutputDirectory-staging-" + [guid]::NewGuid().ToString("N"))
$workRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("fight-turn-$OutputDirectory-" + [guid]::NewGuid().ToString("N"))

$animationFrameLimits = @{
  idle = 60
  getUp = 90
  crouch = 90
  jump = 60
  special = 100
  ultimate = 120
}

function Get-SampledFrameNumbers([int[]]$FrameNumbers, [int]$FrameLimit) {
  if ($FrameLimit -lt 1 -or $FrameNumbers.Count -le $FrameLimit) {
    return $FrameNumbers
  }

  if ($FrameLimit -eq 1) {
    return @($FrameNumbers[0])
  }

  $lastIndex = $FrameNumbers.Count - 1
  $sampled = New-Object System.Collections.Generic.List[int]
  for ($index = 0; $index -lt $FrameLimit; $index += 1) {
    # JavaScript Math.round for the non-negative values used by the game.
    $sourceIndex = [int][math]::Floor((($index * $lastIndex) / ($FrameLimit - 1)) + 0.5)
    $sampled.Add($FrameNumbers[$sourceIndex])
  }
  return $sampled.ToArray()
}

function Get-CharacterRelativePath([string]$FramePattern) {
  $withoutQuery = ($FramePattern -split '[?#]', 2)[0].Replace('\', '/')
  $marker = "game-assets/characters/"
  $markerIndex = $withoutQuery.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase)
  if ($markerIndex -lt 0) {
    throw "Animation frame pattern is outside game-assets/characters: $FramePattern"
  }

  $relativePath = $withoutQuery.Substring($markerIndex + $marker.Length).TrimStart('/')
  if (-not $relativePath.Contains("{frame}")) {
    throw "Animation frame pattern has no {frame} placeholder: $FramePattern"
  }
  return $relativePath
}

function Get-ProbeFrames([string]$Pattern, [int]$FrameCount) {
  $probeOutput = @(
    & ffprobe `
      -v error `
      -f image2 `
      -framerate 30 `
      -start_number 1 `
      -i $Pattern `
      -read_intervals "%+#$FrameCount" `
      -show_entries "frame=width,height,pix_fmt" `
      -of "csv=p=0"
  )
  if ($LASTEXITCODE -ne 0) {
    throw "ffprobe failed for $Pattern"
  }

  $frames = New-Object System.Collections.Generic.List[object]
  foreach ($line in $probeOutput) {
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }
    $parts = $line.Trim().Split(',')
    if ($parts.Count -lt 3) {
      throw "Unexpected ffprobe output for $Pattern`: $line"
    }
    $frames.Add([pscustomobject]@{
      Width = [int]$parts[0]
      Height = [int]$parts[1]
      PixelFormat = $parts[2]
    })
  }

  if ($frames.Count -ne $FrameCount) {
    throw "Expected $FrameCount probed frames for $Pattern, found $($frames.Count)."
  }
  return $frames.ToArray()
}

function Assert-ConvertedFrames([object[]]$SourceFrames, [object[]]$OutputFrames, [string]$AnimationName) {
  if ($SourceFrames.Count -ne $OutputFrames.Count) {
    throw "Frame count changed while converting $AnimationName."
  }

  for ($index = 0; $index -lt $SourceFrames.Count; $index += 1) {
    $source = $SourceFrames[$index]
    $output = $OutputFrames[$index]
    if ([math]::Max($output.Width, $output.Height) -gt $MaxDimension) {
      throw "$AnimationName frame $($index + 1) exceeds ${MaxDimension}px: $($output.Width)x$($output.Height)."
    }
    if ($source.PixelFormat.Contains('a') -and -not $output.PixelFormat.Contains('a')) {
      throw "$AnimationName frame $($index + 1) lost its alpha channel."
    }

    $sourceRatio = $source.Width / [double]$source.Height
    $outputRatio = $output.Width / [double]$output.Height
    $relativeRatioError = [math]::Abs($sourceRatio - $outputRatio) / $sourceRatio
    if ($relativeRatioError -gt 0.01) {
      throw "$AnimationName frame $($index + 1) changed aspect ratio from $($source.Width)x$($source.Height) to $($output.Width)x$($output.Height)."
    }
  }
}

$requiredFrames = @{}
$configFiles = @(
  Get-ChildItem -LiteralPath $charactersRoot -Recurse -File -Filter "*.json" |
    Where-Object { $_.FullName -notmatch '[\\/]old[\\/]' } |
    Sort-Object FullName
)

foreach ($configFile in $configFiles) {
  $config = Get-Content -LiteralPath $configFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($animationProperty in $config.animations.PSObject.Properties) {
    $animationKey = $animationProperty.Name
    $animation = $animationProperty.Value
    $frameCount = [int]$animation.frameCount
    $frameStart = if ($null -ne $animation.frameStart) { [int]$animation.frameStart } else { 1 }
    $frameStep = if ($null -ne $animation.frameStep) { [int]$animation.frameStep } else { 1 }
    $framePad = [int]$animation.framePad
    if ($frameCount -lt 1 -or $frameStart -lt 1 -or $frameStep -lt 1) {
      throw "Invalid animation declaration for $animationKey in $($configFile.FullName)."
    }

    $relativePattern = Get-CharacterRelativePath ([string]$animation.framePattern)
    $frameNumbers = New-Object int[] $frameCount
    for ($index = 0; $index -lt $frameCount; $index += 1) {
      $frameNumbers[$index] = $frameStart + ($index * $frameStep)
    }
    $frameLimit = if ($animationFrameLimits.ContainsKey($animationKey)) {
      [int]$animationFrameLimits[$animationKey]
    } else {
      0
    }

    foreach ($frameNumber in (Get-SampledFrameNumbers $frameNumbers $frameLimit)) {
      $frameText = ([string]$frameNumber).PadLeft($framePad, '0')
      $relativePath = $relativePattern.Replace("{frame}", $frameText)
      $sourcePath = Join-Path $charactersRoot ($relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
      if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "Required source frame not found: $sourcePath"
      }
      $requiredFrames[$relativePath] = $sourcePath
    }
  }
}

$groups = @(
  $requiredFrames.GetEnumerator() |
    Group-Object { [System.IO.Path]::GetDirectoryName($_.Key.Replace('/', [System.IO.Path]::DirectorySeparatorChar)) } |
    Sort-Object Name
)

if (Test-Path -LiteralPath $stagingRoot) {
  throw "Unexpected existing staging directory: $stagingRoot"
}
New-Item -ItemType Directory -Path $stagingRoot, $workRoot -Force | Out-Null

try {
  # BGRA keeps fully transparent pixels at alpha 0. Passing scaled YUVA directly
  # through libwebp can round those pixels to alpha 1 and create a faint green halo.
  $scaleFilter = "scale='if(gte(iw,ih),min($MaxDimension,iw),-1)':'if(gte(iw,ih),-1,min($MaxDimension,ih))':flags=lanczos,format=bgra"
  $groupNumber = 0
  foreach ($group in $groups) {
    $groupNumber += 1
    $records = @($group.Group | Sort-Object Key)
    $animationWorkRoot = Join-Path $workRoot ("{0:D2}" -f $groupNumber)
    $inputRoot = Join-Path $animationWorkRoot "input"
    $convertedRoot = Join-Path $animationWorkRoot "output"
    New-Item -ItemType Directory -Path $inputRoot, $convertedRoot -Force | Out-Null

    for ($index = 0; $index -lt $records.Count; $index += 1) {
      $inputPath = Join-Path $inputRoot ("{0:D6}.webp" -f ($index + 1))
      [System.IO.File]::Copy($records[$index].Value, $inputPath, $true)
    }

    $inputPattern = Join-Path $inputRoot "%06d.webp"
    $outputPattern = Join-Path $convertedRoot "%06d.webp"
    $sourceFrames = Get-ProbeFrames $inputPattern $records.Count
    $requiresResize = @(
      $sourceFrames | Where-Object { [math]::Max($_.Width, $_.Height) -gt $MaxDimension }
    ).Count -gt 0

    if ($requiresResize) {
      & ffmpeg `
        -hide_banner `
        -loglevel error `
        -y `
        -filter_threads 1 `
        -framerate 30 `
        -start_number 1 `
        -i $inputPattern `
        -vf $scaleFilter `
        -frames:v $records.Count `
        -fps_mode passthrough `
        -c:v libwebp `
        -lossless 0 `
        -compression_level 6 `
        -quality $Quality `
        -preset picture `
        -threads 1 `
        -map_metadata -1 `
        -start_number 1 `
        $outputPattern
      if ($LASTEXITCODE -ne 0) {
        throw "ffmpeg failed while converting $($group.Name)."
      }
      $outputFrames = Get-ProbeFrames $outputPattern $records.Count
    } else {
      $outputFrames = $sourceFrames
    }
    Assert-ConvertedFrames $sourceFrames $outputFrames $group.Name

    for ($index = 0; $index -lt $records.Count; $index += 1) {
      $relativePath = $records[$index].Key.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $targetPath = Join-Path $stagingRoot $relativePath
      $targetDirectory = Split-Path -Parent $targetPath
      New-Item -ItemType Directory -Path $targetDirectory -Force | Out-Null
      if ($requiresResize) {
        [System.IO.File]::Move(
          (Join-Path $convertedRoot ("{0:D6}.webp" -f ($index + 1))),
          $targetPath
        )
      } else {
        [System.IO.File]::Copy($records[$index].Value, $targetPath, $true)
      }
    }

    Remove-Item -LiteralPath $animationWorkRoot -Recurse -Force
    $action = if ($requiresResize) { "resized" } else { "kept original" }
    Write-Host ("[{0}/{1}] {2}: {3} frames ({4})" -f $groupNumber, $groups.Count, $group.Name, $records.Count, $action)
  }

  $generatedFiles = @(Get-ChildItem -LiteralPath $stagingRoot -Recurse -File -Filter "*.webp")
  if ($generatedFiles.Count -ne $requiredFrames.Count) {
    throw "Expected $($requiredFrames.Count) generated frames, found $($generatedFiles.Count)."
  }

  if (Test-Path -LiteralPath $outputRoot) {
    $resolvedOutput = (Resolve-Path -LiteralPath $outputRoot).Path
    if (-not $resolvedOutput.StartsWith($assetsRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to replace unsafe output path: $resolvedOutput"
    }
    Remove-Item -LiteralPath $resolvedOutput -Recurse -Force
  }
  # Copying is more reliable than renaming here on Windows, where antivirus or
  # image previewers can briefly hold a directory handle after the final probe.
  New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
  Get-ChildItem -LiteralPath $stagingRoot -Force |
    Copy-Item -Destination $outputRoot -Recurse -Force

  $publishedFiles = @(Get-ChildItem -LiteralPath $outputRoot -Recurse -File -Filter "*.webp")
  if ($publishedFiles.Count -ne $requiredFrames.Count) {
    throw "Expected $($requiredFrames.Count) published frames, found $($publishedFiles.Count)."
  }

  $totalBytes = (Get-ChildItem -LiteralPath $outputRoot -Recurse -File -Filter "*.webp" | Measure-Object Length -Sum).Sum
  Write-Host "Generated $($requiredFrames.Count) character frames in $outputRoot"
  Write-Host ("Total size: {0:N2} MiB; maximum dimension: {1}px; alpha preserved." -f ($totalBytes / 1MB), $MaxDimension)
} finally {
  if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
}
