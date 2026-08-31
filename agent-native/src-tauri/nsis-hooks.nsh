; Pre-authorizes the agent for network access during (elevated) install,
; instead of Windows only asking the first time "Watch Live" runs. This is
; the standard technique desktop apps that do peer-to-peer networking
; (Zoom, Discord, etc.) use — install with the extra privilege needed to add
; a firewall rule, so the one-time runtime prompt never has to happen at all.
!macro NSIS_HOOK_POSTINSTALL
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="BIG BOSS Agent" dir=in action=allow program="$INSTDIR\desklog-agent.exe" enable=yes profile=any'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="BIG BOSS Agent" dir=out action=allow program="$INSTDIR\desklog-agent.exe" enable=yes profile=any'
  Pop $0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="BIG BOSS Agent"'
  Pop $0
!macroend
