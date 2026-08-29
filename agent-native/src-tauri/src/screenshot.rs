// Native replacement for screenshot.ps1 — capture the primary monitor,
// downscale, encode as JPEG, return base64 for the same ingest payload shape
// the JS agent already used.

use base64::Engine;
use image::imageops::FilterType;
use std::io::Cursor;
use xcap::Monitor;

const MAX_WIDTH: u32 = 1280;
const JPEG_QUALITY: u8 = 65;

// Shared by the periodic screenshot uploader (base64-in-JSON, see below) and
// the live-view data channel (raw bytes, no base64 — see livestream.rs),
// which sends far more frequently and can't afford the ~33% size and CPU
// overhead of base64 on every frame.
pub fn capture_primary_as_jpeg_bytes() -> Result<Vec<u8>, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .into_iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .ok_or_else(|| "no primary monitor found".to_string())?;

    let image = monitor.capture_image().map_err(|e| e.to_string())?;
    let dynamic = image::DynamicImage::ImageRgba8(image);

    let resized = if dynamic.width() > MAX_WIDTH {
        let scale = MAX_WIDTH as f32 / dynamic.width() as f32;
        let new_height = (dynamic.height() as f32 * scale) as u32;
        dynamic.resize(MAX_WIDTH, new_height, FilterType::Lanczos3)
    } else {
        dynamic
    };

    let mut bytes: Vec<u8> = Vec::new();
    let mut cursor = Cursor::new(&mut bytes);
    let rgb = resized.to_rgb8();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut cursor, JPEG_QUALITY);
    rgb.write_with_encoder(encoder).map_err(|e| e.to_string())?;

    Ok(bytes)
}

pub fn capture_primary_as_base64_jpeg() -> Result<String, String> {
    let bytes = capture_primary_as_jpeg_bytes()?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}
