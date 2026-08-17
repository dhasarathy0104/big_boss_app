// Native replacement for the PowerShell get-context.ps1 script — same job,
// direct Win32 calls instead of shelling out.

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND};
use windows::Win32::System::ProcessStatus::K32GetModuleBaseNameW;
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

#[derive(Debug, Clone)]
pub struct WindowContext {
    pub title: String,
    pub process: String,
    pub idle_seconds: u32,
}

fn foreground_title(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

fn process_name_for(hwnd: HWND) -> String {
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid == 0 {
        return String::new();
    }

    let handle: HANDLE = match unsafe {
        OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, false, pid)
    } {
        Ok(h) => h,
        Err(_) => return String::new(),
    };

    let mut buf = [0u16; 260];
    let len = unsafe { K32GetModuleBaseNameW(handle, None, &mut buf) };
    unsafe { let _ = CloseHandle(handle); };

    if len == 0 {
        return String::new();
    }
    // Some Win32 APIs return a length that includes the null terminator, which would
    // otherwise leave a trailing '\0' and break the exact ".exe" suffix match below.
    let name = String::from_utf16_lossy(&buf[..len as usize]);
    let trimmed = name.trim_end_matches('\0').to_lowercase();
    trimmed.trim_end_matches(".exe").to_string()
}

fn idle_seconds() -> u32 {
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    let ok = unsafe { GetLastInputInfo(&mut info) };
    if ok.as_bool() == false {
        return 0;
    }
    let now = unsafe { GetTickCount() };
    now.saturating_sub(info.dwTime) / 1000
}

pub fn get_context() -> WindowContext {
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.0.is_null() {
        return WindowContext { title: String::new(), process: String::new(), idle_seconds: idle_seconds() };
    }
    WindowContext {
        title: foreground_title(hwnd),
        process: process_name_for(hwnd),
        idle_seconds: idle_seconds(),
    }
}

// PWSTR is unused directly (GetWindowTextW takes &mut [u16] via windows-rs's slice overload)
// but kept imported for clarity on the underlying FFI shape.
#[allow(dead_code)]
fn _unused(_: PWSTR) {}
