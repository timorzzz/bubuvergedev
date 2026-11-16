use kode_bridge::{KodeBridgeError, Result};
use std::{future::Future, io, time::Duration};
use tokio::{task::JoinHandle, time::Instant};

pub(super) async fn wait_for_listener<F, Fut>(
    mut probe: F,
    server: &mut JoinHandle<Result<()>>,
    timeout: Duration,
) -> Result<()>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = io::Result<()>>,
{
    let wait = async {
        loop {
            match probe().await {
                Ok(()) => return Ok(()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    tokio::time::sleep(Duration::from_millis(25)).await;
                }
                Err(error) => return Err(error.into()),
            }
        }
    };
    tokio::select! {
        biased;
        result = &mut *server => Err(KodeBridgeError::configuration(format!(
            "IPC listener exited before becoming ready: {result:?}"
        ))),
        result = tokio::time::timeout_at(Instant::now() + timeout, wait) => {
            result.unwrap_or_else(|_| Err(KodeBridgeError::configuration(
                "Timed out waiting for IPC listener socket"
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending_server() -> JoinHandle<Result<()>> {
        tokio::spawn(std::future::pending())
    }

    #[tokio::test]
    async fn listener_can_become_ready_later_than_fifty_milliseconds() -> Result<()> {
        let start = Instant::now();
        let mut server = pending_server();
        let result = wait_for_listener(
            || async {
                if start.elapsed() < Duration::from_millis(100) {
                    Err(io::ErrorKind::NotFound.into())
                } else {
                    Ok(())
                }
            },
            &mut server,
            Duration::from_secs(2),
        )
        .await;
        server.abort();
        result
    }

    #[tokio::test]
    async fn permission_failure_is_not_reported_as_a_missing_socket() {
        let mut server = pending_server();
        let result = wait_for_listener(
            || async { Err(io::Error::new(io::ErrorKind::PermissionDenied, "permission denied")) },
            &mut server,
            Duration::from_secs(1),
        )
        .await;
        server.abort();
        assert!(result.unwrap_err().to_string().contains("permission denied"));
    }

    #[tokio::test]
    async fn missing_socket_has_a_bounded_wait() {
        let mut server = pending_server();
        let result = wait_for_listener(
            || async { Err(io::ErrorKind::NotFound.into()) },
            &mut server,
            Duration::from_millis(40),
        )
        .await;
        server.abort();
        assert!(result.unwrap_err().to_string().contains("Timed out"));
    }

    #[tokio::test]
    async fn crashed_listener_returns_the_original_failure() {
        let mut server = tokio::spawn(async { Err(KodeBridgeError::configuration("bind failed")) });
        let result = wait_for_listener(
            || async { Err(io::ErrorKind::NotFound.into()) },
            &mut server,
            Duration::from_secs(1),
        )
        .await;
        assert!(result.unwrap_err().to_string().contains("bind failed"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn native_unix_socket_created_after_delay_becomes_ready() -> Result<()> {
        use std::{fs::Permissions, os::unix::fs::PermissionsExt as _, path::PathBuf};
        let name = format!(
            "bl-ready-{}-{}.sock",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        // macOS temporary home paths can exceed sockaddr_un's path limit.
        let path = PathBuf::from("/tmp").join(name);
        struct SocketCleanup(PathBuf);
        impl Drop for SocketCleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _cleanup = SocketCleanup(path.clone());
        let server_path = path.clone();
        let mut server = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(120)).await;
            let _listener = tokio::net::UnixListener::bind(server_path)?;
            std::future::pending::<Result<()>>().await
        });
        let result = wait_for_listener(
            || tokio::fs::set_permissions(&path, Permissions::from_mode(0o660)),
            &mut server,
            Duration::from_secs(3),
        )
        .await;
        server.abort();
        result
    }
}
