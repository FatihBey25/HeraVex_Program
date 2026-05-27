Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\START_STUDIO_HUB.ps1"""
shell.Run command, 0, False
