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
    NetworkCheck,
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
    Offline,
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
    let reason = error.map_or("http_status", bluelayer_http_failure_reason);
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

fn classify_transport_source(message: &str) -> Option<&'static str> {
    let message = message.to_ascii_lowercase();
    if [
        "dns error",
        "dns lookup",
        "failed to lookup",
        "failed to resolve",
        "name or service not known",
        "nodename nor servname",
        "no such host",
        "os error 11001",
        "os error 11004",
        "temporary failure in name resolution",
    ]
    .iter()
    .any(|pattern| message.contains(pattern))
    {
        Some("dns")
    } else if ["certificate", "tls", "ssl", "invalid peer", "certvalid"]
        .iter()
        .any(|pattern| message.contains(pattern))
    {
        Some("tls")
    } else {
        None
    }
}

fn classify_transport_cause(cause: &(dyn std::error::Error + 'static), depth: u8) -> Option<&'static str> {
    if depth >= 16 {
        return None;
    }
    if cause.is::<tokio_rustls::rustls::Error>() {
        return Some("tls");
    }
    // io::Error::source can skip the contained error itself; inspect get_ref too.
    if let Some(inner) = cause.downcast_ref::<std::io::Error>().and_then(std::io::Error::get_ref)
        && let Some(reason) = classify_transport_cause(inner, depth + 1)
    {
        return Some(reason);
    }
    classify_transport_source(&cause.to_string()).or_else(|| {
        cause
            .source()
            .and_then(|source| classify_transport_cause(source, depth + 1))
    })
}

pub fn bluelayer_http_failure_reason(error: &reqwest::Error) -> &'static str {
    use std::error::Error as _;
    if error.is_timeout() {
        return "timeout";
    }
    // Reqwest's outer display hides DNS/TLS causes and may include private URLs.
    if let Some(reason) = error.source().and_then(|cause| classify_transport_cause(cause, 0)) {
        return reason;
    }
    if error.is_connect() {
        "connection"
    } else if error.is_decode() {
        "invalid_payload"
    } else if error.is_body() {
        "connection"
    } else {
        "request"
    }
}

#[cfg(test)]
mod tests {
    use super::{BluelayerDiagnostic, bluelayer_http_failure_reason, classify_transport_source};

    #[test]
    fn transport_sources_use_cross_platform_fixed_categories() {
        for source in [
            "dns error: failed to lookup address information",
            "Name or service not known",
            "nodename nor servname provided, or not known",
            "No such host is known. (os error 11001)",
            "Temporary failure in name resolution",
        ] {
            assert_eq!(classify_transport_source(source), Some("dns"));
        }
        assert_eq!(
            classify_transport_source("invalid peer certificate: Expired"),
            Some("tls")
        );
        assert_eq!(classify_transport_source("connection refused"), None);
    }

    #[tokio::test]
    async fn native_connect_failure_does_not_return_private_url() -> anyhow::Result<()> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        let address = listener.local_addr()?;
        drop(listener);
        let result = reqwest::Client::builder()
            .no_proxy()
            .build()?
            .get(format!("http://{address}/private?token=not-a-real-token"))
            .timeout(std::time::Duration::from_secs(1))
            .send()
            .await;
        let error = result
            .err()
            .ok_or_else(|| anyhow::anyhow!("test server unexpectedly available"))?;
        let reason = bluelayer_http_failure_reason(&error);
        assert!(matches!(reason, "connection" | "timeout"));
        assert!(!reason.contains("private") && !reason.contains("token"));
        Ok(())
    }

    #[tokio::test]
    async fn native_tls_failure_is_not_collapsed_into_connection() -> anyhow::Result<()> {
        use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await?;
            let mut bytes = [0; 1024];
            stream.read_exact(&mut bytes[..1]).await?;
            stream
                .write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n")
                .await?;
            stream.shutdown().await?;
            while stream.read(&mut bytes).await? != 0 {}
            Ok::<(), std::io::Error>(())
        });
        scopeguard::defer! { server.abort(); }
        let result = reqwest::Client::builder()
            .use_rustls_tls()
            .no_proxy()
            .build()?
            .get(format!("https://{address}/private"))
            .timeout(std::time::Duration::from_secs(3))
            .send()
            .await;
        let error = result
            .err()
            .ok_or_else(|| anyhow::anyhow!("TLS test unexpectedly succeeded"))?;
        assert_eq!(bluelayer_http_failure_reason(&error), "tls");
        Ok(())
    }

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
