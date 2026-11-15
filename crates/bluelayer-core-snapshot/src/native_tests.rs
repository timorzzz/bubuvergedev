use super::{CoreSnapshotKind, SnapshotError, read_snapshot_at, read_with_timeout};
use serde_json::json;
use std::{
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

#[tokio::test]
#[ignore = "run through scripts/tests/core-snapshot-smoke.mjs with an isolated core"]
async fn reads_real_mihomo_snapshot() -> TestResult {
    let socket = std::env::var("BLUELAYER_SMOKE_SOCKET")?;
    let started = std::time::Instant::now();
    let value = loop {
        match read_snapshot_at(&socket, CoreSnapshotKind::Proxies).await {
            Ok(value) => break value,
            Err(SnapshotError::Connection | SnapshotError::Timeout) if started.elapsed() < Duration::from_secs(10) => {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            Err(error) => return Err(error.into()),
        }
    };
    assert_eq!(value["proxies"]["test-node"]["type"], "Socks5");
    assert_eq!(value["proxies"]["test-group"]["now"], "test-node");
    assert_eq!(value["proxies"]["test-group"]["all"], json!(["test-node", "DIRECT"]));
    let providers = read_snapshot_at(&socket, CoreSnapshotKind::Providers).await?;
    assert!(providers["providers"].is_object());
    Ok(())
}
