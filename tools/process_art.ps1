# 把 art_src/ 的 H 站原圖轉成 App 用的尺寸
#   powershell -ExecutionPolicy Bypass -File tools/process_art.ps1
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "art_src"
$img = Join-Path $root "www\img"
$res = Join-Path $root "assets"   # @capacitor/assets 會從這裡產生 iOS 圖示與啟動畫面
New-Item -ItemType Directory -Force $img, $res | Out-Null

function New-Graphics($bmp) {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  return $g
}

function Save-Jpeg($bmp, $path, $quality) {
  $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
  $p = New-Object System.Drawing.Imaging.EncoderParameters 1
  $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$quality)
  $bmp.Save($path, $codec, $p)
}

function Resize-Jpeg($name, $out, $w, $h) {
  $s = [System.Drawing.Image]::FromFile((Join-Path $src $name))
  $b = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = New-Graphics $b
  $g.DrawImage($s, 0, 0, $w, $h)
  Save-Jpeg $b (Join-Path $img $out) 84
  $g.Dispose(); $b.Dispose(); $s.Dispose()
}

# 找出不透明像素的範圍，裁掉多餘透明邊再縮圖
function Crop-Sprite($name, $out, $max) {
  $s = New-Object System.Drawing.Bitmap (Join-Path $src $name)
  $rect = New-Object System.Drawing.Rectangle 0, 0, $s.Width, $s.Height
  $data = $s.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($data.Stride * $s.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $s.UnlockBits($data)
  $minX = $s.Width; $minY = $s.Height; $maxX = 0; $maxY = 0
  for ($y = 0; $y -lt $s.Height; $y += 2) {
    $row = $y * $data.Stride
    for ($x = 0; $x -lt $s.Width; $x += 2) {
      if ($bytes[$row + $x * 4 + 3] -gt 24) {
        if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  $pad = 12
  $minX = [Math]::Max(0, $minX - $pad); $minY = [Math]::Max(0, $minY - $pad)
  $maxX = [Math]::Min($s.Width - 1, $maxX + $pad); $maxY = [Math]::Min($s.Height - 1, $maxY + $pad)
  $cw = $maxX - $minX + 1; $ch = $maxY - $minY + 1
  $scale = [Math]::Min(1.0, $max / [Math]::Max($cw, $ch))
  $w = [int]($cw * $scale); $h = [int]($ch * $scale)
  $b = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = New-Graphics $b
  $g.DrawImage($s, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), $minX, $minY, $cw, $ch, [System.Drawing.GraphicsUnit]::Pixel)
  $b.Save((Join-Path $img $out), [System.Drawing.Imaging.ImageFormat]::Png)
  "$out  ${w}x${h}"
  $g.Dispose(); $b.Dispose(); $s.Dispose()
}

function Save-Icon($size, $path) {
  $s = [System.Drawing.Image]::FromFile((Join-Path $src "icon_src.png"))
  $b = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = New-Graphics $b
  $g.DrawImage($s, 0, 0, $size, $size)
  $b.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $b.Dispose(); $s.Dispose()
}

Resize-Jpeg "bg_home.png" "bg_home.jpg" 1080 1910
Resize-Jpeg "bg_game.png" "bg_game.jpg" 1080 1910
Resize-Jpeg "bg_home_wide.png" "bg_home_wide.jpg" 1920 1086   # 桌機版封面背景
Crop-Sprite "cat_wave.png" "cat_wave.png" 560
Crop-Sprite "cat_think.png" "cat_think.png" 400
Crop-Sprite "cat_star.png" "cat_star.png" 560
Crop-Sprite "cat_sad.png" "cat_sad.png" 560

# App 圖示（iOS 要求不能有透明通道）
Save-Icon 1024 (Join-Path $res "icon-only.png")
Save-Icon 512 (Join-Path $img "icon-512.png")
Save-Icon 192 (Join-Path $img "icon-192.png")
Save-Icon 180 (Join-Path $img "apple-touch-icon.png")

# 啟動畫面 2732x2732：粉色漸層 + 揮手貓咪
$size = 2732
$b = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = New-Graphics $b
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Point 0, 0), (New-Object System.Drawing.Point 0, $size), ([System.Drawing.Color]::FromArgb(255, 255, 214, 226)), ([System.Drawing.Color]::FromArgb(255, 255, 240, 214))
$g.FillRectangle($brush, 0, 0, $size, $size)
$cat = [System.Drawing.Image]::FromFile((Join-Path $img "cat_wave.png"))
$cw = 900; $chh = [int]($cat.Height * $cw / $cat.Width)
$g.DrawImage($cat, [int](($size - $cw) / 2), [int](($size - $chh) / 2), $cw, $chh)
$b.Save((Join-Path $res "splash.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$b.Save((Join-Path $res "splash-dark.png"), [System.Drawing.Imaging.ImageFormat]::Png)
$cat.Dispose(); $g.Dispose(); $b.Dispose()

Get-ChildItem $img, $res | Select-Object Name, @{n = "KB"; e = { [int]($_.Length / 1KB) } } | Format-Table -AutoSize
