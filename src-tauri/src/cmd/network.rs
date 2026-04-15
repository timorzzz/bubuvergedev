use super::CmdResult;
use crate::cmd::StringifyErr as _;
use clash_verge_logging::{Type, logging};
use futures::stream::{self, StreamExt};
use gethostname::gethostname;
use network_interface::NetworkInterface;
use serde_yaml_ng::Mapping;
use std::collections::HashMap;
use std::net::TcpListener;
use sysproxy::{Autoproxy, Sysproxy};
use tauri_plugin_clash_verge_sysinfo;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// get the system proxy
#[tauri::command]
pub async fn get_sys_proxy() -> CmdResult<Mapping> {
    logging!(debug, Type::Network, "异步获取系统代理配置");

    let sys_proxy = Sysproxy::get_system_proxy().stringify_err()?;
    let Sysproxy {
        ref host,
        ref bypass,
        ref port,
        ref enable,
    } = sys_proxy;

    let mut map = Mapping::new();
    map.insert("enable".into(), (*enable).into());
    map.insert("server".into(), format!("{}:{}", host, port).into());
    map.insert("bypass".into(), bypass.as_str().into());

    logging!(
        debug,
        Type::Network,
        "返回系统代理配置: enable={}, {}:{}",
        sys_proxy.enable,
        sys_proxy.host,
        sys_proxy.port
    );
    Ok(map)
}

/// 获取自动代理配置
#[tauri::command]
pub async fn get_auto_proxy() -> CmdResult<Mapping> {
    let auto_proxy = Autoproxy::get_auto_proxy().stringify_err()?;
    let Autoproxy { ref enable, ref url } = auto_proxy;

    let mut map = Mapping::new();
    map.insert("enable".into(), (*enable).into());
    map.insert("url".into(), url.as_str().into());

    logging!(
        debug,
        Type::Network,
        "返回自动代理配置（缓存）: enable={}, url={}",
        auto_proxy.enable,
        auto_proxy.url
    );
    Ok(map)
}

/// 获取系统主机名
#[tauri::command]
pub fn get_system_hostname() -> String {
    // 获取系统主机名，处理可能的非UTF-8字符
    match gethostname().into_string() {
        Ok(name) => name,
        Err(os_string) => {
            // 对于包含非UTF-8的主机名，使用调试格式化
            let fallback = format!("{os_string:?}");
            // 去掉可能存在的引号
            fallback.trim_matches('"').to_string()
        }
    }
}

/// 获取网络接口列表
#[tauri::command]
pub fn get_network_interfaces() -> Vec<String> {
    tauri_plugin_clash_verge_sysinfo::list_network_interfaces()
}

/// 获取网络接口详细信息
#[tauri::command]
pub fn get_network_interfaces_info() -> CmdResult<Vec<NetworkInterface>> {
    use network_interface::{NetworkInterface, NetworkInterfaceConfig as _};

    let names = get_network_interfaces();
    let interfaces = NetworkInterface::show().stringify_err()?;

    let mut result = Vec::new();

    for interface in interfaces {
        if names.contains(&interface.name) {
            result.push(interface);
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn is_port_in_use(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_err()
}

#[tauri::command]
pub async fn probe_connectivity() -> bool {
    use tokio::net::TcpStream;
    use tokio::time::{Duration, timeout};

    const TARGETS: &[&str] = &["1.1.1.1:80", "223.5.5.5:53", "8.8.8.8:53"];

    for target in TARGETS {
        if let Ok(Ok(_)) = timeout(Duration::from_secs(2), TcpStream::connect(target)).await {
            return true;
        }
    }

    false
}

async fn ping_once(host: String, timeout_ms: u64) -> Option<u32> {
    use std::process::Stdio;
    use tokio::process::Command;
    use tokio::time::{Duration, Instant, timeout};

    let safe_host = host.trim();
    if safe_host.is_empty() {
        return None;
    }

    let mut command = Command::new("ping");
    #[cfg(target_os = "windows")]
    {
        command.args(["-n", "1", "-w", &timeout_ms.to_string(), safe_host]);
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(target_os = "linux")]
    {
        let timeout_secs = ((timeout_ms + 999) / 1000).max(1);
        command.args(["-c", "1", "-W", &timeout_secs.to_string(), safe_host]);
    }
    #[cfg(target_os = "macos")]
    {
        command.args(["-c", "1", "-W", &timeout_ms.to_string(), safe_host]);
    }

    command.stdout(Stdio::null()).stderr(Stdio::null());

    let started_at = Instant::now();
    let mut child = command.spawn().ok()?;

    let result = timeout(Duration::from_millis(timeout_ms.saturating_add(800)), child.wait()).await;

    match result {
        Ok(Ok(status)) if status.success() => Some(started_at.elapsed().as_millis().max(1) as u32),
        Ok(Ok(_)) | Ok(Err(_)) => None,
        Err(_) => {
            let _ = child.kill().await;
            None
        }
    }
}

async fn ping_best_delay(host: String, timeout_ms: u64, rounds: u8) -> Option<u32> {
    let mut best: Option<u32> = None;

    for _ in 0..rounds.max(1) {
        if let Some(delay) = ping_once(host.clone(), timeout_ms).await {
            best = Some(best.map_or(delay, |current| current.min(delay)));
        }
    }

    best
}

#[tauri::command]
pub async fn ping_hosts(
    hosts: Vec<String>,
    timeout_ms: Option<u64>,
    rounds: Option<u8>,
) -> CmdResult<HashMap<String, u32>> {
    let timeout_ms = timeout_ms.unwrap_or(1500).clamp(200, 10_000);
    let rounds = rounds.unwrap_or(3).clamp(1, 3);
    let mut unique_hosts = Vec::new();

    for host in hosts {
        let normalized = host.trim().to_string();
        if normalized.is_empty() || unique_hosts.contains(&normalized) {
            continue;
        }
        unique_hosts.push(normalized);
    }

    let pairs = stream::iter(unique_hosts.into_iter().map(|host| async move {
        let best = ping_best_delay(host.clone(), timeout_ms, rounds).await;
        (host, best)
    }))
    .buffer_unordered(8)
    .collect::<Vec<_>>()
    .await;

    let mut result = HashMap::new();
    for (host, delay) in pairs {
        if let Some(delay) = delay {
            result.insert(host, delay);
        }
    }

    Ok(result)
}
