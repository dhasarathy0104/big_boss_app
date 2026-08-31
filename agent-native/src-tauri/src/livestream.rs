// Live-view: a manager/superadmin can ask to watch this employee's screen in
// real time. No recording, no storage — this only runs while someone is
// actually watching, and screen frames flow through the backend's WebSocket
// relay (see backend/src/liveRelay.js), which forwards them straight through
// to the viewer's browser without ever writing them to disk or a database.
//
// This used to be a genuine peer-to-peer WebRTC connection, with the backend
// only relaying the SDP offer/answer handshake. That approach kept failing
// in ways that took days to diagnose — a wrong TURN server hostname, then
// ICE connectivity checks that hung forever with no error at all — because
// a direct connection depends on the specifics of whatever network the
// employee and manager each happen to be on. Relaying every frame through
// this same backend (which both sides already reach reliably for every
// other feature: activity events, screenshots, settings) sidesteps NAT
// traversal entirely, at the cost of the frames technically passing through
// a server in transit. For an MVP watching 1-2 people at a time, that
// trade is worth it.

use crate::backend::BackendClient;
use crate::screenshot::capture_primary_as_jpeg_bytes;
use futures_util::{SinkExt, StreamExt};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

const POLL_FOR_REQUEST_SECS: u64 = 2;
const FRAME_INTERVAL_MS: u64 = 150; // ~6-7 fps, matches the JPEG quality/size already used for screenshots
// Bounds only the initial relay connection — once connected, the relay
// itself is what decides when to give up (see AGENT_CONNECT_TIMEOUT_MS in
// liveRelay.js) and closes the socket, which this loop just needs to notice.
const CONNECT_TIMEOUT_SECS: u64 = 15;

// Runs for the lifetime of the agent, alongside the activity/screenshot
// loops. Costs one small HTTP request every couple of seconds while idle;
// only starts capturing frames once a manager/superadmin actually connects.
pub async fn run_watch_loop(agent_key: String, backend_url: String) {
    let streaming = Arc::new(AtomicBool::new(false));

    loop {
        tokio::time::sleep(Duration::from_secs(POLL_FOR_REQUEST_SECS)).await;

        // One session at a time per employee for the MVP — a second
        // "Watch Live" click while already streaming just waits its turn
        // (the pending request stays queued server-side until this one ends).
        if streaming.load(Ordering::Relaxed) {
            continue;
        }

        let poll_client = BackendClient::new(backend_url.clone());
        match poll_client.poll_live_session_request(&agent_key).await {
            Ok(Some(session_id)) => {
                streaming.store(true, Ordering::Relaxed);
                let agent_key = agent_key.clone();
                let backend_url = backend_url.clone();
                let streaming = streaming.clone();
                tokio::spawn(async move {
                    let sid = session_id.clone();
                    if let Err(e) = handle_session(&agent_key, &backend_url, &session_id).await {
                        eprintln!("live session {sid} ended: {e}");
                    }
                    streaming.store(false, Ordering::Relaxed);
                });
            }
            Ok(None) => {}
            Err(e) => eprintln!("live-session poll failed: {e}"),
        }
    }
}

fn relay_ws_url(backend_url: &str, session_id: &str, agent_key: &str) -> String {
    let ws_base = if let Some(rest) = backend_url.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = backend_url.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        format!("ws://{backend_url}")
    };
    format!("{ws_base}/live-ws?sessionId={session_id}&role=agent&key={agent_key}")
}

async fn handle_session(agent_key: &str, backend_url: &str, session_id: &str) -> Result<(), String> {
    let url = relay_ws_url(backend_url, session_id, agent_key);

    let connect = tokio::time::timeout(
        Duration::from_secs(CONNECT_TIMEOUT_SECS),
        tokio_tungstenite::connect_async(url),
    )
    .await;
    let (ws_stream, _) = match connect {
        Ok(Ok(pair)) => pair,
        Ok(Err(e)) => return Err(format!("relay connection failed: {e}")),
        Err(_) => return Err(format!("relay connection timed out after {CONNECT_TIMEOUT_SECS}s")),
    };

    let (mut write, mut read) = ws_stream.split();

    // The relay closes this socket itself when the viewer stops watching, or
    // when nobody ever attached on the viewer's side — either way, this
    // loop just needs to notice the socket closed and stop capturing. No
    // polling, no separate "stop" call needed.
    let closed = Arc::new(AtomicBool::new(false));
    let closed_reader = closed.clone();
    tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Close(_)) => break,
                Err(_) => break,
                _ => {}
            }
        }
        closed_reader.store(true, Ordering::Relaxed);
    });

    while !closed.load(Ordering::Relaxed) {
        match capture_primary_as_jpeg_bytes() {
            Ok(bytes) => {
                if write.send(Message::Binary(bytes)).await.is_err() {
                    break;
                }
            }
            Err(e) => eprintln!("live frame capture failed: {e}"),
        }
        tokio::time::sleep(Duration::from_millis(FRAME_INTERVAL_MS)).await;
    }

    let _ = write.close().await;
    Ok(())
}
