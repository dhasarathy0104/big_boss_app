// Same protocol as the JS agent's local listener: POST /url-event from the
// browser extension, GET /status for its popup. tiny_http instead of
// node:http, same behavior — sticky last-known domain, no time expiry.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tiny_http::{Header, Method, Response, Server};

#[derive(Clone)]
pub struct DomainState {
    pub domain: Option<String>,
    pub received_at: Instant,
}

pub type SharedDomain = Arc<Mutex<Option<DomainState>>>;

#[derive(Deserialize)]
struct UrlEventBody {
    domain: Option<String>,
}

#[derive(Serialize)]
struct StatusResponse {
    connected: bool,
    #[serde(rename = "enrolledAs")]
    enrolled_as: Option<String>,
    #[serde(rename = "receivingDomains")]
    receiving_domains: bool,
}

pub fn current_domain(state: &SharedDomain) -> Option<String> {
    state.lock().unwrap().as_ref().and_then(|d| d.domain.clone())
}

pub fn run(port: u16, state: SharedDomain, enrolled_name: Arc<Mutex<Option<String>>>) {
    let server = match Server::http(("127.0.0.1", port)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("local listener failed to start on port {port}: {e}");
            return;
        }
    };
    println!("Local listener for the browser extension on http://127.0.0.1:{port}");

    let cors_origin = Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
    let cors_methods = Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET, POST, OPTIONS"[..]).unwrap();
    let cors_headers = Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"content-type"[..]).unwrap();
    let content_type_json = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();

    for mut request in server.incoming_requests() {
        let url = request.url().to_string();
        let method = request.method().clone();

        let response_body = match (method.clone(), url.as_str()) {
            (Method::Options, _) => {
                let response = Response::empty(204)
                    .with_header(cors_origin.clone())
                    .with_header(cors_methods.clone())
                    .with_header(cors_headers.clone());
                let _ = request.respond(response);
                continue;
            }
            (Method::Get, "/status") => {
                let guard = state.lock().unwrap();
                let receiving_domains = guard
                    .as_ref()
                    .map(|d| d.received_at.elapsed().as_secs() < 300)
                    .unwrap_or(false);
                drop(guard);
                serde_json::to_string(&StatusResponse {
                    connected: true,
                    enrolled_as: enrolled_name.lock().unwrap().clone(),
                    receiving_domains,
                })
                .unwrap_or_else(|_| "{}".to_string())
            }
            (Method::Post, "/url-event") => {
                let mut body = String::new();
                let _ = request.as_reader().read_to_string(&mut body);
                match serde_json::from_str::<UrlEventBody>(&body) {
                    Ok(parsed) => {
                        *state.lock().unwrap() = Some(DomainState {
                            domain: parsed.domain,
                            received_at: Instant::now(),
                        });
                        r#"{"ok":true}"#.to_string()
                    }
                    Err(_) => r#"{"error":"invalid body"}"#.to_string(),
                }
            }
            _ => {
                let _ = request.respond(Response::empty(404));
                continue;
            }
        };

        let response = Response::from_string(response_body)
            .with_header(content_type_json.clone())
            .with_header(cors_origin.clone());
        let _ = request.respond(response);
    }
}
