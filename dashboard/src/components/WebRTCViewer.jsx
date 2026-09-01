import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';
import Modal from './Modal.jsx';
import { getToken } from '../api.js';

// "Watch Live" viewer — connects to the backend's relay WebSocket (see
// backend/src/liveRelay.js) rather than a peer-to-peer WebRTC connection.
// The employee's agent sends the same JPEG frames over its own WebSocket to
// that same relay, which forwards them straight through to this one. No
// STUN/TURN/ICE involved, since neither side needs to reach the other
// directly — both just need to reach this backend, which they already do
// for everything else.
export default function WebRTCViewer({ employeeId, employeeName, onClose }) {
  const [state, setState] = useState('connecting'); // connecting | live | failed
  const [errorMessage, setErrorMessage] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === viewerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      viewerRef.current?.requestFullscreen();
    }
  }

  useEffect(() => {
    let cancelled = false;
    let ws = null;
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
        if (cancelled) return;

        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const token = getToken();
        ws = new WebSocket(
          `${wsProtocol}//${window.location.host}/live-ws?sessionId=${sessionId}&role=viewer&token=${encodeURIComponent(token)}`
        );
        ws.binaryType = 'arraybuffer';

        ws.onmessage = (event) => {
          if (cancelled) return;
          if (typeof event.data === 'string') {
            const msg = JSON.parse(event.data);
            if (msg.type === 'error') { setErrorMessage(msg.message); setState('failed'); }
            return;
          }
          const url = URL.createObjectURL(new Blob([event.data], { type: 'image/jpeg' }));
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

        ws.onclose = () => {
          if (cancelled) return;
          setState('failed');
        };
      } catch {
        if (!cancelled) setState('failed');
      }
    }

    start();

    return () => {
      cancelled = true;
      if (sessionId) fetch(`/api/live-sessions/${sessionId}/stop`, { method: 'POST' }).catch(() => {});
      ws?.close();
    };
  }, [employeeId]);

  return (
    <Modal title={`Watching ${employeeName}`} onClose={onClose} width={880}>
      <div className="live-viewer" ref={viewerRef}>
        {state === 'connecting' && <div className="empty">Connecting…</div>}
        {state === 'failed' && (
          <div className="empty">
            {errorMessage || 'Connection failed. The employee may have gone offline, or their network blocked a direct connection.'}
          </div>
        )}
        <canvas ref={canvasRef} className="live-viewer-canvas" style={{ display: state === 'live' ? 'block' : 'none' }} />
        {state === 'live' && <div className="live-badge">🔴 LIVE</div>}
        {state === 'live' && (
          <button
            type="button"
            className="live-fullscreen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit full screen' : 'Full screen'}
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        )}
      </div>
      <div className="inline-form" style={{ marginTop: 14 }}>
        <button type="button" className="btn-outline-danger" onClick={onClose}>Stop Watching</button>
      </div>
    </Modal>
  );
}
