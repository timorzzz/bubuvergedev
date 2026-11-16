use anyhow::{Context as _, Result};

const SERVICE: &str = "system/uk.bluelayer.client.service";
const PLIST: &str = "/Library/LaunchDaemons/uk.bluelayer.client.service.plist";

pub fn unload_existing(mut run: impl FnMut(&[&str]) -> Result<()>) -> Result<()> {
    if run(&["print", SERVICE]).is_ok() {
        run(&["bootout", SERVICE]).context("stage=launchd_bootout")?;
    }
    Ok(())
}

pub fn start(mut run: impl FnMut(&[&str]) -> Result<()>) -> Result<()> {
    run(&["enable", SERVICE]).context("stage=launchd_enable")?;
    run(&["bootstrap", "system", PLIST]).context("stage=launchd_bootstrap")?;
    // RunAtLoad starts the daemon during bootstrap; do not race it with another start.
    run(&["print", SERVICE]).context("stage=launchd_registration")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_install_does_not_require_a_registered_service() -> Result<()> {
        let mut calls = Vec::new();
        unload_existing(|args| {
            calls.push(args[0].to_owned());
            anyhow::bail!("service not registered")
        })?;
        assert_eq!(calls, ["print"]);
        Ok(())
    }

    #[test]
    fn existing_service_must_stop_before_files_are_replaced() {
        let result = unload_existing(|args| {
            if args[0] == "bootout" {
                anyhow::bail!("permission denied");
            }
            Ok(())
        });
        assert!(format!("{:#}", result.unwrap_err()).contains("stage=launchd_bootout"));
    }

    #[test]
    fn launchd_failure_stops_installation_and_preserves_stage_and_cause() {
        for (failed, stage) in [
            ("enable", "launchd_enable"),
            ("bootstrap", "launchd_bootstrap"),
            ("print", "launchd_registration"),
        ] {
            let mut calls = Vec::new();
            let result = start(|args| {
                calls.push(args[0].to_owned());
                if args[0] == failed {
                    anyhow::bail!("native command failed: exit=5");
                }
                Ok(())
            });
            let error = format!("{:#}", result.unwrap_err());
            assert!(error.contains(stage));
            assert!(error.contains("exit=5"));
            assert_eq!(calls.last().map(String::as_str), Some(failed));
        }
    }

    #[test]
    fn launchd_success_uses_only_the_bluelayer_system_service() -> Result<()> {
        let mut calls = Vec::new();
        start(|args| {
            calls.push(args.iter().map(|arg| arg.to_string()).collect::<Vec<_>>());
            Ok(())
        })?;
        assert_eq!(calls[0], ["enable", SERVICE]);
        assert_eq!(calls[1], ["bootstrap", "system", PLIST]);
        assert_eq!(calls[2], ["print", SERVICE]);
        Ok(())
    }
}
