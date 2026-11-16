mod core;

#[cfg(feature = "client")]
mod client;

pub use core::{ClashConfig, CoreConfig, IpcCommand, WriterConfig};

#[cfg(feature = "standalone")]
pub use core::{run_ipc_server, stop_ipc_server};

#[cfg(feature = "client")]
pub use client::*;

#[cfg(all(unix, not(feature = "test")))]
pub static IPC_PATH: &str = "/tmp/bluelayer/bluelayer-mihomo-service.sock";
#[cfg(all(windows, not(feature = "test")))]
pub static IPC_PATH: &str = r"\\.\pipe\bluelayer-mihomo-service";

#[cfg(all(feature = "test", unix))]
pub static IPC_PATH: &str = "/tmp/bluelayer/bluelayer-mihomo-service-test.sock";
#[cfg(all(feature = "test", windows))]
pub static IPC_PATH: &str = r"\\.\pipe\bluelayer-mihomo-service-test";

#[cfg(any(feature = "standalone", feature = "client"))]
pub static IPC_AUTH_EXPECT: &str = r#"Bluelayer service IPC channel; keep traffic isolated."#;

pub static VERSION: &str = env!("CARGO_PKG_VERSION");

pub const MACOS_SERVICE_STARTUP_LOG: &str = "/Library/Logs/Bluelayer/service-startup.log";

#[cfg(all(test, feature = "standalone"))]
mod tests {
    #[test]
    fn launchd_captures_startup_errors_without_dumping_core_stdout() {
        let plist = include_str!("../resources/launchd.plist.tmpl");
        assert!(plist.contains(super::MACOS_SERVICE_STARTUP_LOG));
        assert!(plist.contains("<key>StandardErrorPath</key>"));
        assert!(!plist.contains("<key>StandardOutPath</key>"));
    }
}
