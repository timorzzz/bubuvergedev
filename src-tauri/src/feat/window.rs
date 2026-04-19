use crate::config::Config;
use crate::core::{CoreManager, handle, sysopt};
use crate::module::lightweight;
use crate::utils;
use crate::utils::window_manager::WindowManager;
use clash_verge_logging::{Type, logging};
use tokio::time::{Duration, timeout};

pub async fn open_or_close_dashboard() {
    if lightweight::is_in_lightweight_mode() {
        let _ = lightweight::exit_lightweight_mode().await;
        return;
    }

    let result = WindowManager::toggle_main_window().await;
    logging!(info, Type::Window, "Window toggle result: {result:?}");
}

pub async fn quit() {
    logging!(debug, Type::System, "starting quit flow");
    handle::Handle::global().set_is_exiting();

    utils::server::shutdown_embedded_server();

    logging!(info, Type::System, "starting async cleanup");
    let cleanup_result = clean_async().await;
    persist_proxy_and_tun_disabled().await;

    logging!(
        info,
        Type::System,
        "cleanup finished, exit code: {}",
        if cleanup_result { 0 } else { 1 }
    );

    let app_handle = handle::Handle::app_handle();
    app_handle.exit(if cleanup_result { 0 } else { 1 });
}

async fn persist_proxy_and_tun_disabled() {
    let latest = Config::verge().await.latest_arc();
    let should_preserve_startup_proxy = latest.enable_auto_launch.unwrap_or(false)
        && (latest.enable_system_proxy.unwrap_or(false) || latest.enable_tun_mode.unwrap_or(false));

    if should_preserve_startup_proxy {
        logging!(
            info,
            Type::System,
            "preserving persisted proxy/tun state because auto launch with startup proxy is enabled"
        );
        Config::apply_all_and_save_file().await;
        return;
    }

    let verge = Config::verge().await;
    verge.edit_draft(|draft| {
        draft.enable_system_proxy = Some(false);
        draft.enable_tun_mode = Some(false);
    });

    Config::apply_all_and_save_file().await;
    logging!(info, Type::System, "persisted system proxy and tun mode as disabled");
}

pub async fn clean_async() -> bool {
    logging!(info, Type::System, "starting async cleanup tasks");

    let proxy_task = tokio::task::spawn(async {
        logging!(info, Type::Window, "resetting system proxy");
        match timeout(Duration::from_millis(1500), sysopt::Sysopt::global().reset_sysproxy()).await {
            Ok(Ok(_)) => {
                logging!(info, Type::Window, "system proxy reset completed");
                true
            }
            Ok(Err(e)) => {
                logging!(warn, Type::Window, "warning: failed to reset system proxy: {e}");
                false
            }
            Err(_) => {
                logging!(warn, Type::Window, "warning: resetting system proxy timed out");
                false
            }
        }
    });

    let core_task = tokio::task::spawn(async {
        logging!(info, Type::System, "disable tun");
        let tun_enabled = Config::verge().await.data_arc().enable_tun_mode.unwrap_or(false);
        if tun_enabled {
            let disable_tun = serde_json::json!({ "tun": { "enable": false } });

            logging!(info, Type::System, "sending disable tun request to mihomo");
            match timeout(
                Duration::from_millis(1000),
                handle::Handle::mihomo().await.patch_base_config(&disable_tun),
            )
            .await
            {
                Ok(Ok(_)) => {
                    logging!(info, Type::Window, "tun mode disabled");
                }
                Ok(Err(e)) => {
                    logging!(warn, Type::Window, "warning: failed to disable tun mode: {e}");
                }
                Err(_) => {
                    logging!(warn, Type::Window, "warning: disabling tun mode timed out");
                }
            }
        }

        #[cfg(target_os = "windows")]
        let stop_timeout = Duration::from_secs(2);
        #[cfg(not(target_os = "windows"))]
        let stop_timeout = Duration::from_secs(3);

        logging!(info, Type::System, "stop core");
        match timeout(stop_timeout, CoreManager::global().stop_core()).await {
            Ok(_) => {
                logging!(info, Type::Window, "core stopped");
                true
            }
            Err(_) => {
                logging!(warn, Type::Window, "warning: stopping core timed out");
                false
            }
        }
    });

    let dns_task = tokio::task::spawn(async {
        #[cfg(target_os = "macos")]
        match timeout(
            Duration::from_millis(1000),
            crate::utils::resolve::dns::restore_public_dns(),
        )
        .await
        {
            Ok(_) => {
                logging!(info, Type::Window, "dns settings restored");
                true
            }
            Err(_) => {
                logging!(warn, Type::Window, "warning: restoring dns settings timed out");
                false
            }
        }
        #[cfg(not(target_os = "macos"))]
        true
    });

    let (proxy_result, core_result, dns_result) = tokio::join!(proxy_task, core_task, dns_task);

    let proxy_success = proxy_result.unwrap_or_default();
    let core_success = core_result.unwrap_or_default();
    let dns_success = dns_result.unwrap_or_default();

    let all_success = proxy_success && core_success && dns_success;

    logging!(
        info,
        Type::System,
        "async cleanup finished - proxy: {}, core: {}, dns: {}, overall: {}",
        proxy_success,
        core_success,
        dns_success,
        all_success
    );

    all_success
}

#[cfg(target_os = "macos")]
pub async fn hide() {
    use crate::module::lightweight::add_light_weight_timer;

    let enable_auto_light_weight_mode = Config::verge()
        .await
        .data_arc()
        .enable_auto_light_weight_mode
        .unwrap_or(false);

    if enable_auto_light_weight_mode {
        add_light_weight_timer().await;
    }

    if let Some(window) = WindowManager::get_main_window()
        && window.is_visible().unwrap_or(false)
    {
        let _ = window.hide();
    }
    handle::Handle::global().set_activation_policy_accessory();
}
