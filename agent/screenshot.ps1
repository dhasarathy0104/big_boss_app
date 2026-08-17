Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

$maxWidth = 1280
if ($bmp.Width -gt $maxWidth) {
  $scale = $maxWidth / $bmp.Width
  $newW = [int]($bmp.Width * $scale)
  $newH = [int]($bmp.Height * $scale)
  $small = New-Object System.Drawing.Bitmap $newW, $newH
  $g2 = [System.Drawing.Graphics]::FromImage($small)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $newW, $newH)
  $bmp.Dispose()
  $bmp = $small
  $g2.Dispose()
}

$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$qualityParam = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [int64]65)
$encoderParams.Param[0] = $qualityParam
$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }

$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, $jpegCodec, $encoderParams)
$bytes = $ms.ToArray()
[Convert]::ToBase64String($bytes)

$graphics.Dispose()
$bmp.Dispose()
$ms.Dispose()
