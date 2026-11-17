# neurodanza · ventana EN VIVO del panel de personas (Windows).
# Se abre al empezar la ronda, siempre encima: de 3 a 5 avatares arriba con su estado, y abajo la
# conversación (cada persona cuenta lo que prueba y lo que encuentra). Lee el archivo de la ronda
# (JSONL que escriben `panel.mjs decir` y `panel.mjs cerrar`) y, al llegar el fin de la ronda,
# muestra notas y promedio y se cierra sola.
param([Parameter(Mandatory = $true)][string]$State, [int]$CloseAfter = 12)

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

function New-Brush([string]$hex) { return [System.Windows.Media.BrushConverter]::new().ConvertFromString($hex) }

$win = New-Object System.Windows.Window
$win.Title = 'Panel de personas · neurodanza (en vivo)'
$win.Width = 900; $win.Height = 640
$win.WindowStartupLocation = 'CenterScreen'
$win.Topmost = $true
$win.Background = New-Brush '#0f172a'
$win.ResizeMode = 'CanResize'

$root = New-Object System.Windows.Controls.DockPanel
$root.Margin = '18'

# Encabezado
$head = New-Object System.Windows.Controls.StackPanel
[System.Windows.Controls.DockPanel]::SetDock($head, 'Top')
$title = New-Object System.Windows.Controls.TextBlock
$title.FontSize = 22; $title.FontWeight = 'Bold'; $title.Foreground = New-Brush '#e2e8f0'
$title.Text = 'Panel de personas'
$sub = New-Object System.Windows.Controls.TextBlock
$sub.FontSize = 13; $sub.Foreground = New-Brush '#94a3b8'; $sub.TextWrapping = 'Wrap'; $sub.Margin = '0,2,0,12'
$head.Children.Add($title) | Out-Null
$head.Children.Add($sub) | Out-Null
$root.Children.Add($head) | Out-Null

# Tarjetas de las personas
$cardsRow = New-Object System.Windows.Controls.Primitives.UniformGrid
$cardsRow.Rows = 1
[System.Windows.Controls.DockPanel]::SetDock($cardsRow, 'Top')
$root.Children.Add($cardsRow) | Out-Null
$global:NeurodanzaCards = $cardsRow

# Pie (estado de la ronda)
$foot = New-Object System.Windows.Controls.Border
$foot.CornerRadius = 10; $foot.Padding = '12,8,12,8'; $foot.Margin = '0,12,0,0'
$foot.Background = New-Brush '#1e293b'
[System.Windows.Controls.DockPanel]::SetDock($foot, 'Bottom')
$footText = New-Object System.Windows.Controls.TextBlock
$footText.FontSize = 14; $footText.Foreground = New-Brush '#cbd5e1'; $footText.TextWrapping = 'Wrap'
$footText.Text = 'Ronda en curso… las personas están probando la app.'
$foot.Child = $footText
$root.Children.Add($foot) | Out-Null

# Conversación
$scroll = New-Object System.Windows.Controls.ScrollViewer
$scroll.Margin = '0,12,0,0'
$scroll.VerticalScrollBarVisibility = 'Auto'
$chat = New-Object System.Windows.Controls.StackPanel
$scroll.Content = $chat
$root.Children.Add($scroll) | Out-Null

$win.Content = $root

$script:people = @{}
$script:pos = 0
$script:finished = $false
$script:left = $CloseAfter
$script:lastChange = Get-Date

function Add-Card($p) {
  $card = New-Object System.Windows.Controls.Border
  $card.CornerRadius = 14; $card.Margin = '6,0,6,0'; $card.Padding = '10'
  $card.Background = New-Brush '#1e293b'; $card.BorderBrush = New-Brush $p.color; $card.BorderThickness = 2
  $sp = New-Object System.Windows.Controls.StackPanel
  $sp.HorizontalAlignment = 'Center'
  if ($p.imagen -and (Test-Path $p.imagen)) {
    $img = New-Object System.Windows.Controls.Image
    $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit(); $bmp.UriSource = [Uri]$p.imagen; $bmp.CacheOption = 'OnLoad'; $bmp.EndInit()
    $img.Source = $bmp; $img.Width = 84; $img.Height = 84
    $sp.Children.Add($img) | Out-Null
  }
  $n = New-Object System.Windows.Controls.TextBlock
  $n.Text = $p.nombre; $n.FontSize = 15; $n.FontWeight = 'SemiBold'; $n.Foreground = [System.Windows.Media.Brushes]::White
  $n.HorizontalAlignment = 'Center'; $n.Margin = '0,6,0,0'
  $c = New-Object System.Windows.Controls.TextBlock
  $c.Text = $p.cargo; $c.FontSize = 11; $c.Foreground = New-Brush '#94a3b8'; $c.HorizontalAlignment = 'Center'
  $c.TextWrapping = 'Wrap'; $c.TextAlignment = 'Center'
  $pill = New-Object System.Windows.Controls.Border
  $pill.CornerRadius = 9; $pill.Padding = '8,2,8,2'; $pill.Margin = '0,6,0,0'; $pill.HorizontalAlignment = 'Center'
  $pill.Background = New-Brush $p.color
  $st = New-Object System.Windows.Controls.TextBlock
  $st.Text = 'Esperando…'; $st.FontSize = 12; $st.FontWeight = 'Bold'; $st.Foreground = [System.Windows.Media.Brushes]::White
  $pill.Child = $st
  $sp.Children.Add($n) | Out-Null; $sp.Children.Add($c) | Out-Null; $sp.Children.Add($pill) | Out-Null
  $card.Child = $sp
  $global:NeurodanzaCards.Children.Add($card) | Out-Null
  $script:people[$p.id] = @{ info = $p; status = $st }
}

function Add-Bubble($id, [string]$text) {
  $p = $script:people[$id]
  $color = if ($p) { $p.info.color } else { '#64748b' }
  $name = if ($p) { $p.info.nombre } else { $id }
  $row = New-Object System.Windows.Controls.DockPanel
  $row.Margin = '0,0,0,8'
  if ($p -and $p.info.imagen -and (Test-Path $p.info.imagen)) {
    $img = New-Object System.Windows.Controls.Image
    $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit(); $bmp.UriSource = [Uri]$p.info.imagen; $bmp.CacheOption = 'OnLoad'; $bmp.EndInit()
    $img.Source = $bmp; $img.Width = 34; $img.Height = 34; $img.VerticalAlignment = 'Top'; $img.Margin = '0,0,8,0'
    [System.Windows.Controls.DockPanel]::SetDock($img, 'Left')
    $row.Children.Add($img) | Out-Null
  }
  $b = New-Object System.Windows.Controls.Border
  $b.CornerRadius = 10; $b.Padding = '10,6,10,6'; $b.Background = New-Brush '#1e293b'
  $b.BorderBrush = New-Brush $color; $b.BorderThickness = '3,0,0,0'
  $tb = New-Object System.Windows.Controls.TextBlock
  $tb.TextWrapping = 'Wrap'; $tb.FontSize = 13; $tb.Foreground = New-Brush '#e2e8f0'
  $who = New-Object System.Windows.Documents.Run ($name + ': ')
  $who.FontWeight = 'Bold'; $who.Foreground = New-Brush $color
  $tb.Inlines.Add($who)
  $tb.Inlines.Add((New-Object System.Windows.Documents.Run $text))
  $b.Child = $tb
  $row.Children.Add($b) | Out-Null
  $chat.Children.Add($row) | Out-Null
  $scroll.ScrollToEnd()
}

function Read-NewLines {
  if (-not (Test-Path $State)) { return @() }
  try {
    $fs = [System.IO.File]::Open($State, 'Open', 'Read', 'ReadWrite')
    $fs.Seek($script:pos, 'Begin') | Out-Null
    $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8)
    $text = $sr.ReadToEnd()
    $script:pos = $fs.Position
    $sr.Close(); $fs.Close()
  } catch { return @() }
  if (-not $text) { return @() }
  return $text -split "`n" | Where-Object { $_.Trim() }
}

function Handle($ev) {
  $script:lastChange = Get-Date
  switch ($ev.type) {
    'inicio' {
      $title.Text = $ev.titulo
      $sub.Text = $ev.cambio
      foreach ($p in $ev.personas) { Add-Card $p }
    }
    'msg' {
      if ($ev.estado -and $script:people[$ev.persona]) { $script:people[$ev.persona].status.Text = $ev.estado }
      if ($ev.texto) { Add-Bubble $ev.persona $ev.texto }
    }
    'fin' {
      foreach ($n in $ev.notas) {
        if ($script:people[$n.persona]) { $script:people[$n.persona].status.Text = "$($n.estado) · $($n.nota)" }
      }
      $ok = [bool]$ev.aprobado
      $foot.Background = New-Brush ($(if ($ok) { '#14532d' } else { '#7f1d1d' }))
      $verdict = if ($ok) { 'APROBADO' } else { 'NO APROBADO' }
      $script:verdict = "$verdict · promedio $($ev.promedio) / 10 (umbral $($ev.umbral))"
      $footText.Foreground = [System.Windows.Media.Brushes]::White
      $footText.FontWeight = 'Bold'
      $script:finished = $true
    }
  }
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(700)
$timer.Add_Tick({
  foreach ($line in (Read-NewLines)) {
    try { Handle ($line | ConvertFrom-Json) } catch { Add-Content -Path ($State + ".log") -Value ("$($_.Exception.Message) @ $($_.InvocationInfo.ScriptLineNumber)") }
  }
  if ($script:finished) {
    $footText.Text = "$($script:verdict) — se cierra en $([math]::Ceiling($script:left)) s"
    $script:left -= 0.7
    if ($script:left -le 0) { $timer.Stop(); $win.Close() }
  } elseif (((Get-Date) - $script:lastChange).TotalMinutes -gt 45) {
    $timer.Stop(); $win.Close()
  }
})
$win.Add_ContentRendered({ $win.Activate() | Out-Null; $timer.Start() })
$win.ShowDialog() | Out-Null
