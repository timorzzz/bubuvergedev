use anyhow::{Context as _, Result, bail};
use async_trait::async_trait;
use bluelayer_core_snapshot::{CoreSnapshotKind, read_snapshot_at, routing::global_proxy_target};
use serde_json::{Value, json};
use tauri_plugin_mihomo::Mihomo;

#[async_trait]
pub(super) trait ModeApi: Sync {
    async fn config(&self) -> Result<Value>;
    async fn proxies(&self) -> Result<Value>;
    async fn select_global(&self, target: &str) -> Result<()>;
    async fn patch_mode(&self, mode: &str) -> Result<()>;
}

pub(super) struct NativeModeApi<'a> {
    pub client: &'a Mihomo,
    pub socket: &'a str,
}

#[async_trait]
impl ModeApi for NativeModeApi<'_> {
    async fn config(&self) -> Result<Value> {
        Ok(read_snapshot_at(self.socket, CoreSnapshotKind::Config).await?)
    }
    async fn proxies(&self) -> Result<Value> {
        Ok(read_snapshot_at(self.socket, CoreSnapshotKind::Proxies).await?)
    }
    async fn select_global(&self, target: &str) -> Result<()> {
        Ok(self.client.select_node_for_group("GLOBAL", target).await?)
    }
    async fn patch_mode(&self, mode: &str) -> Result<()> {
        Ok(self.client.patch_base_config(&json!({"mode": mode})).await?)
    }
}

pub(super) struct ModeApplied {
    pub config: Value,
    pub global_target: Option<String>,
    previous_mode: String,
    previous_global: Option<String>,
    global_changed: bool,
}

impl ModeApplied {
    pub async fn rollback(&self, api: &impl ModeApi) -> Result<()> {
        let mode_result = api.patch_mode(&self.previous_mode).await;
        let global_result = if self.global_changed {
            if let Some(previous) = &self.previous_global {
                api.select_global(previous).await
            } else {
                Ok(())
            }
        } else {
            Ok(())
        };
        mode_result?;
        global_result
    }
}

pub(super) async fn apply_mode(
    api: &impl ModeApi,
    mode: &str,
    explicit_proxy: Option<&str>,
    rule_preferences: &[String],
) -> Result<ModeApplied> {
    if !matches!(mode, "rule" | "global" | "direct") {
        bail!("不支持的代理模式");
    }
    let before = api.config().await.context("无法读取内核当前模式，未执行模式切换")?;
    let previous_mode = before["mode"].as_str().context("内核模式响应无效")?.to_owned();
    let mut applied = ModeApplied {
        config: before,
        previous_mode,
        previous_global: None,
        global_target: None,
        global_changed: false,
    };
    if mode == "global" {
        let snapshot = api.proxies().await.context("无法读取内核线路，未执行全局模式切换")?;
        applied.previous_global = snapshot["proxies"]["GLOBAL"]["now"].as_str().map(str::to_owned);
        let preferences = if let Some(explicit) = explicit_proxy.filter(|value| !value.is_empty()) {
            vec![explicit]
        } else if applied.previous_mode != "global" {
            rule_preferences.iter().map(String::as_str).collect()
        } else {
            Vec::new()
        };
        let target =
            global_proxy_target(&snapshot, &preferences).context("未找到可用的全局代理线路，请先刷新线路并选择节点")?;
        if applied.previous_global.as_deref() != Some(target.as_str()) {
            applied.global_changed = true;
            if let Err(error) = api.select_global(&target).await {
                let rollback = applied.rollback(api).await;
                return Err(error.context(if rollback.is_ok() {
                    "全局线路应用失败，已还原原有模式"
                } else {
                    "全局线路应用失败且还原失败，请刷新内核状态后重试"
                }));
            }
        }
        applied.global_target = Some(target);
    }
    let result = async {
        api.patch_mode(mode).await.context("内核拒绝切换代理模式")?;
        let confirmed = api.config().await.context("无法确认内核模式，正在还原")?;
        if confirmed["mode"].as_str() != Some(mode) {
            bail!("内核模式未切换成功，正在还原");
        }
        if let Some(target) = &applied.global_target {
            let snapshot = api.proxies().await.context("无法确认全局线路，正在还原")?;
            if snapshot["proxies"]["GLOBAL"]["now"].as_str() != Some(target) {
                bail!("内核全局线路未应用成功，正在还原");
            }
        }
        Ok(confirmed)
    }
    .await;
    match result {
        Ok(confirmed) => {
            applied.config = confirmed;
            Ok(applied)
        }
        Err(error) => {
            if applied.rollback(api).await.is_err() {
                return Err(error.context("模式切换失败且还原失败，请刷新内核状态后重试"));
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::Mutex;

    struct FakeApi {
        mode: Mutex<String>,
        global: Mutex<String>,
        fail_patch: bool,
        ignore_patch: bool,
        fail_select_after_write: bool,
    }

    #[async_trait]
    impl ModeApi for FakeApi {
        async fn config(&self) -> Result<Value> {
            Ok(json!({"mode": *self.mode.lock().await}))
        }
        async fn proxies(&self) -> Result<Value> {
            Ok(json!({"proxies": {
                "DIRECT": {"type":"Direct"}, "node": {"type":"Socks5"},
                "rules": {"type":"Selector","all":["node","DIRECT"],"now":"node"},
                "GLOBAL": {"type":"Selector","all":["DIRECT","node","rules"],"now": *self.global.lock().await}
            }}))
        }
        async fn select_global(&self, target: &str) -> Result<()> {
            *self.global.lock().await = target.to_owned();
            if self.fail_select_after_write && target == "node" {
                bail!("mock selection response lost");
            }
            Ok(())
        }
        async fn patch_mode(&self, mode: &str) -> Result<()> {
            if self.fail_patch && mode == "global" {
                bail!("mock patch rejected");
            }
            if !self.ignore_patch {
                *self.mode.lock().await = mode.to_owned();
            }
            Ok(())
        }
    }

    fn fixture(mode: &str) -> FakeApi {
        FakeApi {
            mode: Mutex::new(mode.into()),
            global: Mutex::new("DIRECT".into()),
            fail_patch: false,
            ignore_patch: false,
            fail_select_after_write: false,
        }
    }

    #[tokio::test]
    async fn global_uses_rule_choice_and_rule_mode_can_be_restored() -> Result<()> {
        let api = fixture("rule");
        let applied = apply_mode(&api, "global", Some("node"), &[]).await?;
        assert_eq!(applied.config["mode"], "global");
        assert_eq!(*api.global.lock().await, "node");
        let applied = apply_mode(&api, "rule", None, &[]).await?;
        assert_eq!(applied.config["mode"], "rule");
        assert_eq!(api.proxies().await?["proxies"]["rules"]["now"], "node");
        Ok(())
    }

    #[tokio::test]
    async fn rejected_mode_restores_previous_global_and_never_reports_success() {
        let mut api = fixture("rule");
        api.fail_patch = true;
        assert!(apply_mode(&api, "global", Some("node"), &[]).await.is_err());
        assert_eq!(*api.mode.lock().await, "rule");
        assert_eq!(*api.global.lock().await, "DIRECT");
    }

    #[tokio::test]
    async fn successful_http_without_changed_mode_is_a_failure() {
        let mut api = fixture("rule");
        api.ignore_patch = true;
        assert!(apply_mode(&api, "global", Some("node"), &[]).await.is_err());
        assert_eq!(*api.global.lock().await, "DIRECT");
    }

    #[tokio::test]
    async fn rule_request_is_not_skipped_when_the_ui_is_stale() -> Result<()> {
        let api = fixture("global");
        assert_eq!(apply_mode(&api, "rule", None, &[]).await?.config["mode"], "rule");
        Ok(())
    }

    #[tokio::test]
    async fn tray_switch_uses_the_current_rule_policy_without_a_ui_hint() -> Result<()> {
        let api = fixture("rule");
        let applied = apply_mode(&api, "global", None, &["rules".into()]).await?;
        assert_eq!(applied.global_target.as_deref(), Some("rules"));
        assert_eq!(api.proxies().await?["proxies"]["rules"]["now"], "node");
        Ok(())
    }

    #[tokio::test]
    async fn lost_selection_response_also_rolls_back_the_written_selection() {
        let mut api = fixture("rule");
        api.fail_select_after_write = true;
        assert!(apply_mode(&api, "global", Some("node"), &[]).await.is_err());
        assert_eq!(*api.mode.lock().await, "rule");
        assert_eq!(*api.global.lock().await, "DIRECT");
    }

    #[tokio::test]
    #[ignore = "run through scripts/tests/mode-routing-smoke.mjs with an isolated core"]
    async fn real_core_routes_traffic_and_recovers_without_resetting_user_data() -> Result<()> {
        use std::{sync::Arc, time::Duration};
        use tauri_plugin_mihomo::{IpcConnectionPool, IpcPoolConfigBuilder, models::Protocol};
        let socket = std::env::var("BLUELAYER_SMOKE_SOCKET")?;
        IpcConnectionPool::init(IpcPoolConfigBuilder::new().build())?;
        let client = Mihomo {
            protocol: Protocol::LocalSocket,
            external_host: None,
            external_port: None,
            secret: None,
            socket_path: Some(socket.clone()),
            connection_manager: Arc::default(),
        };
        let api = NativeModeApi {
            client: &client,
            socket: &socket,
        };
        let http = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::http(std::env::var("BLUELAYER_SMOKE_PROXY")?)?)
            .timeout(Duration::from_secs(5))
            .build()?;
        let destination = std::env::var("BLUELAYER_SMOKE_DESTINATION")?;
        let traffic =
            || async { Ok::<_, anyhow::Error>(http.get(&destination).send().await?.error_for_status()?.text().await?) };
        if std::env::var("BLUELAYER_SMOKE_RESTART").is_ok() {
            assert_eq!(api.config().await?["mode"], "global");
            assert_eq!(api.proxies().await?["proxies"]["GLOBAL"]["now"], "test-node");
            assert_eq!(traffic().await?, "PROXIED");
        } else {
            assert_eq!(api.config().await?["mode"], "rule");
            assert_eq!(traffic().await?, "PROXIED");
            assert_eq!(api.proxies().await?["proxies"]["GLOBAL"]["now"], "DIRECT");
            api.patch_mode("global").await?;
            assert_eq!(traffic().await?, "DIRECT");
        }
        apply_mode(&api, "global", Some("test-node"), &[]).await?;
        assert_eq!(traffic().await?, "PROXIED");
        apply_mode(&api, "rule", None, &[]).await?;
        assert_eq!(traffic().await?, "PROXIED");
        assert_eq!(api.proxies().await?["proxies"]["test-group"]["now"], "test-node");
        // Reproduce the previously persisted bad state, then recover in place.
        api.select_global("DIRECT").await?;
        api.patch_mode("global").await?;
        assert_eq!(traffic().await?, "DIRECT");
        apply_mode(&api, "rule", None, &[]).await?;
        assert_eq!(traffic().await?, "PROXIED");
        apply_mode(&api, "global", Some("test-node"), &[]).await?;
        assert_eq!(traffic().await?, "PROXIED");
        Ok(())
    }
}
