use super::CmdResult;
use crate::utils::dirs;
use bluelayer_core_snapshot::{CoreSnapshotKind, SnapshotError, read_snapshot_at};
use clash_verge_logging::{Type, logging};
use serde_json::Value;
use std::time::Instant;

#[tauri::command]
pub async fn read_bluelayer_core_snapshot(kind: CoreSnapshotKind) -> CmdResult<Value> {
    let started = Instant::now();
    let socket = dirs::ipc_path().map_err(|_| SnapshotError::Connection.code())?;
    let result = read_snapshot_at(socket.to_string_lossy().as_ref(), kind).await;
    result.map_err(|error| {
        logging!(
            warn,
            Type::Core,
            "[BluelayerDiag] snapshot_failed operation={} reason={} elapsed_ms={}",
            kind.path(),
            error.code(),
            started.elapsed().as_millis()
        );
        error.code().into()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use bluelayer_core_snapshot::normalize_snapshot;
    use serde_json::json;

    #[test]
    fn schema_changes_fail_legacy_model_individually_but_keep_snapshot_readable() -> Result<(), SnapshotError> {
        let legacy = json!({"proxies": {"node": {
            "name": "node", "type": "Socks5", "alive": true, "history": [], "extra": {},
            "udp": false, "uot": false, "xudp": false, "tfo": false, "mptcp": false,
            "smux": false, "interface": "", "dialer-proxy": "", "routing-mark": 0
        }}});
        assert!(serde_json::from_value::<tauri_plugin_mihomo::models::Proxies>(legacy.clone()).is_ok());
        let mut missing_metadata = legacy.clone();
        missing_metadata["proxies"]["node"]
            .as_object_mut()
            .ok_or(SnapshotError::InvalidShape)?
            .remove("extra");
        let mut new_type = legacy.clone();
        new_type["proxies"]["node"]["type"] = "FutureProtocol".into();
        let mut wider_mark = legacy;
        wider_mark["proxies"]["node"]["routing-mark"] = 1024.into();
        for input in [missing_metadata, new_type, wider_mark] {
            assert!(serde_json::from_value::<tauri_plugin_mihomo::models::Proxies>(input.clone()).is_err());
            let snapshot = normalize_snapshot(input, CoreSnapshotKind::Proxies)?;
            assert_eq!(snapshot["proxies"]["node"]["name"], "node");
        }
        Ok(())
    }
}
