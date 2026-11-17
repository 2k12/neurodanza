# neurodanza · ventana de resumen del panel de personas: avatares en primer plano con nombre, cargo, estado y nota.
# Siempre encima de todo y se cierra sola. La abre `node panel.mjs ventana --resultado <json>`.
param([Parameter(Mandatory = $true)][string]$Data)

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

$d = Get-Content -Raw -Encoding UTF8 $Data | ConvertFrom-Json
Remove-Item $Data -ErrorAction SilentlyContinue

function New-Brush([string]$hex) { return [System.Windows.Media.BrushConverter]::new().ConvertFromString($hex) }

$accent = if ($d.aprobado) { '#16a34a' } else { '#dc2626' }

$win = New-Object System.Windows.Window
$win.WindowStyle = 'None'
$win.AllowsTransparency = $true
$win.Background = [System.Windows.Media.Brushes]::Transparent
$win.Topmost = $true
$win.ShowInTaskbar = $true
$win.SizeToContent = 'WidthAndHeight'
$win.WindowStartupLocation = 'CenterScreen'
$win.Title = 'Panel de personas · neurodanza'

$outer = New-Object System.Windows.Controls.Border
$outer.CornerRadius = 18
$outer.Background = New-Brush '#0f172a'
$outer.BorderBrush = New-Brush $accent
$outer.BorderThickness = 2
$outer.Padding = '28,22,28,22'
$outer.Effect = New-Object System.Windows.Media.Effects.DropShadowEffect -Property @{ BlurRadius = 30; ShadowDepth = 0; Opacity = 0.6 }

$stack = New-Object System.Windows.Controls.StackPanel

$head = New-Object System.Windows.Controls.TextBlock
$head.Text = $d.titulo
$head.FontSize = 24
$head.FontWeight = 'Bold'
$head.Foreground = New-Brush $accent
$head.HorizontalAlignment = 'Center'
$stack.Children.Add($head) | Out-Null

$sub = New-Object System.Windows.Controls.TextBlock
$sub.Text = "$($d.cambio)  ·  promedio $($d.promedio) / 10"
$sub.FontSize = 13
$sub.Foreground = New-Brush '#cbd5e1'
$sub.HorizontalAlignment = 'Center'
$sub.Margin = '0,4,0,18'
$sub.TextWrapping = 'Wrap'
$sub.MaxWidth = 720
$stack.Children.Add($sub) | Out-Null

$row = New-Object System.Windows.Controls.StackPanel
$row.Orientation = 'Horizontal'
$row.HorizontalAlignment = 'Center'

foreach ($c in $d.cards) {
  $card = New-Object System.Windows.Controls.Border
  $card.CornerRadius = 14
  $card.Background = New-Brush '#1e293b'
  $card.BorderBrush = New-Brush $c.color
  $card.BorderThickness = 2
  $card.Margin = '10,0,10,0'
  $card.Padding = '16,16,16,14'
  $card.Width = 220

  $cs = New-Object System.Windows.Controls.StackPanel
  $cs.HorizontalAlignment = 'Center'

  if (Test-Path $c.imagen) {
    $img = New-Object System.Windows.Controls.Image
    $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit(); $bmp.UriSource = [Uri]$c.imagen; $bmp.CacheOption = 'OnLoad'; $bmp.EndInit()
    $img.Source = $bmp
    $img.Width = 120; $img.Height = 120
    $img.HorizontalAlignment = 'Center'
    $cs.Children.Add($img) | Out-Null
  }

  $name = New-Object System.Windows.Controls.TextBlock
  $name.Text = $c.nombre
  $name.FontSize = 17; $name.FontWeight = 'SemiBold'
  $name.Foreground = [System.Windows.Media.Brushes]::White
  $name.HorizontalAlignment = 'Center'; $name.Margin = '0,10,0,0'
  $cs.Children.Add($name) | Out-Null

  $role = New-Object System.Windows.Controls.TextBlock
  $role.Text = $c.cargo
  $role.FontSize = 12; $role.Foreground = New-Brush '#94a3b8'
  $role.HorizontalAlignment = 'Center'; $role.TextAlignment = 'Center'; $role.TextWrapping = 'Wrap'
  $cs.Children.Add($role) | Out-Null

  $pill = New-Object System.Windows.Controls.Border
  $pill.CornerRadius = 10; $pill.Background = New-Brush $c.color
  $pill.Padding = '10,3,10,3'; $pill.Margin = '0,10,0,0'; $pill.HorizontalAlignment = 'Center'
  $pt = New-Object System.Windows.Controls.TextBlock
  $pt.Text = "$($c.estado) · $($c.nota)"
  $pt.FontSize = 13; $pt.FontWeight = 'Bold'; $pt.Foreground = [System.Windows.Media.Brushes]::White
  $pill.Child = $pt
  $cs.Children.Add($pill) | Out-Null

  if ($c.frase) {
    $q = New-Object System.Windows.Controls.TextBlock
    $q.Text = "“$($c.frase)”"
    $q.FontSize = 12; $q.FontStyle = 'Italic'; $q.Foreground = New-Brush '#e2e8f0'
    $q.TextWrapping = 'Wrap'; $q.TextAlignment = 'Center'; $q.Margin = '0,10,0,0'; $q.MaxWidth = 190
    $cs.Children.Add($q) | Out-Null
  }

  $card.Child = $cs
  $row.Children.Add($card) | Out-Null
}
$stack.Children.Add($row) | Out-Null

$foot = New-Object System.Windows.Controls.TextBlock
$foot.FontSize = 11; $foot.Foreground = New-Brush '#64748b'
$foot.HorizontalAlignment = 'Center'; $foot.Margin = '0,16,0,0'
$stack.Children.Add($foot) | Out-Null

$outer.Child = $stack
$win.Content = $outer
$win.Add_MouseLeftButtonDown({ $win.Close() })

$script:left = [int]$d.segundos
$foot.Text = "Se cierra en $script:left s · clic para cerrar"
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({
  $script:left--
  if ($script:left -le 0) { $timer.Stop(); $win.Close() }
  else { $foot.Text = "Se cierra en $script:left s · clic para cerrar" }
})
$win.Add_ContentRendered({ $win.Activate() | Out-Null; $timer.Start() })
$win.ShowDialog() | Out-Null
