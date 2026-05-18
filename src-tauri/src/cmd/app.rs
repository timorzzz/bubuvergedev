use super::CmdResult;
use crate::config::{decrypt_data, encrypt_data};
use crate::core::autostart;
use crate::{cmd::StringifyErr as _, feat, utils::dirs};
use clash_verge_logging::{Type, logging};
use nanoid::nanoid;
use serde_json::json;
use smartstring::alias::String;
use std::collections::HashMap;
use std::string::String as StdString;
use std::sync::mpsc::sync_channel;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;
use sysproxy::Sysproxy;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Listener as _, Manager as _, WebviewUrl, WebviewWindowBuilder};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BluelayerHttpRequest {
    url: StdString,
    method: Option<StdString>,
    headers: Option<HashMap<StdString, StdString>>,
    body: Option<StdString>,
    timeout: Option<u64>,
    proxy_strategy: Option<StdString>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BluelayerHttpResponse {
    status: u16,
    headers: Vec<(StdString, StdString)>,
    text: StdString,
}

#[tauri::command]
pub async fn bluelayer_http_text(request: BluelayerHttpRequest) -> CmdResult<BluelayerHttpResponse> {
    let timeout_ms = request.timeout.unwrap_or(12_000).clamp(1_000, 120_000);
    let timeout = Duration::from_millis(timeout_ms);
    let url = reqwest::Url::parse(&request.url).stringify_err()?;

    if !matches!(url.scheme(), "http" | "https") {
        return Err("unsupported url scheme".into());
    }

    let method = request
        .method
        .as_deref()
        .unwrap_or("GET")
        .parse::<reqwest::Method>()
        .stringify_err()?;

    let strategy = request
        .proxy_strategy
        .as_deref()
        .unwrap_or("directThenSystem")
        .to_ascii_lowercase();

    match strategy.as_str() {
        "direct" => send_bluelayer_http_request(&request, &method, &url, timeout, None).await,
        "system" => {
            let proxy_url = read_system_proxy_url();
            send_bluelayer_http_request(&request, &method, &url, timeout, proxy_url.as_deref()).await
        }
        _ => match send_bluelayer_http_request(&request, &method, &url, timeout, None).await {
            Ok(response) => Ok(response),
            Err(direct_err) => {
                let Some(proxy_url) = read_system_proxy_url() else {
                    return Err(direct_err);
                };
                match send_bluelayer_http_request(&request, &method, &url, timeout, Some(proxy_url.as_str())).await {
                    Ok(response) => Ok(response),
                    Err(system_err) => Err(format!("{direct_err}; system proxy retry failed: {system_err}").into()),
                }
            }
        },
    }
}

fn read_system_proxy_url() -> Option<StdString> {
    let proxy = Sysproxy::get_system_proxy().ok()?;
    if !proxy.enable {
        return None;
    }
    Some(format!("http://{}:{}", proxy.host, proxy.port))
}

async fn send_bluelayer_http_request(
    request: &BluelayerHttpRequest,
    method: &reqwest::Method,
    url: &reqwest::Url,
    timeout: Duration,
    proxy_url: Option<&str>,
) -> CmdResult<BluelayerHttpResponse> {
    let mut client_builder = reqwest::Client::builder()
        .use_rustls_tls()
        .no_proxy()
        .connect_timeout(timeout)
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent(format!("Bluelayer/{}", env!("CARGO_PKG_VERSION")));

    if let Some(proxy_url) = proxy_url {
        client_builder = client_builder.proxy(reqwest::Proxy::all(proxy_url).stringify_err()?);
    }

    let client = client_builder.build().stringify_err()?;

    let mut builder = client.request(method.clone(), url.clone());

    if let Some(headers) = request.headers.as_ref() {
        for (key, value) in headers {
            builder = builder.header(key.as_str(), value.as_str());
        }
    }

    if let Some(body) = request.body.as_ref() {
        builder = builder.body(body.to_string());
    }

    let response = builder.send().await.stringify_err()?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(key, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (key.as_str().to_string(), value.to_string()))
        })
        .collect();
    let text = response.text().await.stringify_err()?;

    Ok(BluelayerHttpResponse { status, headers, text })
}

#[tauri::command]
pub async fn open_app_dir() -> CmdResult<()> {
    let app_dir = dirs::app_home_dir().stringify_err()?;
    open::that(app_dir).stringify_err()
}

#[tauri::command]
pub async fn open_core_dir() -> CmdResult<()> {
    let core_dir = tauri::utils::platform::current_exe().stringify_err()?;
    let core_dir = core_dir.parent().ok_or("failed to get core dir")?;
    open::that(core_dir).stringify_err()
}

#[tauri::command]
pub async fn open_logs_dir() -> CmdResult<()> {
    let log_dir = dirs::app_logs_dir().stringify_err()?;
    open::that(log_dir).stringify_err()
}

#[tauri::command]
pub fn open_web_url(url: String) -> CmdResult<()> {
    open::that(url.as_str()).stringify_err()
}

#[tauri::command]
pub fn encrypt_local_data(data: String) -> CmdResult<String> {
    Ok(encrypt_data(data.as_str()).stringify_err()?.into())
}

#[tauri::command]
pub fn decrypt_local_data(payload: String) -> CmdResult<String> {
    Ok(decrypt_data(payload.as_str()).stringify_err()?.into())
}

#[tauri::command]
pub async fn open_bluelayer_panel_window(
    app_handle: AppHandle,
    url: String,
    title: Option<String>,
    cookie: Option<String>,
) -> CmdResult<()> {
    let (tx, rx) = sync_channel(1);
    let (shown_tx, shown_rx) = sync_channel::<CmdResult<()>>(1);
    let app_handle_for_window = app_handle.clone();
    logging!(info, Type::Cmd, "[PanelWindow] dispatch create request to main thread");
    app_handle
        .run_on_main_thread(move || {
            let result = create_bluelayer_panel_window(&app_handle_for_window, url, title, cookie, shown_tx);
            let _ = tx.send(result);
        })
        .stringify_err()?;
    let result = rx.recv().map_err(|err| String::from(err.to_string()))?;
    result?;
    shown_rx
        .recv_timeout(Duration::from_secs(30))
        .map_err(|err| String::from(err.to_string()))?
}

fn create_bluelayer_panel_window(
    app_handle: &AppHandle,
    url: String,
    title: Option<String>,
    cookie: Option<String>,
    shown_tx: std::sync::mpsc::SyncSender<CmdResult<()>>,
) -> CmdResult<()> {
    let title = title.unwrap_or_else(|| "Bluelayer".into());
    let parsed_url = tauri::Url::parse(url.as_str()).stringify_err()?;
    let label = format!("bluelayer-panel-{}", nanoid!(8));
    let injected = Arc::new(AtomicBool::new(false));
    let ready_to_show = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = sync_channel::<()>(1);
    logging!(
        info,
        Type::Cmd,
        "[PanelWindow] start create label={}, title={}, url={}, has_cookie={}",
        label,
        title,
        parsed_url,
        cookie.as_ref().is_some_and(|value| !value.trim().is_empty())
    );

    let mut builder = WebviewWindowBuilder::new(app_handle, &label, WebviewUrl::App("index.html".into()))
        .title(title.clone())
        .inner_size(1180.0, 820.0)
        .min_inner_size(960.0, 680.0)
        .visible(false)
        .disable_drag_drop_handler()
        .resizable(true)
        .closable(true)
        .minimizable(true)
        .maximizable(true)
        .decorations(true)
        .focused(true)
        .center();

    let cookie_pairs: Vec<String> = cookie
        .unwrap_or_default()
        .split(';')
        .map(|item| item.trim())
        .filter(|item| !item.is_empty() && item.contains('='))
        .map(|item| item.to_string().into())
        .collect();

    logging!(
        info,
        Type::Cmd,
        "[PanelWindow] parsed cookie pairs count={}",
        cookie_pairs.len()
    );

    let target_origin = parsed_url.origin().ascii_serialization();
    let cookie_pairs_json = json!(cookie_pairs).to_string();
    let injected_flag = injected;
    let ready_flag = ready_to_show;
    let panel_label = label.clone();
    let target_origin_for_log = target_origin.clone();
    let has_cookie_pairs = !cookie_pairs.is_empty();

    if !has_cookie_pairs {
        logging!(info, Type::Cmd, "[PanelWindow] no cookies to inject for this window");
    }

    builder = builder.on_page_load(move |window, payload| {
        logging!(
            info,
            Type::Cmd,
            "[PanelWindow] page load label={}, event={:?}, url={}",
            panel_label,
            payload.event(),
            payload.url()
        );

        if payload.event() != PageLoadEvent::Finished {
            return;
        }

        let current_origin = payload.url().origin().ascii_serialization();
        if current_origin != target_origin {
            logging!(
                warn,
                Type::Cmd,
                "[PanelWindow] skip page event label={}, current_origin={}, target_origin={}",
                panel_label,
                current_origin,
                target_origin_for_log
            );
            return;
        }

        if has_cookie_pairs && !injected_flag.swap(true, Ordering::SeqCst) {
            let script = format!(
                r#"
(() => {{
  try {{
    const cookiePairs = {cookie_pairs};
    const secureSuffix = window.location.protocol === "https:" ? "; Secure" : "";
    for (const pair of cookiePairs) {{
      if (!pair || !pair.includes("=")) continue;
      document.cookie = `${{pair}}; path=/; SameSite=Lax${{secureSuffix}}`;
    }}
    window.location.reload();
  }} catch (_error) {{}}
}})();
"#,
                cookie_pairs = cookie_pairs_json,
            );

            logging!(
                info,
                Type::Cmd,
                "[PanelWindow] injecting cookies label={}, origin={}",
                panel_label,
                current_origin
            );

            if let Err(err) = window.eval(script) {
                logging!(
                    error,
                    Type::Cmd,
                    "[PanelWindow] eval failed label={}, error={}",
                    panel_label,
                    err
                );
            } else {
                logging!(info, Type::Cmd, "[PanelWindow] eval success label={}", panel_label);
            }
            return;
        }

        if !ready_flag.swap(true, Ordering::SeqCst) {
            logging!(
                info,
                Type::Cmd,
                "[PanelWindow] panel ready to show label={}",
                panel_label
            );
            let _ = ready_tx.send(());
        }
    });

    logging!(info, Type::Cmd, "[PanelWindow] building window label={}", label);
    let window = builder.build().stringify_err()?;
    logging!(
        info,
        Type::Cmd,
        "[PanelWindow] window built label={}, title={}",
        window.label(),
        title
    );

    let close_window = window.clone();
    let close_label = close_window.label().to_string();
    let close_handler_id = window.listen("tauri://close-requested", move |_event| {
        logging!(info, Type::Cmd, "[PanelWindow] close requested label={}", close_label);
        if let Err(err) = close_window.destroy() {
            logging!(
                error,
                Type::Cmd,
                "[PanelWindow] destroy failed after close request label={}, error={}",
                close_label,
                err
            );
        } else {
            logging!(info, Type::Cmd, "[PanelWindow] destroy success label={}", close_label);
        }
    });
    logging!(
        info,
        Type::Cmd,
        "[PanelWindow] close listener attached label={}, handler_id={}",
        window.label(),
        close_handler_id
    );

    logging!(
        info,
        Type::Cmd,
        "[PanelWindow] navigating label={}, url={}",
        window.label(),
        parsed_url
    );
    window.navigate(parsed_url).stringify_err()?;
    logging!(
        info,
        Type::Cmd,
        "[PanelWindow] navigate issued label={}",
        window.label()
    );

    let show_label = window.label().to_string();
    let show_app_handle = app_handle.clone();
    std::thread::spawn(move || {
        match ready_rx.recv_timeout(Duration::from_secs(18)) {
            Ok(_) => logging!(
                info,
                Type::Cmd,
                "[PanelWindow] ready signal received label={}",
                show_label
            ),
            Err(err) => logging!(
                warn,
                Type::Cmd,
                "[PanelWindow] ready wait timeout label={}, err={}",
                show_label,
                err
            ),
        }

        let reveal_delay = if has_cookie_pairs { 2200 } else { 300 };
        logging!(
            info,
            Type::Cmd,
            "[PanelWindow] delay showing window label={}, delay_ms={}",
            show_label,
            reveal_delay
        );
        std::thread::sleep(Duration::from_millis(reveal_delay));

        let app_handle_for_show = show_app_handle.clone();
        let label_for_show = show_label.clone();
        let (show_tx, show_rx) = sync_channel::<CmdResult<()>>(1);
        let show_result = show_app_handle
            .run_on_main_thread(move || {
                let result: CmdResult<()> = (|| {
                    let Some(window) = app_handle_for_show.get_webview_window(&label_for_show) else {
                        return Err(String::from("panel window not found"));
                    };

                    window.show().stringify_err()?;
                    logging!(info, Type::Cmd, "[PanelWindow] window shown label={}", window.label());
                    window.set_focus().stringify_err()?;
                    logging!(info, Type::Cmd, "[PanelWindow] window focused label={}", window.label());
                    Ok(())
                })();

                let _ = show_tx.send(result);
            })
            .map_err(|err| String::from(err.to_string()))
            .and_then(|_| show_rx.recv().map_err(|err| String::from(err.to_string()))?);

        let _ = shown_tx.send(show_result);
    });

    Ok(())
}

#[tauri::command]
pub async fn open_app_log() -> CmdResult<()> {
    let log_path = dirs::app_latest_log().stringify_err()?;
    #[cfg(target_os = "windows")]
    let log_path = crate::utils::help::snapshot_path(&log_path).stringify_err()?;
    open::that(log_path).stringify_err()
}

#[tauri::command]
pub async fn open_core_log() -> CmdResult<()> {
    let log_path = dirs::clash_latest_log().stringify_err()?;
    #[cfg(target_os = "windows")]
    let log_path = crate::utils::help::snapshot_path(&log_path).stringify_err()?;
    open::that(log_path).stringify_err()
}

#[tauri::command]
pub fn open_devtools(app_handle: AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if !window.is_devtools_open() {
            window.open_devtools();
        } else {
            window.close_devtools();
        }
    }
}

#[tauri::command]
pub async fn exit_app() {
    feat::quit().await;
}

#[tauri::command]
pub async fn restart_app() -> CmdResult<()> {
    feat::restart_app().await;
    Ok(())
}

#[tauri::command]
pub fn get_portable_flag() -> bool {
    *dirs::PORTABLE_FLAG.get().unwrap_or(&false)
}

#[tauri::command]
pub fn get_app_dir() -> CmdResult<String> {
    let app_home_dir = dirs::app_home_dir().stringify_err()?.to_string_lossy().into();
    Ok(app_home_dir)
}

#[tauri::command]
pub fn get_auto_launch_status() -> CmdResult<bool> {
    autostart::get_launch_status().stringify_err()
}

#[tauri::command]
pub async fn download_icon_cache(url: String, name: String) -> CmdResult<String> {
    feat::download_icon_cache(url, name).await
}

#[tauri::command]
pub async fn copy_icon_file(path: String, icon_info: feat::IconInfo) -> CmdResult<String> {
    feat::copy_icon_file(path, icon_info).await
}
