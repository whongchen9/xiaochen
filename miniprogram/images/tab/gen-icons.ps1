$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Add-Type -AssemblyName System.Drawing
function Save-TabIcon([string]$path, [int]$r, [int]$g, [int]$b) {
  $bmp = New-Object Drawing.Bitmap 81, 81
  $gr = [Drawing.Graphics]::FromImage($bmp)
  $gr.Clear([Drawing.Color]::FromArgb(255, $r, $g, $b))
  $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $gr.Dispose()
  $bmp.Dispose()
}
Save-TabIcon (Join-Path $here 'gray.png') 158 158 170
Save-TabIcon (Join-Path $here 'blue.png') 47 108 246
