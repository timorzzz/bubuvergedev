use clash_verge_logging::{Type, logging};
use once_cell::sync::Lazy;
use regex::Regex;
use std::{path::Path, time::Duration};

pub(crate) fn sanitize(message: &str) -> String {
    let mut message = message.to_owned();
    for key in ["HOME", "USERPROFILE"] {
        if let Ok(home) = std::env::var(key)
            && home.len() > 3
        {
            message = message.replace(&home, "[home]");
        }
    }
    static PRIVATE: Lazy<Option<Regex>> = Lazy::new(|| {
        Regex::new(concat!(
            r"(?i)https?://[^\s<>]+|socks5?://[^\s<>]+|",
            r"[a-z]:[\\/][^\s<>]+|/(?:Users|home)/[^\s<>]+|",
            r"[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}|",
            r"(?:token|cookie|password|authorization)\s*[:=][^\r\n]*"
        ))
        .ok()
    });
    let Some(pattern) = PRIVATE.as_ref() else {
        return "[service diagnostic redaction unavailable]".to_owned();
    };
    let redacted = pattern.replace_all(&message, "[redacted]");
    redacted
        .chars()
        .filter(|character| !character.is_control() || character.is_whitespace())
        .take(2048)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn status_fields(output: &str) -> Vec<String> {
    const FIELDS: &[&str] = &[
        "state",
        "pid",
        "runs",
        "last exit code",
        "last terminating signal",
        "spawn error",
        "LoadState",
        "ActiveState",
        "SubState",
        "Result",
        "ExecMainCode",
        "ExecMainStatus",
        "MainPID",
        "STATE",
        "WIN32_EXIT_CODE",
        "SERVICE_EXIT_CODE",
        "CHECKPOINT",
        "WAIT_HINT",
        "PID",
    ];
    output
        .lines()
        .filter_map(|line| {
            let (key, value) = line.trim().split_once(['=', ':'])?;
            let key = key.trim();
            FIELDS
                .contains(&key)
                .then(|| format!("{}={}", key, sanitize(value.trim())))
        })
        .take(16)
        .collect()
}

pub(crate) async fn log_failure(operation: &str, error: &anyhow::Error) {
    logging!(
        error,
        Type::Service,
        "[ServiceDiag] operation={} platform={} arch={} error={}",
        operation,
        std::env::consts::OS,
        std::env::consts::ARCH,
        sanitize(&format!("{error:#}"))
    );
    log_path("ipc_socket", Path::new(clash_verge_service_ipc::IPC_PATH));
    if let Some(parent) = Path::new(clash_verge_service_ipc::IPC_PATH).parent() {
        log_path("ipc_directory", parent);
    }

    #[cfg(target_os = "macos")]
    let (program, args) = ("/bin/launchctl", vec!["print", "system/uk.bluelayer.client.service"]);
    #[cfg(target_os = "linux")]
    let (program, args) = (
        "systemctl",
        vec![
            "show",
            "bluelayer-mihomo-service.service",
            "--no-pager",
            "--property=LoadState,ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,MainPID",
        ],
    );
    #[cfg(windows)]
    let (program, args) = ("sc.exe", vec!["queryex", "bluelayer_mihomo_service"]);

    let mut command = tokio::process::Command::new(program);
    command.args(args).kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    match tokio::time::timeout(Duration::from_secs(3), command.output()).await {
        Ok(Ok(output)) => {
            // Do not log the complete launchctl output: it can contain environment variables.
            let fields = status_fields(&String::from_utf8_lossy(&output.stdout));
            logging!(
                warn,
                Type::Service,
                "[ServiceDiag] system_service query_exit={:?} {}",
                output.status.code(),
                fields.join(" ")
            );
        }
        Ok(Err(error)) => logging!(
            warn,
            Type::Service,
            "[ServiceDiag] system_service query_error={:?}",
            error.kind()
        ),
        Err(_) => logging!(warn, Type::Service, "[ServiceDiag] system_service query_timeout=true"),
    }
    #[cfg(target_os = "macos")]
    log_macos_startup_stderr().await;
}

#[cfg(target_os = "macos")]
async fn log_macos_startup_stderr() {
    use tokio::io::{AsyncReadExt as _, AsyncSeekExt as _};
    let result = async {
        let mut file = tokio::fs::File::open(clash_verge_service_ipc::MACOS_SERVICE_STARTUP_LOG).await?;
        let length = file.metadata().await?.len();
        file.seek(std::io::SeekFrom::Start(length.saturating_sub(8192))).await?;
        let mut bytes = Vec::new();
        file.take(8192).read_to_end(&mut bytes).await?;
        Ok::<_, std::io::Error>(bytes)
    }
    .await;
    match result {
        Ok(bytes) => {
            for line in String::from_utf8_lossy(&bytes)
                .lines()
                .rev()
                .take(12)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
            {
                logging!(warn, Type::Service, "[ServiceDiag] startup_stderr={}", sanitize(line));
            }
        }
        Err(error) => logging!(
            warn,
            Type::Service,
            "[ServiceDiag] startup_stderr unavailable={:?}",
            error.kind()
        ),
    }
}

fn log_path(label: &str, path: &Path) {
    match path.metadata() {
        Ok(metadata) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt as _;
                logging!(
                    warn,
                    Type::Service,
                    "[ServiceDiag] {} exists=true uid={} gid={} mode={:o}",
                    label,
                    metadata.uid(),
                    metadata.gid(),
                    metadata.mode() & 0o7777
                );
            }
            #[cfg(windows)]
            {
                let _ = metadata;
                logging!(warn, Type::Service, "[ServiceDiag] {} exists=true", label);
            }
        }
        Err(error) => logging!(
            warn,
            Type::Service,
            "[ServiceDiag] {} metadata_error={:?} os_code={:?}",
            label,
            error.kind(),
            error.raw_os_error()
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_retains_stage_and_native_code_without_personal_data() {
        let result = sanitize(concat!(
            "stage=launchd_bootstrap exit=5 /Users/private-user/service-bin/helper ",
            "C:\\Users\\private-user\\helper.exe https://private.invalid/auth?token=secret ",
            "private@example.invalid cookie=secret password=secret"
        ));
        assert!(result.contains("stage=launchd_bootstrap exit=5"));
        for private in ["private-user", "private.invalid", "example.invalid", "secret"] {
            assert!(!result.contains(private), "{result}");
        }
    }

    #[test]
    fn service_status_does_not_capture_environment_or_executable_paths() {
        let fields = status_fields(concat!(
            "state = spawn scheduled\nlast exit code = 78\npid = 123\n",
            "TOKEN = secret\nprogram = /Users/private/helper\nHOME = /Users/private\n"
        ));
        assert_eq!(fields, ["state=spawn scheduled", "last exit code=78", "pid=123"]);
    }

    #[test]
    fn windows_and_linux_status_fields_are_preserved() {
        assert_eq!(
            status_fields("STATE : 1 STOPPED\nWIN32_EXIT_CODE : 1067\nSERVICE_EXIT_CODE : 0"),
            ["STATE=1 STOPPED", "WIN32_EXIT_CODE=1067", "SERVICE_EXIT_CODE=0"]
        );
        assert_eq!(
            status_fields("ActiveState=failed\nResult=exit-code\nExecMainStatus=1"),
            ["ActiveState=failed", "Result=exit-code", "ExecMainStatus=1"]
        );
    }

    #[test]
    fn diagnostic_text_is_bounded() {
        assert_eq!(sanitize(&"x".repeat(5000)).len(), 2048);
    }

    #[test]
    fn multiword_credentials_cannot_leak_into_a_diagnostic() {
        assert_eq!(
            sanitize("stage=ipc Authorization: Bearer secret token\nexit=5"),
            "stage=ipc [redacted] exit=5"
        );
        assert_eq!(sanitize("Cookie: id=secret; session=private"), "[redacted]");
    }
}
