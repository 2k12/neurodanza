' Lanza un script de ventana del panel de personas sin mostrar consola (solo se ve la ventana WPF).
' Uso: wscript launch-hidden.vbs <script.ps1> [argumentos...]
Dim args, i, cmd
Set args = WScript.Arguments
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & args(0) & """"
For i = 1 To args.Count - 1
  cmd = cmd & " """ & args(i) & """"
Next
CreateObject("WScript.Shell").Run cmd, 0, False
