use crate::{
    config::{Config, IClashTemp, IVerge},
    singleton,
};
use anyhow::Result;
use clash_verge_logging::{Type, logging};
use parking_lot::RwLock;
use scopeguard::defer;
use smartstring::alias::String;
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use sysproxy::{Autoproxy, GuardMonitor, GuardType, Sysproxy};
use tokio::sync::Mutex as TokioMutex;

pub struct Sysopt {
    update_lock: TokioMutex<()>,
    reset_sysproxy: AtomicBool,
    inner_proxy: Arc<RwLock<(Sysproxy, Autoproxy)>>,
    guard: Arc<RwLock<GuardMonitor>>,
}

impl Default for Sysopt {
    fn default() -> Self {
        Self {
            update_lock: TokioMutex::new(()),
            reset_sysproxy: AtomicBool::new(false),
            inner_proxy: Arc::new(RwLock::new((Sysproxy::default(), Autoproxy::default()))),
            guard: Arc::new(RwLock::new(GuardMonitor::new(GuardType::None, Duration::from_secs(30)))),
        }
    }
}

#[cfg(target_os = "windows")]
static DEFAULT_BYPASS: &str = "localhost;127.*;192.168.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;<local>";
#[cfg(target_os = "linux")]
static DEFAULT_BYPASS: &str = "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1";
#[cfg(target_os = "macos")]
static DEFAULT_BYPASS: &str =
    "127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,localhost,*.local,*.crashlytics.com,<local>";

async fn get_bypass() -> String {
    let use_default = Config::verge().await.latest_arc().use_default_bypass.unwrap_or(true);
    let res = {
        let verge = Config::verge().await;
        let verge = verge.latest_arc();
        verge.system_proxy_bypass.clone()
    };
    let custom_bypass = match res {
        Some(bypass) => bypass,
        None => "".into(),
    };

    if custom_bypass.is_empty() {
        DEFAULT_BYPASS.into()
    } else if use_default {
        #[cfg(target_os = "windows")]
        let separator = ";";
        #[cfg(not(target_os = "windows"))]
        let separator = ",";

        format!("{DEFAULT_BYPASS}{separator}{custom_bypass}").into()
    } else {
        custom_bypass
    }
}

singleton!(Sysopt, SYSOPT);

impl Sysopt {
    fn new() -> Self {
        Self::default()
    }

    fn access_guard(&self) -> Arc<RwLock<GuardMonitor>> {
        Arc::clone(&self.guard)
    }

    pub async fn refresh_guard(&self) {
        logging!(info, Type::Core, "Refreshing system proxy guard...");
        let verge = Config::verge().await.latest_arc();
        if !verge.enable_system_proxy.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy is disabled.");
            self.access_guard().write().stop();
            return;
        }
        if !verge.enable_proxy_guard.unwrap_or_default() {
            logging!(info, Type::Core, "System proxy guard is disabled.");
            return;
        }
        logging!(
            info,
            Type::Core,
            "Updating system proxy with duration: {} seconds",
            verge.proxy_guard_duration.unwrap_or(30)
        );
        {
            let guard = self.access_guard();
            guard
                .write()
                .set_interval(Duration::from_secs(verge.proxy_guard_duration.unwrap_or(30)));
        }
        logging!(info, Type::Core, "Starting system proxy guard...");
        {
            let guard = self.access_guard();
            guard.write().start();
        }
    }

    /// init the sysproxy
    pub async fn update_sysproxy(&self) -> Result<()> {
        let _lock = self.update_lock.lock().await;

        let verge = Config::verge().await.latest_arc();
        let pac_port = IVerge::get_singleton_port();
        let (sys_enable, pac_enable, proxy_host, proxy_guard) = (
            verge.enable_system_proxy.unwrap_or_default(),
            verge.proxy_auto_config.unwrap_or_default(),
            verge.proxy_host.clone().unwrap_or_else(|| String::from("127.0.0.1")),
            verge.enable_proxy_guard.unwrap_or_default(),
        );
        let runtime = Config::runtime().await;
        let runtime_config = runtime
            .latest_arc()
            .config
            .clone()
            .or_else(|| runtime.data_arc().config.clone());
        let runtime_http_port = runtime_config.as_ref().map(IClashTemp::guard_port).unwrap_or(0);
        let runtime_mixed_port = runtime_config.as_ref().map(IClashTemp::guard_mixed_port).unwrap_or(0);

        let port = if pac_enable {
            if runtime_mixed_port != 0 {
                runtime_mixed_port
            } else {
                verge.verge_mixed_port.unwrap_or(7897)
            }
        } else if runtime_http_port != 0 {
            runtime_http_port
        } else if runtime_mixed_port != 0 {
            runtime_mixed_port
        } else {
            verge.verge_port.unwrap_or(7899)
        };
        logging!(
            info,
            Type::Core,
            "Applying system proxy => enable={}, pac={}, host={}, port={}",
            sys_enable,
            pac_enable,
            proxy_host,
            port
        );
        // 先 await, 避免持有锁导致的 Send 问题
        let bypass = get_bypass().await;

        let (sys, auto, guard_type) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.host = proxy_host.clone().into();
            sys.port = port;
            sys.bypass = bypass.into();
            auto.url = format!("http://{proxy_host}:{pac_port}/commands/pac");

            // `enable_system_proxy` is the master switch.
            // When disabled, force clear both global proxy and PAC at OS level.
            let guard_type = if !sys_enable {
                sys.enable = false;
                auto.enable = false;
                GuardType::None
            } else if pac_enable {
                sys.enable = false;
                auto.enable = true;
                if proxy_guard {
                    GuardType::Autoproxy(auto.clone())
                } else {
                    GuardType::None
                }
            } else {
                sys.enable = true;
                auto.enable = false;
                if proxy_guard {
                    GuardType::Sysproxy(sys.clone())
                } else {
                    GuardType::None
                }
            };

            (sys.clone(), auto.clone(), guard_type)
        };

        self.access_guard().write().set_guard_type(guard_type);

        tokio::task::spawn_blocking(move || -> Result<()> {
            match (sys.enable, auto.enable) {
                // 关闭系统代理：两个都清掉，确保残留状态被移除
                (false, false) => {
                    auto.set_auto_proxy()?;
                    sys.set_system_proxy()?;
                }
                // PAC 模式：先关全局代理，再开 PAC，最后生效的是 PAC
                (false, true) => {
                    sys.set_system_proxy()?;
                    auto.set_auto_proxy()?;
                }
                // 普通系统代理模式：先关 PAC，再开全局代理，避免被 unset_proxy 覆盖
                (true, false) => {
                    auto.set_auto_proxy()?;
                    sys.set_system_proxy()?;
                }
                // 理论上不会同时开启；兜底按普通系统代理处理
                (true, true) => {
                    auto.set_auto_proxy()?;
                    sys.set_system_proxy()?;
                }
            }
            Ok(())
        })
        .await??;

        Ok(())
    }

    /// reset the sysproxy
    pub async fn reset_sysproxy(&self) -> Result<()> {
        if self
            .reset_sysproxy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Ok(());
        }
        defer! {
            self.reset_sysproxy.store(false, Ordering::SeqCst);
        }

        // close proxy guard
        self.access_guard().write().set_guard_type(GuardType::None);

        // 直接关闭所有代理
        let (sys, auto) = {
            let (sys, auto) = &mut *self.inner_proxy.write();
            sys.enable = false;
            auto.enable = false;
            (sys.clone(), auto.clone())
        };

        tokio::task::spawn_blocking(move || -> Result<()> {
            match (sys.enable, auto.enable) {
                // 关闭系统代理：两个都清掉，确保残留状态被移除
                (false, false) => {
                    auto.set_auto_proxy()?;
                    sys.set_system_proxy()?;
                }
                // PAC 模式：先关全局代理，再开 PAC，最后生效的是 PAC
                (false, true) => {
                    sys.set_system_proxy()?;
                    auto.set_auto_proxy()?;
                }
                // 普通系统代理模式：先关 PAC，再开全局代理，避免被 unset_proxy 覆盖
                (true, false) => {
                    auto.set_auto_proxy()?;
                    sys.set_system_proxy()?;
                }
                // 理论上不会同时开启；兜底按普通系统代理处理
                (true, true) => {
                    auto.set_auto_proxy()?;
                    sys.set_system_proxy()?;
                }
            }
            Ok(())
        })
        .await??;

        Ok(())
    }
}
