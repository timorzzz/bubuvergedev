const PROXY_ENV_KEYS: [&str; 10] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "FTP_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "ftp_proxy",
    "no_proxy",
];

pub fn clear_process_proxy_env() {
    for key in PROXY_ENV_KEYS {
        if std::env::var_os(key).is_none() {
            continue;
        }

        // Keep Bluelayer network requests isolated from system/CMD proxy variables.
        // This only mutates the current process environment and does not touch the
        // user's Windows/macOS/Linux system environment settings.
        unsafe {
            std::env::remove_var(key);
        }
    }
}
