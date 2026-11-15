use super::{CmdResult, StringifyErr as _};
use clash_verge_logging::{Type, logging};

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum DiagnosticStage {
    Login,
    SessionRestore,
    SubscriptionDownload,
    ProfileSave,
    ProfileActivate,
    CoreReady,
    SubscriptionSync,
    PanelResolve,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum DiagnosticEvent {
    Failed,
    Retry,
    Ready,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum FailureReason {
    Timeout,
    Dns,
    Tls,
    Connection,
    Ipc,
    InvalidPayload,
    Http,
    PermissionDenied,
    ActivationRejected,
    ProfileMissing,
    EmptyProxies,
    AuthRejected,
    Unknown,
}

// No free-text fields: URLs, cookies, account details and YAML cannot enter this log.
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BluelayerDiagnostic {
    stage: DiagnosticStage,
    event: DiagnosticEvent,
    reason: Option<FailureReason>,
    attempt: Option<u32>,
    elapsed_ms: Option<u64>,
    group_count: Option<u32>,
    node_count: Option<u32>,
}

#[tauri::command]
pub fn write_bluelayer_diagnostic(diagnostic: BluelayerDiagnostic) -> CmdResult {
    let line = serde_json::to_string(&diagnostic).stringify_err()?;
    match diagnostic.event {
        DiagnosticEvent::Ready => logging!(info, Type::Frontend, "[BluelayerDiag] {}", line),
        _ => logging!(warn, Type::Frontend, "[BluelayerDiag] {}", line),
    }
    Ok(())
}

pub fn log_bluelayer_http_failure(
    url: &reqwest::Url,
    via_system_proxy: bool,
    elapsed: std::time::Duration,
    status: Option<u16>,
    error: Option<&reqwest::Error>,
) {
    let operation = match url.path() {
        "/v1/login" => "login",
        "/v1/userinfo" => "userinfo",
        "/v1/config" => "panel_config",
        path if path.ends_with("/login.json") => "panel_discovery",
        _ => "subscription_or_other",
    };
    let reason = error.map_or("http_status", |error| {
        if error.is_timeout() {
            "timeout"
        } else if error.is_connect() {
            "connection"
        } else if error.is_decode() {
            "decode"
        } else if error.is_body() {
            "body"
        } else {
            "request"
        }
    });
    logging!(
        warn,
        Type::Network,
        "[BluelayerDiag] http_failed operation={} transport={} reason={} status={:?} elapsed_ms={}",
        operation,
        if via_system_proxy { "system_proxy" } else { "direct" },
        reason,
        status,
        elapsed.as_millis()
    );
}

#[cfg(test)]
mod tests {
    use super::BluelayerDiagnostic;

    #[test]
    fn diagnostic_rejects_free_text_and_unknown_categories() {
        let sensitive = serde_json::json!({
            "stage": "core_ready", "event": "failed", "reason": "ipc",
            "error": "private subscription and credentials"
        });
        assert!(serde_json::from_value::<BluelayerDiagnostic>(sensitive).is_err());
        let invalid = serde_json::json!({ "stage": "private URL", "event": "failed" });
        assert!(serde_json::from_value::<BluelayerDiagnostic>(invalid).is_err());
    }

    #[test]
    fn diagnostic_round_trips_only_categories_and_counts() -> Result<(), serde_json::Error> {
        let input = serde_json::json!({
            "stage": "core_ready", "event": "failed", "reason": "empty_proxies",
            "attempt": 3, "elapsedMs": 15000, "groupCount": 1, "nodeCount": 0
        });
        let diagnostic: BluelayerDiagnostic = serde_json::from_value(input.clone())?;
        assert_eq!(serde_json::to_value(diagnostic)?, input);
        Ok(())
    }
}
