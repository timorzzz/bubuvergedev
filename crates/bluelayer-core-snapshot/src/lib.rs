use http_body_util::{BodyExt as _, Empty};
use hyper::{Request, body::Bytes, client::conn::http1};
use hyper_util::rt::TokioIo;
use serde_json::{Value, json};
use std::{fmt, io, time::Duration};
use tokio::io::{AsyncRead, AsyncWrite};

pub mod routing;

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoreSnapshotKind {
    Proxies,
    Providers,
    Config,
}

impl CoreSnapshotKind {
    pub const fn path(self) -> &'static str {
        match self {
            Self::Proxies => "/proxies",
            Self::Providers => "/providers/proxies",
            Self::Config => "/configs",
        }
    }
}

// Fixed errors deliberately exclude URLs, socket paths and response contents.
#[derive(Debug, PartialEq, Eq)]
pub enum SnapshotError {
    Connection,
    PermissionDenied,
    Timeout,
    Http,
    InvalidJson,
    InvalidShape,
}

impl SnapshotError {
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Connection => "core_snapshot:ipc",
            Self::PermissionDenied => "core_snapshot:permission_denied",
            Self::Timeout => "core_snapshot:timeout",
            Self::Http => "core_snapshot:http",
            Self::InvalidJson => "core_snapshot:invalid_payload",
            Self::InvalidShape => "core_snapshot:invalid_shape",
        }
    }

    fn from_io(error: io::Error) -> Self {
        if error.kind() == io::ErrorKind::PermissionDenied {
            Self::PermissionDenied
        } else {
            Self::Connection
        }
    }
}

impl fmt::Display for SnapshotError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for SnapshotError {}

pub async fn read_snapshot_at(socket: &str, kind: CoreSnapshotKind) -> Result<Value, SnapshotError> {
    read_with_timeout(socket, kind, Duration::from_secs(2)).await
}

async fn read_with_timeout(socket: &str, kind: CoreSnapshotKind, timeout: Duration) -> Result<Value, SnapshotError> {
    tokio::time::timeout(timeout, async {
        #[cfg(windows)]
        let stream = tokio::net::windows::named_pipe::ClientOptions::new()
            .open(socket)
            .map_err(SnapshotError::from_io)?;
        #[cfg(unix)]
        let stream = tokio::net::UnixStream::connect(socket)
            .await
            .map_err(SnapshotError::from_io)?;
        let value = read_json(stream, kind.path()).await?;
        normalize_snapshot(value, kind)
    })
    .await
    .map_err(|_| SnapshotError::Timeout)?
}

async fn read_json<S>(stream: S, path: &'static str) -> Result<Value, SnapshotError>
where
    S: AsyncRead + AsyncWrite + Send + Unpin + 'static,
{
    let (mut sender, connection) = http1::handshake(TokioIo::new(stream))
        .await
        .map_err(|_| SnapshotError::Connection)?;
    let driver = tokio::spawn(connection);
    scopeguard::defer! { driver.abort(); }
    let request = Request::builder()
        .uri(path)
        .header("Host", "localhost")
        .header("Connection", "close")
        .body(Empty::<Bytes>::new())
        .map_err(|_| SnapshotError::Http)?;
    let response = sender
        .send_request(request)
        .await
        .map_err(|_| SnapshotError::Connection)?;
    if !response.status().is_success() {
        return Err(SnapshotError::Http);
    }
    let bytes = response
        .into_body()
        .collect()
        .await
        .map_err(|_| SnapshotError::Connection)?
        .to_bytes();
    serde_json::from_slice(&bytes).map_err(|_| SnapshotError::InvalidJson)
}

fn normalize_proxy(value: &mut Value, fallback_name: Option<&str>) -> Result<(), SnapshotError> {
    let proxy = value.as_object_mut().ok_or(SnapshotError::InvalidShape)?;
    if !proxy.get("type").is_some_and(Value::is_string) {
        return Err(SnapshotError::InvalidShape);
    }
    if !proxy.get("name").is_some_and(Value::is_string) {
        let name = fallback_name.ok_or(SnapshotError::InvalidShape)?;
        proxy.insert("name".into(), name.into());
    }
    if let Some(all) = proxy.get("all")
        && !all.as_array().is_some_and(|items| items.iter().all(Value::is_string))
    {
        return Err(SnapshotError::InvalidShape);
    }
    if proxy.get("history").is_none_or(Value::is_null) {
        proxy.insert("history".into(), json!([]));
    }
    if proxy.get("extra").is_none_or(Value::is_null) {
        proxy.insert("extra".into(), json!({}));
    }
    for key in ["udp", "uot", "xudp", "tfo", "mptcp", "smux"] {
        proxy.entry(key).or_insert(json!(false));
    }
    proxy.entry("alive").or_insert(json!(true));
    for (source, target) in [("dialer-proxy", "dialerProxy"), ("routing-mark", "routingMark")] {
        if let Some(value) = proxy.get(source).cloned() {
            proxy.entry(target).or_insert(value);
        }
    }
    Ok(())
}

pub fn normalize_snapshot(mut value: Value, kind: CoreSnapshotKind) -> Result<Value, SnapshotError> {
    match kind {
        CoreSnapshotKind::Config => {
            let config = value.as_object().ok_or(SnapshotError::InvalidShape)?;
            if !matches!(
                config.get("mode").and_then(Value::as_str),
                Some("rule" | "global" | "direct")
            ) {
                return Err(SnapshotError::InvalidShape);
            }
        }
        CoreSnapshotKind::Proxies => {
            let proxies = value
                .get_mut("proxies")
                .and_then(Value::as_object_mut)
                .ok_or(SnapshotError::InvalidShape)?;
            for (name, proxy) in proxies {
                normalize_proxy(proxy, Some(name))?;
            }
        }
        CoreSnapshotKind::Providers => {
            let providers = value
                .get_mut("providers")
                .and_then(Value::as_object_mut)
                .ok_or(SnapshotError::InvalidShape)?;
            for provider in providers.values_mut() {
                let provider = provider.as_object_mut().ok_or(SnapshotError::InvalidShape)?;
                let proxies = provider.entry("proxies").or_insert(json!([]));
                if proxies.is_null() {
                    *proxies = json!([]);
                }
                for proxy in proxies.as_array_mut().ok_or(SnapshotError::InvalidShape)? {
                    normalize_proxy(proxy, None)?;
                }
            }
        }
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::{CoreSnapshotKind, SnapshotError, normalize_snapshot};
    use serde_json::json;

    #[test]
    fn config_mode_is_required_but_optional_schema_fields_are_not() -> Result<(), SnapshotError> {
        for mode in ["rule", "global", "direct"] {
            let value = normalize_snapshot(
                json!({"mode": mode, "tun": {"stack": "future-stack"}}),
                CoreSnapshotKind::Config,
            )?;
            assert_eq!(value["mode"], mode);
        }
        for value in [json!(null), json!([]), json!({}), json!({"mode": "unknown"})] {
            assert_eq!(
                normalize_snapshot(value, CoreSnapshotKind::Config),
                Err(SnapshotError::InvalidShape)
            );
        }
        Ok(())
    }

    #[test]
    fn accepts_new_protocols_and_optional_metadata() -> Result<(), SnapshotError> {
        let input = json!({"proxies": {"node": {"type": "FutureProtocol", "routing-mark": 1024}}});
        let value = normalize_snapshot(input, CoreSnapshotKind::Proxies)?;
        assert_eq!(value["proxies"]["node"]["name"], "node");
        assert_eq!(value["proxies"]["node"]["type"], "FutureProtocol");
        assert_eq!(value["proxies"]["node"]["history"], json!([]));
        assert_eq!(value["proxies"]["node"]["routingMark"], 1024);
        Ok(())
    }

    #[test]
    fn rejects_wrong_response_shape() {
        for value in [
            json!({}),
            json!({"proxies": []}),
            json!({"proxies": {"node": {"type": 123}}}),
        ] {
            assert_eq!(
                normalize_snapshot(value, CoreSnapshotKind::Proxies),
                Err(SnapshotError::InvalidShape)
            );
        }
    }

    #[test]
    fn preserves_provider_targets() -> Result<(), SnapshotError> {
        let input =
            json!({"providers": {"test": {"vehicleType": "HTTP", "proxies": [{"name": "node", "type": "Socks5"}]}}});
        let value = normalize_snapshot(input, CoreSnapshotKind::Providers)?;
        assert_eq!(value["providers"]["test"]["proxies"][0]["history"], json!([]));
        assert_eq!(value["providers"]["test"]["vehicleType"], "HTTP");
        Ok(())
    }
}

#[cfg(test)]
mod native_tests;
