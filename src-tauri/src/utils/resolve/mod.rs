use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::Result;

use crate::{
    config::Config,
    core::{
        CoreManager, Timer,
        handle::Handle,
        hotkey::Hotkey,
        logger::Logger,
        service::{SERVICE_MANAGER, ServiceManager, is_service_ipc_path_exists},
        sysopt,
        tray::Tray,
    },
    feat,
    module::{auto_backup::AutoBackupManager, lightweight::auto_lightweight_boot},
    process::AsyncHandler,
    utils::{init, server, window_manager::WindowManager},
};
use clash_verge_logging::{Type, logging, logging_error};
use clash_verge_signal;

pub mod dns;
pub mod scheme;
pub mod window;
pub mod window_script;

static RESOLVE_DONE: AtomicBool = AtomicBool::new(false);

pub fn init_work_dir_and_logger() -> anyhow::Result<()> {
    AsyncHandler::block_on(async {
        init_work_config().await;
        init_resources().await;
        logging!(info, Type::Setup, "Initializing logger");
        // #[cfg(not(feature = "tokio-trace"))]
        Logger::global().init().await?;
        Ok(())
    })
}

pub fn resolve_setup_sync() {
    AsyncHandler::spawn(|| async {
        AsyncHandler::spawn_blocking(init_scheme);
        AsyncHandler::spawn_blocking(init_embed_server);
    });
}

pub fn resolve_setup_async() {
    AsyncHandler::spawn(|| async {
        logging!(info, Type::ClashVergeRev, "Version: {}", env!("CARGO_PKG_VERSION"));

        init_startup_script().await;
        init_verge_config().await;
        Config::verify_config_initialization().await;
        init_window().await;

        let core_init = AsyncHandler::spawn(|| async {
            reset_stale_proxy_and_tun_state().await;
            init_service_manager().await;
            init_core_manager().await;
            init_system_proxy().await;
            init_system_proxy_guard().await;
        });

        let _ = futures::join!(
            core_init,
            init_tray(),
            init_timer(),
            init_hotkey(),
            init_auto_lightweight_boot(),
            init_auto_backup(),
            init_silent_updater(),
        );

        Handle::refresh_clash();
        refresh_tray_menu().await;
        resolve_done();
    });
}

pub async fn resolve_reset_async() -> Result<(), anyhow::Error> {
    sysopt::Sysopt::global().reset_sysproxy().await?;
    CoreManager::global().stop_core().await?;

    #[cfg(target_os = "macos")]
    {
        use dns::restore_public_dns;
        restore_public_dns().await;
    }

    Ok(())
}

pub(super) fn init_scheme() {
    logging_error!(Type::Setup, init::init_scheme());
}

pub async fn resolve_scheme(param: &str) -> Result<()> {
    logging_error!(Type::Setup, scheme::resolve_scheme(param).await);
    Ok(())
}

pub(super) fn init_embed_server() {
    server::embed_server();
}

pub(super) async fn init_resources() {
    logging_error!(Type::Setup, init::init_resources().await);
}

pub(super) async fn init_startup_script() {
    logging_error!(Type::Setup, init::startup_script().await);
}

pub(super) async fn init_timer() {
    logging_error!(Type::Setup, Timer::global().init().await);
}

pub(super) async fn init_hotkey() {
    // if hotkey is not use by global, skip init it
    let skip_register_hotkeys = !Config::verge().await.latest_arc().enable_global_hotkey.unwrap_or(true);
    logging_error!(Type::Setup, Hotkey::global().init(skip_register_hotkeys).await);
}

pub(super) async fn init_auto_lightweight_boot() {
    logging_error!(Type::Setup, auto_lightweight_boot().await);
}

pub(super) async fn init_auto_backup() {
    logging_error!(Type::Setup, AutoBackupManager::global().init().await);
}

#[allow(unreachable_code)]
async fn init_silent_updater() {
    logging!(
        info,
        Type::Setup,
        "Silent updater disabled, using backend-managed pc-update checks"
    );
    return;

    use crate::core::SilentUpdater;
    use crate::core::handle::Handle;

    logging!(info, Type::Setup, "Initializing silent updater...");

    let app_handle = Handle::app_handle();

    // Check for cached update and attempt install before main app initialization.
    // If install succeeds:
    //   - Windows: NSIS takes over and the process exits automatically
    //   - macOS/Linux: binary is replaced, we restart the app
    if SilentUpdater::global().try_install_on_startup(app_handle).await {
        logging!(info, Type::Setup, "Update installed at startup, restarting...");
        app_handle.restart();
    }

    // No pending install — start background check/download loop
    let app_handle = app_handle.clone();
    tokio::spawn(async move {
        SilentUpdater::global().start_background_check(app_handle).await;
    });

    logging!(info, Type::Setup, "Silent updater initialized");
}

pub fn init_signal() {
    logging!(info, Type::Setup, "Initializing signal handlers...");
    clash_verge_signal::register(feat::quit);
}

pub async fn init_work_config() {
    logging_error!(Type::Setup, init::init_config().await);
}

pub(super) async fn init_tray() {
    logging_error!(Type::Setup, Tray::global().init().await);
}

pub(super) async fn init_verge_config() {
    logging_error!(Type::Setup, Config::init_config().await);
}

pub(super) async fn init_service_manager() {
    clash_verge_service_ipc::set_config(Some(ServiceManager::config())).await;
    if !is_service_ipc_path_exists() {
        return;
    }
    if SERVICE_MANAGER.lock().await.init().await.is_ok() {
        logging_error!(Type::Setup, SERVICE_MANAGER.lock().await.refresh().await);
    }
}

pub(super) async fn init_core_manager() {
    logging_error!(Type::Setup, CoreManager::global().init().await);
}

pub(super) async fn init_system_proxy() {
    logging_error!(Type::Setup, sysopt::Sysopt::global().update_sysproxy().await);
}

pub(super) async fn reset_stale_proxy_and_tun_state() {
    let verge = Config::verge().await.latest_arc();
    let system_proxy_enabled = verge.enable_system_proxy.unwrap_or(false);
    let tun_enabled = verge.enable_tun_mode.unwrap_or(false);
    let preserve_startup_proxy = verge.enable_auto_launch.unwrap_or(false) && (system_proxy_enabled || tun_enabled);

    if !(system_proxy_enabled || tun_enabled) {
        return;
    }

    logging!(
        info,
        Type::Setup,
        "Detected persisted proxy/tun state on startup, clearing stale runtime state first"
    );

    logging_error!(Type::Setup, sysopt::Sysopt::global().reset_sysproxy().await);

    if tun_enabled {
        if crate::core::service::is_service_ipc_path_exists() {
            logging_error!(Type::Setup, crate::core::service::stop_core_by_service().await);
        }

        #[cfg(target_os = "macos")]
        logging_error!(Type::Setup, dns::restore_public_dns().await);
    }

    if preserve_startup_proxy {
        logging!(
            info,
            Type::Setup,
            "Preserving persisted proxy/tun preference because auto launch with startup proxy is enabled"
        );
    } else {
        let verge = Config::verge().await;
        verge.edit_draft(|draft| {
            draft.enable_system_proxy = Some(false);
            draft.enable_tun_mode = Some(false);
        });
        verge.apply();
        logging_error!(Type::Setup, verge.data_arc().save_file().await);
        Handle::refresh_verge();
    }
}

pub(super) async fn init_system_proxy_guard() {
    sysopt::Sysopt::global().refresh_guard().await;
}

pub(super) async fn refresh_tray_menu() {
    logging_error!(Type::Setup, Tray::global().update_part().await);
}

pub(super) async fn init_window() {
    let is_silent_start = Config::verge().await.data_arc().enable_silent_start.unwrap_or(false);
    #[cfg(target_os = "macos")]
    if is_silent_start {
        use crate::core::handle::Handle;
        Handle::global().set_activation_policy_accessory();
    }
    WindowManager::create_window(!is_silent_start).await;
}

pub fn resolve_done() {
    RESOLVE_DONE.store(true, Ordering::Release);
}

pub fn is_resolve_done() -> bool {
    RESOLVE_DONE.load(Ordering::Acquire)
}
