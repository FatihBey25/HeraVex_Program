Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $root
$brandingDir = Join-Path $projectRoot "branding"
$iconsDir = Join-Path $projectRoot "src-tauri\icons"
$logoPngPath = Join-Path $brandingDir "studio-hub-logo.png"
$iconIcoPath = Join-Path $iconsDir "icon.ico"

New-Item -ItemType Directory -Force -Path $brandingDir | Out-Null
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

$size = 256
$visual = New-Object System.Windows.Media.DrawingVisual
$dc = $visual.RenderOpen()

$gradient = New-Object System.Windows.Media.LinearGradientBrush
$gradient.StartPoint = New-Object System.Windows.Point(0, 0)
$gradient.EndPoint = New-Object System.Windows.Point(1, 1)
$gradient.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color]::FromRgb(125,194,255)), 0.0))
$gradient.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color]::FromRgb(79,140,255)), 0.52))
$gradient.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.Color]::FromRgb(46,91,218)), 1.0))

$dc.DrawRoundedRectangle($gradient, $null, (New-Object System.Windows.Rect(24, 24, 208, 208)), 64, 64)

$whiteBrush = [System.Windows.Media.Brushes]::White
$pen = New-Object System.Windows.Media.Pen($whiteBrush, 18)
$pen.StartLineCap = [System.Windows.Media.PenLineCap]::Round
$pen.EndLineCap = [System.Windows.Media.PenLineCap]::Round
$pen.LineJoin = [System.Windows.Media.PenLineJoin]::Round

$arcFigure = New-Object System.Windows.Media.PathFigure
$arcFigure.StartPoint = New-Object System.Windows.Point(94, 82)
$arcFigure.Segments.Add((New-Object System.Windows.Media.BezierSegment((New-Object System.Windows.Point(120, 66)), (New-Object System.Windows.Point(154, 66)), (New-Object System.Windows.Point(180, 82)), $true)))
$arcFigure.Segments.Add((New-Object System.Windows.Media.BezierSegment((New-Object System.Windows.Point(202, 96)), (New-Object System.Windows.Point(210, 118)), (New-Object System.Windows.Point(210, 132)), $true)))
$arcFigure.Segments.Add((New-Object System.Windows.Media.BezierSegment((New-Object System.Windows.Point(210, 160)), (New-Object System.Windows.Point(186, 180)), (New-Object System.Windows.Point(160, 180)), $true)))
$arcFigure.Segments.Add((New-Object System.Windows.Media.BezierSegment((New-Object System.Windows.Point(136, 180)), (New-Object System.Windows.Point(112, 170)), (New-Object System.Windows.Point(98, 152)), $true)))
$arcGeometry = New-Object System.Windows.Media.PathGeometry
$arcGeometry.Figures.Add($arcFigure)

$slashGeometry = [System.Windows.Media.Geometry]::Parse("M120,100 L154,134 L116,172")
$branchGeometry = [System.Windows.Media.Geometry]::Parse("M184,92 L154,122")

$dc.DrawGeometry($null, $pen, $arcGeometry)
$dc.DrawGeometry($null, (New-Object System.Windows.Media.Pen($whiteBrush, 18)), $slashGeometry)
$dc.DrawGeometry($null, (New-Object System.Windows.Media.Pen($whiteBrush, 16)), $branchGeometry)
$dc.DrawEllipse($whiteBrush, $null, (New-Object System.Windows.Point(184, 78)), 8, 8)
$dc.DrawEllipse($whiteBrush, $null, (New-Object System.Windows.Point(96, 74)), 6, 6)
$dc.Close()

$bitmap = New-Object System.Windows.Media.Imaging.RenderTargetBitmap($size, $size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
$bitmap.Render($visual)

$pngEncoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
$pngEncoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
$pngStream = New-Object System.IO.MemoryStream
$pngEncoder.Save($pngStream)
$pngBytes = $pngStream.ToArray()
[System.IO.File]::WriteAllBytes($logoPngPath, $pngBytes)

$fs = [System.IO.File]::Open($iconIcoPath, [System.IO.FileMode]::Create)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]1)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([Byte]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]32)
$bw.Write([UInt32]$pngBytes.Length)
$bw.Write([UInt32]22)
$bw.Write($pngBytes)
$bw.Close()
$fs.Close()
