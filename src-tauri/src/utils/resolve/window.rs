use dark_light::{Mode as SystemTheme, detect as detect_system_theme};
use tauri::utils::config::Color;
use tauri::{LogicalSize, Size, Theme, WebviewWindow};

use crate::{config::Config, core::handle, utils::resolve::window_script::build_window_initial_script};
use clash_verge_logging::{Type, logging_error};

const DARK_BACKGROUND_COLOR: Color = Color(46, 48, 61, 255);
const LIGHT_BACKGROUND_COLOR: Color = Color(245, 245, 245, 255);
const DARK_BACKGROUND_HEX: &str = "#2E303D";
const LIGHT_BACKGROUND_HEX: &str = "#F5F5F5";

const DEFAULT_WIDTH: f64 = 800.0;
const DEFAULT_HEIGHT: f64 = 580.0;

#[cfg(target_os = "linux")]
const DEFAULT_DECORATIONS: bool = false;
#[cfg(not(target_os = "linux"))]
const DEFAULT_DECORATIONS: bool = true;

pub fn apply_fixed_startup_window_size(window: &WebviewWindow) -> tauri::Result<()> {
    apply_fixed_window_size(window)?;
    window.center()?;
    Ok(())
}

pub fn apply_fixed_window_size(window: &WebviewWindow) -> tauri::Result<()> {
    let fixed_size = Size::Logical(LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    window.set_size(fixed_size.clone())?;
    window.set_min_size(Some(fixed_size.clone()))?;
    window.set_max_size(Some(fixed_size))?;
    normalize_windows_webview_scale(window)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn normalize_windows_webview_scale(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_zoom(get_windows_webview_zoom())
}

#[cfg(not(target_os = "windows"))]
fn normalize_windows_webview_scale(_: &WebviewWindow) -> tauri::Result<()> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn get_windows_webview_zoom() -> f64 {
    use winreg::{RegKey, enums::HKEY_CURRENT_USER};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let factor = hkcu
        .open_subkey("SOFTWARE\\Microsoft\\Accessibility")
        .ok()
        .and_then(|key| key.get_value::<u32, _>("TextScaleFactor").ok())
        .unwrap_or(100);

    let normalized = factor.clamp(100, 225) as f64 / 100.0;
    (1.0 / normalized).clamp(0.44, 1.0)
}

pub async fn build_new_window() -> Result<WebviewWindow, String> {
    let app_handle = handle::Handle::app_handle();

    let config = Config::verge().await;
    let latest = config.latest_arc();
    let start_page = latest.start_page.as_deref().unwrap_or("/");
    let initial_theme_mode = match latest.theme_mode.as_deref() {
        Some("dark") => "dark",
        Some("light") => "light",
        _ => "system",
    };

    let resolved_theme = match initial_theme_mode {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        _ => None,
    };

    let prefers_dark_background = match resolved_theme {
        Some(Theme::Dark) => true,
        Some(Theme::Light) => false,
        _ => !matches!(detect_system_theme().ok(), Some(SystemTheme::Light)),
    };

    let background_color = if prefers_dark_background {
        DARK_BACKGROUND_COLOR
    } else {
        LIGHT_BACKGROUND_COLOR
    };

    let initial_script = build_window_initial_script(initial_theme_mode, DARK_BACKGROUND_HEX, LIGHT_BACKGROUND_HEX);

    let mut builder = tauri::WebviewWindowBuilder::new(app_handle, "main", tauri::WebviewUrl::App(start_page.into()))
        .title("Bluelayer 加速器")
        .center()
        .decorations(DEFAULT_DECORATIONS)
        .fullscreen(false)
        .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .min_inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .max_inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .resizable(false)
        .visible(true)
        .initialization_script(&initial_script);

    if let Some(theme) = resolved_theme {
        builder = builder.theme(Some(theme));
    }

    builder = builder.background_color(background_color);

    match builder.build() {
        Ok(window) => {
            logging_error!(Type::Window, apply_fixed_startup_window_size(&window));
            logging_error!(Type::Window, window.set_resizable(false));
            logging_error!(Type::Window, window.set_background_color(Some(background_color)));
            Ok(window)
        }
        Err(e) => Err(e.to_string()),
    }
}
