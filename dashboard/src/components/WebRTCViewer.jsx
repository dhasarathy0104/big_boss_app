import { useEffect, useRef, useState } from 'react';
import Modal from './Modal.jsx';

const POLL_MS = 1000;
const CONNECT_TIMEOUT_MS = 30_000;

// Direct peer-to-peer WebRTC viewer for "Watch Live" — the backend only ever
// relays the small SDP offer/answer exchange (see /api/live-sessions/*);
// once connected, screen frames flow straight from the employee's agent to
// this browser tab and are never stored anywhere.
export default function WebRTCViewer({ employeeId, employeeName, onClose }) {
  const [state, setState] = useState('connecting'); // connecting | live | failed
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    let pc = null;
    let sessionId = null;

    async function start() {
      try {
        const createRes = await fetch('/api/live-sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ employeeId }),
        });
        if (!createRes.ok || cancelled) { if (!cancelled) setState('failed'); return; }
        ({ sessionId } = await createRes.json());

        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

        pc.ondatachannel = (event) => {
          const channel = event.channel;
          channel.binaryType = 'arraybuffer';
          channel.onmessage = (e) => {
            if (cancelled) return;
            const url = URL.createObjectURL(new Blob([e.data], { type: 'image/jpeg' }));
            const img = new Image();
            img.onload = () => {
              const canvas = canvasRef.current;
              if (canvas) {
                if (canvas.width !== img.width) canvas.width = img.width;
                if (canvas.height !== img.height) canvas.height = img.height;
                canvas.getContext('2d').drawImage(img, 0, 0);
              }
              URL.revokeObjectURL(url);
            };
            img.src = url;
            setState((s) => (s === 'connecting' ? 'live' : s));
          };
        };

        pc.onconnectionstatechange = () => {
          if (!cancelled && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
            setState('failed');
          }
        };

        // Wait for the agent to pick up the request and post its offer.
        const deadline = Date.now() + CONNECT_TIMEOUT_MS;
        let offer = null;
        while (!cancelled && Date.now() < deadline) {
          const r = await fetch(`/api/live-sessions/${sessionId}`);
          if (!r.ok) { if (!cancelled) setState('failed'); return; }
          const session = await r.json();
          if (session.offer) { offer = session.offer; break; }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        if (cancelled) return;
        if (!offer) { setState('failed'); return; }

        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await new Promise((resolve) => {
          if (pc.iceGatheringState === 'complete') { resolve(); return; }
          const check = () => {
            if (pc.iceGatheringState === 'complete') {
              pc.removeEventListener('icegatheringstatechange', check);
              resolve();
            }
          };
          pc.addEventListener('icegatheringstatechange', check);
        });
        if (cancelled) return;

        await fetch(`/api/live-sessions/${sessionId}/answer`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sdp: pc.localDescription }),
        });
      } catch {
        if (!cancelled) setState('failed');
      }
    }

    start();

    return () => {
      cancelled = true;
      if (sessionId) fetch(`/api/live-sessions/${sessionId}/stop`, { method: 'POST' }).catch(() => {});
      pc?.close();
    };
  }, [employeeId]);

  return (
    <Modal title={`Watching ${employeeName}`} onClose={onClose} width={880}>
      <div className="live-viewer">
        {state === 'connecting' && <div className="empty">Connecting…</div>}
        {state === 'failed' && (
          <div className="empty">
            Connection failed. The employee may have gone offline, or their network blocked a direct connection.
          </div>
        )}
        <canvas ref={canvasRef} className="live-viewer-canvas" style={{ display: state === 'live' ? 'block' : 'none' }} />
        {state === 'live' && <div className="live-badge">🔴 LIVE</div>}
      </div>
      <div className="inline-form" style={{ marginTop: 14 }}>
        <button type="button" className="btn-outline-danger" onClick={onClose}>Stop Watching</button>
      </div>
    </Modal>
  );
}
