# neurodanza · ventana EN VIVO del panel de personas (Windows): «Role Agents».
# A la izquierda, la lista de personas (foto, nombre, cargo, estado y nota; con scroll); a la derecha, el
# chat vertical de la ronda. Lee el
# archivo de la ronda (JSONL que escriben `panel.mjs decir` y `panel.mjs cerrar`); al llegar el fin,
# ordena la lista por nota, muestra el veredicto y se cierra sola.
param([Parameter(Mandatory = $true)][string]$State, [int]$CloseAfter = 12)

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

function New-Brush([string]$hex) { return [System.Windows.Media.BrushConverter]::new().ConvertFromString($hex) }

# Paleta: casi negro, un solo acento rojo, texto en dos grises.
$C = @{
  fondo = '#0b0b0e'; panel = '#121217'; fila = '#16161c'; filaActiva = '#262630'; linea = '#24242c'
  texto = '#f4f4f5'; tenue = '#8b8b95'; rojo = '#e10600'; verde = '#22c55e'; amarillo = '#facc15'; morado = '#a855f7'
}
$TITULAR = New-Object System.Windows.Media.FontFamily 'Bahnschrift, Segoe UI'
$CUERPO = New-Object System.Windows.Media.FontFamily 'Segoe UI'

function New-Text([string]$t, [double]$size, [string]$color, [string]$weight = 'Normal', $family = $CUERPO) {
  $tb = New-Object System.Windows.Controls.TextBlock
  $tb.Text = $t; $tb.FontSize = $size; $tb.Foreground = New-Brush $color; $tb.FontWeight = $weight; $tb.FontFamily = $family
  $tb.VerticalAlignment = 'Center'
  return $tb
}

# Color del estado: verde sin problemas, amarillo observación, rojo error o bloqueo; gris mientras prueba.
function Get-EstadoColor([string]$estado) {
  switch -Regex ($estado) {
    '^(Sin observaciones|Observaciones menores)$' { return $C.verde }
    '^(Con observación|Funciona con dificultad)$' { return $C.amarillo }
    '^(Con error|Bloqueado|Requiere ayuda|No funciona)$' { return $C.rojo }
    default { return $C.tenue }
  }
}

$win = New-Object System.Windows.Window
$win.Title = 'Role Agents · neurodanza'
$win.Width = 760; $win.Height = 620; $win.MinWidth = 600; $win.MinHeight = 420
$win.WindowStartupLocation = 'CenterScreen'
$win.Topmost = $true
$win.Background = New-Brush $C.fondo
$win.ResizeMode = 'CanResize'

# Barra de scroll fina y oscura (la de Windows es clara y rompe el estilo).
$scrollXaml = @'
<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">
  <Style TargetType="ScrollBar">
    <Setter Property="Width" Value="6"/>
    <Setter Property="MinWidth" Value="6"/>
    <Setter Property="Background" Value="Transparent"/>
    <Setter Property="Template">
      <Setter.Value>
        <ControlTemplate TargetType="ScrollBar">
          <Track x:Name="PART_Track" IsDirectionReversed="True">
            <Track.Thumb>
              <Thumb>
                <Thumb.Template>
                  <ControlTemplate TargetType="Thumb"><Border CornerRadius="3" Background="#34343e"/></ControlTemplate>
                </Thumb.Template>
              </Thumb>
            </Track.Thumb>
          </Track>
        </ControlTemplate>
      </Setter.Value>
    </Setter>
  </Style>
</ResourceDictionary>
'@
try { $win.Resources.MergedDictionaries.Add([System.Windows.Markup.XamlReader]::Parse($scrollXaml)) } catch { }

$root = New-Object System.Windows.Controls.Grid
foreach ($h in @('Auto', '*', 'Auto')) {
  $rd = New-Object System.Windows.Controls.RowDefinition
  $rd.Height = if ($h -eq '*') { [System.Windows.GridLength]::new(1, 'Star') } else { [System.Windows.GridLength]::Auto }
  $root.RowDefinitions.Add($rd) | Out-Null
}

# ── Encabezado: Role Agents, el cambio y a la derecha la ronda y el tiempo ──
$head = New-Object System.Windows.Controls.Border
$head.BorderBrush = New-Brush $C.rojo; $head.BorderThickness = '0,3,0,0'; $head.Padding = '22,14,22,12'
$headGrid = New-Object System.Windows.Controls.DockPanel
$right = New-Object System.Windows.Controls.StackPanel
$right.Orientation = 'Horizontal'; $right.VerticalAlignment = 'Center'
[System.Windows.Controls.DockPanel]::SetDock($right, 'Right')
$lap = New-Text 'Ronda 1' 13 $C.tenue 'SemiBold' $TITULAR
$lap.Margin = '0,0,16,0'
$clock = New-Text '00:00' 22 $C.texto 'Bold' $TITULAR
$right.Children.Add($lap) | Out-Null; $right.Children.Add($clock) | Out-Null
$titles = New-Object System.Windows.Controls.StackPanel
$brand = New-Object System.Windows.Controls.StackPanel
$brand.Orientation = 'Horizontal'
$mark = New-Object System.Windows.Shapes.Rectangle
$mark.Width = 6; $mark.Height = 22; $mark.Fill = New-Brush $C.rojo; $mark.Margin = '0,0,10,0'
$mark.RenderTransform = New-Object System.Windows.Media.SkewTransform(-15, 0)
$title = New-Text 'Role Agents' 24 $C.texto 'Bold' $TITULAR
$brand.Children.Add($mark) | Out-Null; $brand.Children.Add($title) | Out-Null
$sub = New-Text '' 12.5 $C.tenue
$sub.TextWrapping = 'Wrap'; $sub.Margin = '16,4,0,0'; $sub.TextTrimming = 'CharacterEllipsis'; $sub.MaxHeight = 36
$titles.Children.Add($brand) | Out-Null; $titles.Children.Add($sub) | Out-Null
$headGrid.Children.Add($right) | Out-Null; $headGrid.Children.Add($titles) | Out-Null
$head.Child = $headGrid
[System.Windows.Controls.Grid]::SetRow($head, 0)
$root.Children.Add($head) | Out-Null

# ── Cuerpo: personas (izquierda) | chat (derecha) ──
$body = New-Object System.Windows.Controls.Grid
$body.Margin = '16,4,16,0'
$c1 = New-Object System.Windows.Controls.ColumnDefinition; $c1.Width = [System.Windows.GridLength]::new(270)
$c2 = New-Object System.Windows.Controls.ColumnDefinition; $c2.Width = [System.Windows.GridLength]::new(12)
$c3 = New-Object System.Windows.Controls.ColumnDefinition; $c3.Width = [System.Windows.GridLength]::new(1, 'Star')
$body.ColumnDefinitions.Add($c1) | Out-Null; $body.ColumnDefinitions.Add($c2) | Out-Null; $body.ColumnDefinitions.Add($c3) | Out-Null
[System.Windows.Controls.Grid]::SetRow($body, 1)
$root.Children.Add($body) | Out-Null

function New-Column([string]$label) {
  $box = New-Object System.Windows.Controls.DockPanel
  $cap = New-Text $label 11 $C.tenue 'SemiBold' $TITULAR
  $cap.Margin = '4,6,0,8'
  [System.Windows.Controls.DockPanel]::SetDock($cap, 'Top')
  $box.Children.Add($cap) | Out-Null
  $sv = New-Object System.Windows.Controls.ScrollViewer
  $sv.VerticalScrollBarVisibility = 'Auto'; $sv.HorizontalScrollBarVisibility = 'Disabled'
  $sp = New-Object System.Windows.Controls.StackPanel
  $sv.Content = $sp
  $box.Children.Add($sv) | Out-Null
  return @{ box = $box; scroll = $sv; list = $sp; caption = $cap }
}

$tower = New-Column 'Agents'
[System.Windows.Controls.Grid]::SetColumn($tower.box, 0)
$body.Children.Add($tower.box) | Out-Null

$chatCol = New-Column 'Conversación'
$chatBorder = New-Object System.Windows.Controls.Border
$chatBorder.BorderBrush = New-Brush $C.linea; $chatBorder.BorderThickness = '1,0,0,0'; $chatBorder.Padding = '14,0,0,0'
$chatBorder.Child = $chatCol.box
[System.Windows.Controls.Grid]::SetColumn($chatBorder, 2)
$body.Children.Add($chatBorder) | Out-Null

# ── Pie: estado de la ronda / veredicto ──
$foot = New-Object System.Windows.Controls.Border
$foot.Margin = '16,10,16,14'; $foot.Padding = '0'; $foot.Background = New-Brush $C.panel
$footDock = New-Object System.Windows.Controls.DockPanel
$flag = New-Object System.Windows.Controls.Border
$flag.Width = 8; $flag.Background = New-Brush $C.rojo
[System.Windows.Controls.DockPanel]::SetDock($flag, 'Left')
$footText = New-Text 'Ronda en curso · los agents están probando la app' 13 $C.texto 'SemiBold' $TITULAR
$footText.Margin = '14,9,14,9'; $footText.TextWrapping = 'Wrap'
$footDock.Children.Add($flag) | Out-Null; $footDock.Children.Add($footText) | Out-Null
$foot.Child = $footDock
[System.Windows.Controls.Grid]::SetRow($foot, 2)
$root.Children.Add($foot) | Out-Null

$win.Content = $root

$script:people = [ordered]@{}
$script:pos = 0
$script:finished = $false
$script:left = $CloseAfter
$script:lastChange = Get-Date
$script:start = Get-Date
$script:active = $null

function New-Avatar($p, [double]$size) {
  $g = New-Object System.Windows.Controls.Grid
  $g.Width = $size; $g.Height = $size
  $e = New-Object System.Windows.Shapes.Ellipse
  if ($p.imagen -and (Test-Path $p.imagen)) {
    $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
    $bmp.BeginInit(); $bmp.UriSource = [Uri]$p.imagen; $bmp.CacheOption = 'OnLoad'; $bmp.DecodePixelWidth = [int]($size * 2); $bmp.EndInit()
    $ib = New-Object System.Windows.Media.ImageBrush $bmp
    $ib.Stretch = 'UniformToFill'
    $e.Fill = $ib
    $g.Children.Add($e) | Out-Null
  } else {
    $e.Fill = New-Brush $p.color
    $g.Children.Add($e) | Out-Null
    $ini = New-Text ([string]$p.nombre).Substring(0, 1).ToUpper() ($size * 0.45) '#ffffff' 'Bold' $TITULAR
    $ini.HorizontalAlignment = 'Center'
    $g.Children.Add($ini) | Out-Null
  }
  return $g
}

# Una fila compacta: posición | franja de color | foto | nombre / cargo / estado | nota
function New-Row($p) {
  $row = New-Object System.Windows.Controls.Border
  $row.Background = New-Brush $C.fila; $row.Margin = '0,0,0,3'; $row.Padding = '0,0,10,0'; $row.Height = 66
  $g = New-Object System.Windows.Controls.Grid
  foreach ($w in @(26, 4, 52, '*', 42)) {
    $cd = New-Object System.Windows.Controls.ColumnDefinition
    $cd.Width = if ($w -eq '*') { [System.Windows.GridLength]::new(1, 'Star') } elseif ($w -eq 'Auto') { [System.Windows.GridLength]::Auto } else { [System.Windows.GridLength]::new($w) }
    $g.ColumnDefinitions.Add($cd) | Out-Null
  }
  $pos = New-Text '' 15 $C.texto 'Bold' $TITULAR
  $pos.HorizontalAlignment = 'Center'
  $stripe = New-Object System.Windows.Shapes.Rectangle
  $stripe.Fill = New-Brush $p.color; $stripe.Margin = '0,8,0,8'
  $av = New-Avatar $p 44
  $av.HorizontalAlignment = 'Center'
  $names = New-Object System.Windows.Controls.StackPanel
  $names.VerticalAlignment = 'Center'
  $n = New-Text ([string]$p.nombre) 15 $C.texto 'Bold' $TITULAR
  $n.TextTrimming = 'CharacterEllipsis'
  $cg = New-Text ([string]$p.cargo) 10.5 $C.tenue
  $cg.TextTrimming = 'CharacterEllipsis'
  $st = New-Text 'Esperando' 11 $C.tenue 'SemiBold' $TITULAR
  $st.Margin = '0,1,0,0'; $st.TextTrimming = 'CharacterEllipsis'
  $names.Children.Add($n) | Out-Null; $names.Children.Add($cg) | Out-Null; $names.Children.Add($st) | Out-Null
  $nota = New-Text '—' 16 $C.tenue 'Bold' $TITULAR
  $nota.HorizontalAlignment = 'Right'
  $i = 0
  foreach ($el in @($pos, $stripe, $av, $names, $nota)) { [System.Windows.Controls.Grid]::SetColumn($el, $i); $g.Children.Add($el) | Out-Null; $i++ }
  $row.ToolTip = "$($p.nombre) · $($p.cargo)"
  $row.Child = $g
  return @{ row = $row; pos = $pos; status = $st; nota = $nota }
}

function Update-Tower {
  $tower.list.Children.Clear()
  $i = 1
  foreach ($id in $script:people.Keys) {
    $p = $script:people[$id]
    $p.ui.pos.Text = "$i"
    # Quien habla ahora: fila más clara y su número en rojo.
    $habla = $id -eq $script:active -and -not $script:finished
    $p.ui.row.Background = New-Brush $(if ($habla) { $C.filaActiva } else { $C.fila })
    $p.ui.pos.Foreground = New-Brush $(if ($habla) { $C.rojo } else { $C.texto })
    $tower.list.Children.Add($p.ui.row) | Out-Null
    $i++
  }
}

function Add-Message($id, [string]$text, [string]$when) {
  $p = $script:people[$id]
  $color = if ($p) { $p.info.color } else { $C.tenue }
  $name = if ($p) { [string]$p.info.nombre } else { "$id" }
  $atBottom = $chatCol.scroll.VerticalOffset -ge ($chatCol.scroll.ScrollableHeight - 24)
  $msg = New-Object System.Windows.Controls.DockPanel
  $msg.Margin = '0,0,0,12'
  if ($p) {
    $face = New-Avatar $p.info 30
    $face.VerticalAlignment = 'Top'; $face.Margin = '0,2,10,0'
    [System.Windows.Controls.DockPanel]::SetDock($face, 'Left')
    $msg.Children.Add($face) | Out-Null
  }
  $line = New-Object System.Windows.Controls.Border
  $line.BorderBrush = New-Brush $color; $line.BorderThickness = '2,0,0,0'; $line.Padding = '10,0,6,0'
  $sp = New-Object System.Windows.Controls.StackPanel
  $hdr = New-Object System.Windows.Controls.StackPanel
  $hdr.Orientation = 'Horizontal'
  $who = New-Text $name 12.5 $color 'Bold' $TITULAR
  $hora = New-Text $when 10.5 $C.tenue
  $hora.Margin = '8,0,0,0'
  $hdr.Children.Add($who) | Out-Null; $hdr.Children.Add($hora) | Out-Null
  $tb = New-Text $text 13.5 $C.texto
  $tb.TextWrapping = 'Wrap'; $tb.Margin = '0,2,0,0'; $tb.LineHeight = 19
  $sp.Children.Add($hdr) | Out-Null; $sp.Children.Add($tb) | Out-Null
  $line.Child = $sp
  $msg.Children.Add($line) | Out-Null
  $chatCol.list.Children.Add($msg) | Out-Null
  # Solo baja sola si el usuario no está leyendo más arriba.
  if ($atBottom) { $chatCol.scroll.ScrollToEnd() }
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

function Get-Hora($ev) {
  try { return ([datetime]$ev.t).ToLocalTime().ToString('HH:mm:ss') } catch { return (Get-Date).ToString('HH:mm:ss') }
}

function Handle($ev) {
  $script:lastChange = Get-Date
  switch ($ev.type) {
    'inicio' {
      $sub.Text = $ev.cambio
      if ($ev.titulo -match 'ronda\s+(\d+)') { $lap.Text = "Ronda $($Matches[1])" }
      if ($ev.titulo -match 'v(\d+\.\d+(\.\d+)?)') { $lap.Text = "v$($Matches[1])  ·  $($lap.Text)" }
      try { $script:start = ([datetime]$ev.t).ToLocalTime() } catch { $script:start = Get-Date }
      foreach ($p in $ev.personas) { $script:people[$p.id] = @{ info = $p; ui = (New-Row $p); nota = $null } }
      $tower.caption.Text = "Agents  ·  $($script:people.Count)"
      Update-Tower
    }
    'msg' {
      $p = $script:people[$ev.persona]
      if ($ev.estado -and $p) {
        $p.ui.status.Text = [string]$ev.estado
        $p.ui.status.Foreground = New-Brush (Get-EstadoColor $ev.estado)
      }
      $script:active = $ev.persona
      if ($ev.texto) { Add-Message $ev.persona $ev.texto (Get-Hora $ev) }
      Update-Tower
    }
    'fin' {
      $script:finished = $true
      try { $clock.Text = (([datetime]$ev.t).ToLocalTime() - $script:start).ToString('mm\:ss') } catch { }
      if ($ev.cancelada) {
        # Cerrada sin notas (otra ronda empezó o terminó el turno): se va pronto.
        $flag.Background = New-Brush $C.tenue
        $script:verdict = "Ronda cerrada  ·  $($ev.motivo)"
        $script:left = [math]::Min($script:left, 4)
        return
      }
      $best = ($ev.notas | ForEach-Object { [double]$_.nota } | Measure-Object -Maximum).Maximum
      foreach ($n in $ev.notas) {
        $p = $script:people[$n.persona]
        if (-not $p) { continue }
        $p.nota = [double]$n.nota
        $p.ui.nota.Text = ('{0:0.0}' -f [double]$n.nota)
        # Morado = la mejor nota; verde sobre el umbral; amarillo de 7 hasta el umbral; rojo bajo 7.
        $col = if ([double]$n.nota -eq $best) { $C.morado } elseif ([double]$n.nota -gt [double]$ev.umbral) { $C.verde } elseif ([double]$n.nota -ge 7) { $C.amarillo } else { $C.rojo }
        $p.ui.nota.Foreground = New-Brush $col
        if ($n.estado) { $p.ui.status.Text = [string]$n.estado; $p.ui.status.Foreground = New-Brush (Get-EstadoColor $n.estado) }
      }
      # Al cerrar, la lista se ordena por nota.
      $sorted = [ordered]@{}
      foreach ($k in ($script:people.Keys | Sort-Object { if ($null -eq $script:people[$_].nota) { -1 } else { $script:people[$_].nota } } -Descending)) { $sorted[$k] = $script:people[$k] }
      $script:people = $sorted
      Update-Tower
      $ok = [bool]$ev.aprobado
      $flag.Background = New-Brush $(if ($ok) { $C.verde } else { $C.rojo })
      $script:verdict = "$(if ($ok) { 'Aprobado' } else { 'No aprobado' })  ·  promedio $('{0:0.00}' -f [double]$ev.promedio) / 10  ·  umbral $('{0:0.00}' -f [double]$ev.umbral)"
    }
  }
}

$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(500)
$timer.Add_Tick({
  foreach ($line in (Read-NewLines)) {
    try { Handle ($line | ConvertFrom-Json) } catch { Add-Content -Path ($State + ".log") -Value ("$($_.Exception.Message) @ $($_.InvocationInfo.ScriptLineNumber)") }
  }
  if (-not $script:finished) {
    $clock.Text = ((Get-Date) - $script:start).ToString('mm\:ss')
    # Sin mensajes en 20 minutos, la ronda quedó huérfana: se cierra.
    if (((Get-Date) - $script:lastChange).TotalMinutes -gt 20) { $timer.Stop(); $win.Close() }
  } else {
    $footText.Text = "$($script:verdict)  ·  se cierra en $([math]::Ceiling($script:left)) s"
    $script:left -= 0.5
    if ($script:left -le 0) { $timer.Stop(); $win.Close() }
  }
})
$win.Add_ContentRendered({ $win.Activate() | Out-Null; $timer.Start() })
$win.ShowDialog() | Out-Null
