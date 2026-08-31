// Live-view: a manager/superadmin can ask to watch this employee's screen in
// real time. No recording, no storage — this only runs while someone is
// actually watching, and the video travels directly to their browser over a
// WebRTC peer connection, never through the backend (which only relays the
// small SDP offer/answer needed to set that connection up).
//
// This carries screen frames over a WebRTC *data channel* rather than an
// encoded video track: a real video track needs a hardware/software H264 or
// VP8 encoder, which on Windows means either linking a native codec library
// or writing Media Foundation COM interop — a much bigger effort than an MVP
// with one or two test employees justifies. A data channel just moves bytes,
// so this reuses the exact JPEG capture already built for periodic
// screenshots (see screenshot.rs), just called several times a second
// instead of once every few minutes, sent unreliable/unordered (a dropped or
// late frame should be skipped, not retransmitted and cause lag).

use crate::backend::{BackendClient, IceServerEntry};
use crate::screenshot::capture_primary_as_jpeg_bytes;
use bytes::Bytes;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::peer_connection_state::RTCPeerConnectionState;
use webrtc::peer_connection::RTCPeerConnection;

const POLL_FOR_REQUEST_SECS: u64 = 2;
const POLL_FOR_ANSWER_SECS: u64 = 1;
const FRAME_INTERVAL_MS: u64 = 150; // ~6-7 fps, matches the JPEG quality/size already used for screenshots
const SESSION_CHECK_EVERY_N_FRAMES: u32 = 20; // roughly every 3s at 150ms/frame
// Bounds the entire "set up the connection" phase (ICE gathering + waiting
// for the viewer's answer). Without this, a stuck ICE gathering step hung
// this task forever, and since the outer watch-loop treats "streaming" as
// busy until this task finishes, a single stuck connection used to
// permanently block every future watch request too.
const CONNECT_TIMEOUT_SECS: u64 = 25;

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
                    if let Err(e) = handle_session(agent_key, backend_url, session_id).await {
                        eprintln!("live session {sid} ended: {e}");
                    }
                    // However handle_session finished — success, error, or the
                    // connect-timeout below — this always runs, so a stuck or
                    // failed session can never permanently block the next one.
                    streaming.store(false, Ordering::Relaxed);
                });
            }
            Ok(None) => {}
            Err(e) => eprintln!("live-session poll failed: {e}"),
        }
    }
}

async fn handle_session(agent_key: String, backend_url: String, session_id: String) -> Result<(), String> {
    let client = BackendClient::new(backend_url);

    let setup = tokio::time::timeout(
        Duration::from_secs(CONNECT_TIMEOUT_SECS),
        negotiate(&client, &agent_key, &session_id),
    )
    .await;

    let (pc, dc, dc_open, failure) = match setup {
        Ok(Ok(parts)) => parts,
        Ok(Err(e)) => {
            client.post_live_error(&agent_key, &session_id, &e).await;
            return Err(e);
        }
        Err(_) => {
            let msg = format!(
                "connection setup timed out after {CONNECT_TIMEOUT_SECS}s — likely a network blocking the \
                 STUN/TURN traffic needed for a connection, not the one-time Windows Firewall prompt"
            );
            client.post_live_error(&agent_key, &session_id, &msg).await;
            return Err(msg);
        }
    };

    // Give the data channel a few seconds to actually open before the main
    // loop starts — no point burning CPU on frames nobody can receive yet.
    for _ in 0..50 {
        if dc_open.load(Ordering::Relaxed) || failure.lock().unwrap().is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    let mut frame_count: u32 = 0;
    let mut ended_by_error: Option<String> = None;
    loop {
        if let Some(reason) = failure.lock().unwrap().take() {
            ended_by_error = Some(reason);
            break;
        }

        if dc_open.load(Ordering::Relaxed) {
            match capture_primary_as_jpeg_bytes() {
                Ok(bytes) => {
                    let _ = dc.send(&Bytes::from(bytes)).await;
                }
                Err(e) => eprintln!("live frame capture failed: {e}"),
            }
        }

        frame_count += 1;
        if frame_count % SESSION_CHECK_EVERY_N_FRAMES == 0 {
            match client.get_live_session(&agent_key, &session_id).await {
                Ok(None) => break, // manager clicked Stop, or the session expired
                Ok(Some(_)) => {}
                Err(e) => eprintln!("live session check failed: {e}"),
            }
        }

        tokio::time::sleep(Duration::from_millis(FRAME_INTERVAL_MS)).await;
    }

    if let Some(reason) = ended_by_error {
        let message = format!("connection lost after connecting: {reason}");
        client.post_live_error(&agent_key, &session_id, &message).await;
    } else {
        // Normal end (manager clicked Stop) — the session is very likely
        // already gone server-side, so this is just a harmless no-op safety call.
        client.stop_live_session(&agent_key, &session_id).await;
    }
    let _ = pc.close().await;
    Ok(())
}

fn to_ice_servers(entries: Vec<IceServerEntry>) -> Vec<RTCIceServer> {
    let mut servers = vec![RTCIceServer { urls: vec!["stun:stun.l.google.com:19302".to_owned()], ..Default::default() }];
    for entry in entries {
        let has_credentials = entry.username.is_some() && entry.credential.is_some();
        servers.push(RTCIceServer {
            urls: vec![entry.urls],
            username: entry.username.unwrap_or_default(),
            credential: entry.credential.unwrap_or_default(),
            // RTCIceServer's credential_type defaults to Unspecified, which
            // the crate's own validation rejects for any turn:/turns: URL
            // with an "invalid turn server credentials" error — regardless
            // of whether the username/credential themselves are correct.
            // This was the actual root cause of every "invalid turn server
            // credentials" failure seen in testing; it never once reached
            // the network. STUN-only entries have no credentials and don't
            // need this (Unspecified is fine when there's nothing to check).
            credential_type: if has_credentials {
                webrtc::ice_transport::ice_credential_type::RTCIceCredentialType::Password
            } else {
                Default::default()
            },
        });
    }
    servers
}

// Everything from "build the peer connection" through "the viewer answered
// and we've applied it" — wrapped in the CONNECT_TIMEOUT_SECS timeout above,
// so nothing in here can hang the agent indefinitely no matter what the
// network does. Returns a shared `failure` slot the caller keeps checking
// during the frame loop: it's set (once) if the connection is lost *after*
// this function already returned successfully.
async fn negotiate(
    client: &BackendClient,
    agent_key: &str,
    session_id: &str,
) -> Result<(Arc<RTCPeerConnection>, Arc<RTCDataChannel>, Arc<AtomicBool>, Arc<Mutex<Option<String>>>), String> {
    let mut media_engine = MediaEngine::default();
    media_engine.register_default_codecs().map_err(|e| e.to_string())?;
    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut media_engine).map_err(|e| e.to_string())?;
    let api = APIBuilder::new().with_media_engine(media_engine).with_interceptor_registry(registry).build();

    // STUN plus a fresh TURN credential from our own backend (see
    // backend/src/turnCredentials.js) as a fallback — STUN alone only helps
    // two computers discover a direct path, which plenty of real networks
    // (especially office ones) simply don't allow. TURN is a relay both
    // sides connect *to* instead, and is the fix when a direct connection
    // can't be established at all. Falls back to STUN-only automatically if
    // the backend has no TURN provider configured.
    let turn_entries = client.get_turn_credentials(agent_key).await;
    let config = RTCConfiguration { ice_servers: to_ice_servers(turn_entries), ..Default::default() };
    let pc = Arc::new(api.new_peer_connection(config).await.map_err(|e| e.to_string())?);

    let failure: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    {
        let failure = failure.clone();
        pc.on_peer_connection_state_change(Box::new(move |state: RTCPeerConnectionState| {
            if matches!(
                state,
                RTCPeerConnectionState::Disconnected | RTCPeerConnectionState::Failed | RTCPeerConnectionState::Closed
            ) {
                let mut guard = failure.lock().unwrap();
                if guard.is_none() {
                    *guard = Some(format!("{state:?}"));
                }
            }
            Box::pin(async {})
        }));
    }

    let dc_init = RTCDataChannelInit { ordered: Some(false), max_retransmits: Some(0), ..Default::default() };
    let dc = pc.create_data_channel("screen", Some(dc_init)).await.map_err(|e| e.to_string())?;

    let dc_open = Arc::new(AtomicBool::new(false));
    {
        let dc_open = dc_open.clone();
        dc.on_open(Box::new(move || {
            dc_open.store(true, Ordering::Relaxed);
            Box::pin(async {})
        }));
    }

    // Vanilla (non-trickle) ICE: wait for gathering to finish, then send one
    // complete offer with every candidate already embedded. Simpler than a
    // separate trickle-ICE relay endpoint, at the cost of a second or two of
    // extra setup latency — fine for a "click watch, wait briefly" MVP.
    let offer = pc.create_offer(None).await.map_err(|e| e.to_string())?;
    let mut gather_complete = pc.gathering_complete_promise().await;
    pc.set_local_description(offer).await.map_err(|e| e.to_string())?;
    let _ = gather_complete.recv().await;
    let local_desc = pc.local_description().await.ok_or("no local description after ICE gathering")?;

    client.post_live_offer(agent_key, session_id, &local_desc).await?;

    let answer = loop {
        match client.get_live_session(agent_key, session_id).await? {
            None => return Err("session stopped before the viewer answered".to_string()),
            Some(session) => {
                if let Some(answer) = session.answer {
                    break answer;
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(POLL_FOR_ANSWER_SECS)).await;
    };
    pc.set_remote_description(answer).await.map_err(|e| e.to_string())?;

    Ok((pc, dc, dc_open, failure))
}
