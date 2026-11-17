use super::{create_ipc_router, create_ipc_server};
use crate::{IPC_AUTH_EXPECT, IpcCommand, VERSION, core::structure::Response};
use anyhow::{Result, bail};
use kode_bridge::IpcHttpClient;
use std::{path::PathBuf, time::Duration};
use tokio::{task::JoinHandle, time::Instant};

struct ListenerTask(JoinHandle<kode_bridge::Result<()>>);

impl Drop for ListenerTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}

#[cfg(unix)]
struct SocketCleanup(PathBuf);

#[cfg(unix)]
impl Drop for SocketCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[tokio::test]
async fn configured_listener_serves_authenticated_version() -> Result<()> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_nanos();
    let name = format!("bl-listener-{}-{nonce}", std::process::id());
    #[cfg(unix)]
    let path = PathBuf::from("/tmp").join(format!("{name}.sock"));
    #[cfg(windows)]
    let path = PathBuf::from(format!(r"\\.\pipe\{name}"));
    #[cfg(unix)]
    let _cleanup = SocketCleanup(path.clone());

    // Exercise the production builder and kode-bridge listener, not a raw Tokio socket.
    // The unique endpoint never touches the installed service or its shared IPC directory.
    let mut server = create_ipc_server(&path)?.router(create_ipc_router()?);
    let mut listener = ListenerTask(tokio::spawn(async move { server.serve().await }));
    let client = IpcHttpClient::new(&path)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if listener.0.is_finished() {
            let result = (&mut listener.0).await?;
            bail!("Configured IPC listener exited before serving a request: {result:?}");
        }
        let request = async {
            client
                .get(IpcCommand::GetVersion.as_ref())
                .header("X-IPC-Magic", IPC_AUTH_EXPECT)
                .send()
                .await?
                .json::<Response<String>>()
        };
        let result = tokio::time::timeout(Duration::from_millis(250), request).await;
        if let Ok(Ok(response)) = &result {
            assert_eq!(response.code, 0);
            assert_eq!(response.data.as_deref(), Some(VERSION));
            return Ok(());
        }
        if Instant::now() >= deadline {
            bail!("Configured IPC listener did not serve the version request: {result:?}");
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}
