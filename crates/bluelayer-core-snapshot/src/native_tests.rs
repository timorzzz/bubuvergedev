use super::{CoreSnapshotKind, SnapshotError, read_snapshot_at, read_with_timeout};
use serde_json::json;
use std::{
    future::Future,
    io,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

type TestResult = Result<(), Box<dyn std::error::Error + Send + Sync>>;
static NEXT_SOCKET: AtomicU64 = AtomicU64::new(0);

struct TestServer {
    socket: String,
    task: tokio::task::JoinHandle<io::Result<()>>,
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.task.abort();
        #[cfg(unix)]
        let _ = std::fs::remove_file(&self.socket);
    }
}

fn serve_once(body: &'static str, status: u16, delay: Duration, kind: CoreSnapshotKind) -> io::Result<TestServer> {
    let id = NEXT_SOCKET.fetch_add(1, Ordering::Relaxed);
    #[cfg(windows)]
    let socket = format!(r"\\.\pipe\bl-snapshot-test-{}-{id}", std::process::id());
    #[cfg(unix)]
    let socket = std::env::temp_dir()
        .join(format!("bl-snap-{}-{id}.sock", std::process::id()))
        .to_string_lossy()
        .into_owned();
    #[cfg(windows)]
    let listener = tokio::net::windows::named_pipe::ServerOptions::new()
        .first_pipe_instance(true)
        .create(&socket)?;
    #[cfg(unix)]
    let listener = tokio::net::UnixListener::bind(&socket)?;
    let task = tokio::spawn(async move {
        #[cfg(windows)]
        let mut stream = {
            listener.connect().await?;
            listener
        };
        #[cfg(unix)]
        let (mut stream, _) = listener.accept().await?;
        let mut request = Vec::new();
        while !request.ends_with(b"\r\n\r\n") {
            let mut byte = [0];
            stream.read_exact(&mut byte).await?;
            request.push(byte[0]);
            if request.len() > 8192 {
                return Err(io::Error::other("request header too large"));
            }
        }
        assert!(String::from_utf8_lossy(&request).starts_with(&format!("GET {} HTTP/1.1\r\n", kind.path())));
        tokio::time::sleep(delay).await;
        // Match Mihomo's streaming/chunked responses, including multiple chunks.
        let middle = body.len() / 2;
        let (first, second) = body.split_at(middle);
        let response = format!(
            "HTTP/1.1 {status} Test\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{first}\r\n{:x}\r\n{second}\r\n0\r\n\r\n",
            first.len(),
            second.len()
        );
        stream.write_all(response.as_bytes()).await?;
        stream.shutdown().await
    });
    Ok(TestServer { socket, task })
}

#[test]
fn permission_errors_are_sanitized() {
    let error = SnapshotError::from_io(io::Error::new(io::ErrorKind::PermissionDenied, "private socket path"));
    assert_eq!(error, SnapshotError::PermissionDenied);
    assert_eq!(error.to_string(), "core_snapshot:permission_denied");
}

#[tokio::test]
async fn reads_native_ipc_chunked_proxies_and_providers() -> TestResult {
    for (kind, body, field) in [
        (
            CoreSnapshotKind::Proxies,
            r#"{"proxies":{"node":{"type":"Socks5"},"group":{"name":"group","type":"Selector","all":["node","DIRECT"],"now":"node"}}}"#,
            "proxies",
        ),
        (
            CoreSnapshotKind::Providers,
            r#"{"providers":{"test":{"proxies":[{"name":"node","type":"Socks5"}]}}}"#,
            "providers",
        ),
    ] {
        let mut server = serve_once(body, 200, Duration::ZERO, kind)?;
        let value = read_snapshot_at(&server.socket, kind).await?;
        assert!(value[field].is_object());
        if field == "proxies" {
            assert_eq!(value[field]["group"]["now"], "node");
            assert_eq!(value[field]["group"]["all"], json!(["node", "DIRECT"]));
        }
        (&mut server.task).await??;
    }
    Ok(())
}

#[tokio::test]
async fn classifies_native_ipc_response_failures() -> TestResult {
    for (body, status, expected) in [
        ("invalid json", 200, SnapshotError::InvalidJson),
        (r#"{"error":"wrong shape"}"#, 200, SnapshotError::InvalidShape),
        (r#"{"error":"unauthorized"}"#, 401, SnapshotError::Http),
    ] {
        let mut server = serve_once(body, status, Duration::ZERO, CoreSnapshotKind::Proxies)?;
        assert_eq!(
            read_snapshot_at(&server.socket, CoreSnapshotKind::Proxies).await,
            Err(expected)
        );
        (&mut server.task).await??;
    }
    Ok(())
}

#[tokio::test]
async fn native_ipc_timeout_is_bounded() -> TestResult {
    let server = serve_once(
        r#"{"proxies":{}}"#,
        200,
        Duration::from_secs(5),
        CoreSnapshotKind::Proxies,
    )?;
    assert_eq!(
        read_with_timeout(&server.socket, CoreSnapshotKind::Proxies, Duration::from_millis(100)).await,
        Err(SnapshotError::Timeout)
    );
    Ok(())
}

async fn wait_for_fixture<R, F>(mut read: R, timeout: Duration, interval: Duration) -> io::Result<serde_json::Value>
where
    R: FnMut() -> F,
    F: Future<Output = Result<serde_json::Value, SnapshotError>>,
{
    let deadline = tokio::time::Instant::now() + timeout;
    let mut attempts = 0;
    let mut last_reason = "no_response";
    let not_ready = |attempts, reason| {
        io::Error::new(
            io::ErrorKind::TimedOut,
            format!("core_fixture_not_ready attempts={attempts} last_reason={reason}"),
        )
    };
    loop {
        attempts += 1;
        match tokio::time::timeout_at(deadline, read()).await {
            Ok(Ok(value)) => {
                if let Some(reason) = fixture_pending_reason(&value) {
                    last_reason = reason;
                } else {
                    return Ok(value);
                }
            }
            Ok(Err(error @ (SnapshotError::Connection | SnapshotError::Timeout))) => last_reason = error.code(),
            Ok(Err(error)) => return Err(io::Error::other(error)),
            Err(_) => return Err(not_ready(attempts, last_reason)),
        }
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            return Err(not_ready(attempts, last_reason));
        }
        tokio::time::sleep(interval.min(remaining)).await;
    }
}

fn fixture_pending_reason(value: &serde_json::Value) -> Option<&'static str> {
    // The controller can serve JSON before configuration application is finished.
    let proxies = &value["proxies"];
    if proxies.get("test-node").is_none() {
        return Some("node_missing");
    }
    if proxies["test-node"]["type"] != "Socks5" {
        return Some("node_type_mismatch");
    }
    if proxies.get("test-group").is_none() {
        return Some("group_missing");
    }
    if proxies["test-group"]["now"] != "test-node" {
        return Some("selection_not_ready");
    }
    if proxies["test-group"]["all"] != json!(["test-node", "DIRECT"]) {
        return Some("targets_mismatch");
    }
    None
}

fn loaded_fixture() -> serde_json::Value {
    json!({"proxies": {
        "test-node": {"type": "Socks5"},
        "test-group": {"type": "Selector", "now": "test-node", "all": ["test-node", "DIRECT"]}
    }})
}

#[tokio::test]
async fn fixture_waits_for_config_after_api_becomes_available() -> TestResult {
    let mut replies = [
        json!({"proxies": {}}),
        json!({"proxies": {"DIRECT": {"type": "Direct"}}}),
        loaded_fixture(),
    ]
    .into_iter();
    let value = wait_for_fixture(
        || std::future::ready(Ok(replies.next().unwrap_or_else(loaded_fixture))),
        Duration::from_secs(1),
        Duration::from_millis(1),
    )
    .await?;
    assert_eq!(value["proxies"]["test-node"]["type"], "Socks5");
    Ok(())
}

#[tokio::test]
async fn fixture_wait_retries_transient_ipc_failures() -> TestResult {
    let mut replies = [
        Err(SnapshotError::Connection),
        Err(SnapshotError::Timeout),
        Ok(loaded_fixture()),
    ]
    .into_iter();
    let value = wait_for_fixture(
        || std::future::ready(replies.next().unwrap_or_else(|| Ok(loaded_fixture()))),
        Duration::from_secs(1),
        Duration::from_millis(1),
    )
    .await?;
    assert_eq!(value, loaded_fixture());
    Ok(())
}

#[tokio::test]
async fn fixture_wait_rejects_permanent_incomplete_or_wrong_configuration() -> TestResult {
    let mut wrong_type = loaded_fixture();
    wrong_type["proxies"]["test-node"]["type"] = "Direct".into();
    let missing_group = json!({"proxies": {"test-node": {"type": "Socks5"}}});
    let mut wrong_selection = loaded_fixture();
    wrong_selection["proxies"]["test-group"]["now"] = "DIRECT".into();
    let mut wrong_targets = loaded_fixture();
    wrong_targets["proxies"]["test-group"]["all"] = json!(["DIRECT"]);
    for (value, reason) in [
        (json!({"proxies": {}}), "node_missing"),
        (json!({"proxies": {"DIRECT": {"type": "Direct"}}}), "node_missing"),
        (wrong_type, "node_type_mismatch"),
        (missing_group, "group_missing"),
        (wrong_selection, "selection_not_ready"),
        (wrong_targets, "targets_mismatch"),
    ] {
        let result = wait_for_fixture(
            || std::future::ready(Ok(value.clone())),
            Duration::from_millis(25),
            Duration::from_millis(1),
        )
        .await;
        let error = result
            .err()
            .ok_or_else(|| io::Error::other("invalid fixture unexpectedly accepted"))?;
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(error.to_string().contains(reason));
    }
    Ok(())
}

#[tokio::test]
async fn fixture_wait_does_not_retry_invalid_responses() -> TestResult {
    let mut attempts = 0;
    let result = wait_for_fixture(
        || {
            attempts += 1;
            std::future::ready(Err(SnapshotError::InvalidShape))
        },
        Duration::from_secs(1),
        Duration::from_millis(1),
    )
    .await;
    let error = result
        .err()
        .ok_or_else(|| io::Error::other("invalid response unexpectedly accepted"))?;
    assert_eq!(error.to_string(), "core_snapshot:invalid_shape");
    assert_eq!(attempts, 1);
    Ok(())
}

#[tokio::test]
async fn fixture_wait_deadline_also_bounds_a_stalled_read() -> TestResult {
    let result = wait_for_fixture(
        std::future::pending,
        Duration::from_millis(25),
        Duration::from_millis(1),
    )
    .await;
    let error = result
        .err()
        .ok_or_else(|| io::Error::other("stalled read unexpectedly completed"))?;
    assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    assert!(error.to_string().contains("no_response"));
    Ok(())
}

#[tokio::test]
#[ignore = "run through scripts/tests/core-snapshot-smoke.mjs with an isolated core"]
async fn reads_real_mihomo_snapshot() -> TestResult {
    let socket = std::env::var("BLUELAYER_SMOKE_SOCKET")?;
    let value = wait_for_fixture(
        || read_snapshot_at(&socket, CoreSnapshotKind::Proxies),
        Duration::from_secs(20),
        Duration::from_millis(100),
    )
    .await?;
    assert_eq!(value["proxies"]["test-node"]["type"], "Socks5");
    assert_eq!(value["proxies"]["test-group"]["now"], "test-node");
    assert_eq!(value["proxies"]["test-group"]["all"], json!(["test-node", "DIRECT"]));
    let providers = read_snapshot_at(&socket, CoreSnapshotKind::Providers).await?;
    assert!(providers["providers"].is_object());
    Ok(())
}
