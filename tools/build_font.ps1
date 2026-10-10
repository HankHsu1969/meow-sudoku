# 重新產生「粉圓體 Huninn」字型子集（只包含遊戲用到的字，約 70 KB，可離線使用）
# 修改了畫面上的中文字之後執行：
#   powershell -ExecutionPolicy Bypass -File tools/build_font.ps1
$root = Split-Path -Parent $PSScriptRoot
$files = @("www\index.html", "www\js\game.js") | ForEach-Object { Join-Path $root $_ }
$set = New-Object System.Collections.Generic.SortedSet[char]
foreach ($f in $files) {
  foreach ($ch in [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8).ToCharArray()) {
    if ([int]$ch -gt 127) { [void]$set.Add($ch) }
  }
}
for ($c = 32; $c -le 126; $c++) { [void]$set.Add([char]$c) }
foreach ($ch in "，。！？～…、：；「」（）×✓".ToCharArray()) { [void]$set.Add($ch) }
$text = -join $set
Write-Host "字數：$($set.Count)"

$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
$url = "https://fonts.googleapis.com/css2?family=Huninn&text=" + [System.Uri]::EscapeDataString($text)
$css = (Invoke-WebRequest -Uri $url -UserAgent $ua -UseBasicParsing).Content
$fontUrl = [regex]::Match($css, "url\((https://[^)]+)\)").Groups[1].Value
$out = Join-Path $root "www\fonts\huninn-subset.woff2"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
Invoke-WebRequest -Uri $fontUrl -UserAgent $ua -OutFile $out -UseBasicParsing
Write-Host "已更新 $out （$([int]((Get-Item $out).Length / 1KB)) KB）"
