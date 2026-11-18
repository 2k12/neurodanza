' Lanza un script de ventana del panel de personas sin mostrar consola (solo se ve la ventana WPF).
' Uso: wscript launch-hidden.vbs <script.ps1> [argumentos...]
' PowerShell corre dentro de `conhost --headless`: una consola que nunca se dibuja. Sin eso, en
' Windows 11 con Terminal como consola por defecto, puede asomar una ventana de Terminal antes de la WPF.
Dim args, i, cmd, shell, fso, conhost
Set args = WScript.Arguments
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
cmd = "powershell -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & args(0) & """"
For i = 1 To args.Count - 1
  cmd = cmd & " """ & args(i) & """"
Next
conhost = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\conhost.exe"
If fso.FileExists(conhost) Then cmd = """" & conhost & """ --headless " & cmd
shell.Run cmd, 0, False
