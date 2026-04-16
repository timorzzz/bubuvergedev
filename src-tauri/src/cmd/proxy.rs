use super::CmdResult;
use crate::config::Config;
use crate::core::tray::Tray;
use crate::process::AsyncHandler;
use clash_verge_logging::{Type, logging};
use std::sync::atomic::{AtomicBool, Ordering};

static TRAY_SYNC_RUNNING: AtomicBool = AtomicBool::new(false);
static TRAY_SYNC_PENDING: AtomicBool = AtomicBool::new(false);

/// 同步托盘和GUI的代理选择状态
#[tauri::command]
pub async fn sync_tray_proxy_selection() -> CmdResult<()> {
    if TRAY_SYNC_RUNNING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        AsyncHandler::spawn(move || async move {
            run_tray_sync_loop().await;
        });
    } else {
        TRAY_SYNC_PENDING.store(true, Ordering::Release);
    }

    Ok(())
}

#[tauri::command]
pub async fn set_system_proxy_enabled(enabled: bool) -> CmdResult<bool> {
    let current = Config::verge()
        .await
        .latest_arc()
        .enable_system_proxy
        .unwrap_or(false);

    if current == enabled {
        return Ok(current);
    }

    Ok(crate::feat::toggle_system_proxy().await)
}

#[tauri::command]
pub async fn set_tun_mode_enabled(enabled: bool) -> CmdResult<bool> {
    let current = Config::verge()
        .await
        .latest_arc()
        .enable_tun_mode
        .unwrap_or(false);

    if current == enabled {
        return Ok(current);
    }

    Ok(crate::feat::toggle_tun_mode(None).await)
}

async fn run_tray_sync_loop() {
    loop {
        match Tray::global().update_menu().await {
            Ok(_) => {
                logging!(info, Type::Cmd, "Tray proxy selection synced successfully");
            }
            Err(e) => {
                logging!(error, Type::Cmd, "Failed to sync tray proxy selection: {e}");
            }
        }

        if !TRAY_SYNC_PENDING.swap(false, Ordering::AcqRel) {
            TRAY_SYNC_RUNNING.store(false, Ordering::Release);

            if TRAY_SYNC_PENDING.swap(false, Ordering::AcqRel)
                && TRAY_SYNC_RUNNING
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            {
                continue;
            }

            break;
        }
    }
}
