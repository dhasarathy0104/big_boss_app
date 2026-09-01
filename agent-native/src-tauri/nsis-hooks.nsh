; Pre-authorizes the agent for network access during (elevated) install,
; instead of Windows only asking the first time it connects. Only an
; outbound rule is needed: the agent only ever *initiates* connections to
; the backend (activity/screenshot uploads, settings polling, and the
; live-view WebSocket relay) and never has to accept anything incoming.
; An inbound rule was needed here for the earlier peer-to-peer WebRTC
; design (the employee's PC had to accept a connection from the manager's
; browser) — that's gone now that live-view is relayed through the backend
; (see backend/src/liveRelay.js), so keeping it around would just be
; needless attack surface for no remaining benefit.
!macro NSIS_HOOK_POSTINSTALL
  ; Removes any inbound rule left behind by an in-place upgrade from an
  ; older version that still added one (dir=in isn't specified here, so
  ; this clears every existing rule under this name, inbound or outbound,
  ; before the one line below re-adds just the outbound rule this version
  ; actually needs). Harmless no-op on a fresh install with nothing to remove.
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="BIG BOSS Agent"'
  Pop $0
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall add rule name="BIG BOSS Agent" dir=out action=allow program="$INSTDIR\desklog-agent.exe" enable=yes profile=any'
  Pop $0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  nsExec::ExecToLog '"$SYSDIR\netsh.exe" advfirewall firewall delete rule name="BIG BOSS Agent"'
  Pop $0
!macroend
