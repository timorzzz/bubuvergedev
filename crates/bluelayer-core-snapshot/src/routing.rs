use crate::SnapshotError;
use serde_json::Value;
use std::collections::HashSet;

fn proxy_leaf<'a>(records: &'a serde_json::Map<String, Value>, start: &'a str) -> Option<&'a str> {
    let mut name = start;
    let mut seen = HashSet::new();
    while seen.len() < 128 && seen.insert(name) {
        if matches!(name, "GLOBAL" | "DIRECT" | "REJECT" | "REJECT-DROP" | "PASS") {
            return None;
        }
        let record = records.get(name)?;
        if record.get("all").is_some() {
            name = record.get("now")?.as_str()?;
        } else {
            let kind = record.get("type")?.as_str()?.to_ascii_lowercase();
            return (!matches!(kind.as_str(), "direct" | "reject" | "pass" | "unknown" | "compatible")).then_some(name);
        }
    }
    None
}

/// Choose a real GLOBAL member without changing any rule group's selection.
pub fn global_proxy_target(snapshot: &Value, preferred: &[&str]) -> Result<String, SnapshotError> {
    let records = snapshot["proxies"].as_object().ok_or(SnapshotError::InvalidShape)?;
    let global = records.get("GLOBAL").ok_or(SnapshotError::InvalidShape)?;
    let members = global["all"].as_array().ok_or(SnapshotError::InvalidShape)?;
    let candidate = |name: &str| {
        let leaf = proxy_leaf(records, name)?;
        if members.iter().any(|member| member.as_str() == Some(name)) {
            Some(name.to_owned())
        } else if members.iter().any(|member| member.as_str() == Some(leaf)) {
            Some(leaf.to_owned())
        } else {
            None
        }
    };
    for name in preferred {
        if let Some(target) = candidate(name) {
            return Ok(target);
        }
    }
    if let Some(target) = global["now"].as_str().and_then(candidate) {
        return Ok(target);
    }
    for name in members.iter().filter_map(Value::as_str) {
        if let Some(target) = candidate(name) {
            return Ok(target);
        }
    }
    Err(SnapshotError::InvalidShape)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        json!({"proxies": {
            "DIRECT": {"type":"Direct"}, "REJECT": {"type":"Reject"},
            "node-a": {"type":"Socks5"}, "node-b": {"type":"FutureProtocol"},
            "rules": {"type":"Selector","all":["node-a","node-b"],"now":"node-b"},
            "GLOBAL": {"type":"Selector","all":["DIRECT","REJECT","node-a","node-b","rules"],"now":"DIRECT"}
        }})
    }

    #[test]
    fn uses_the_chosen_rule_route_instead_of_default_direct() -> Result<(), SnapshotError> {
        let value = fixture();
        assert_eq!(global_proxy_target(&value, &["node-b", "rules"])?, "node-b");
        assert_eq!(value["proxies"]["rules"]["now"], "node-b");
        Ok(())
    }

    #[test]
    fn follows_nested_rule_groups_without_rewriting_them() -> Result<(), SnapshotError> {
        let mut value = fixture();
        value["proxies"]["nested"] = json!({"type":"Selector","all":["rules"],"now":"rules"});
        assert_eq!(global_proxy_target(&value, &["nested"])?, "node-b");
        Ok(())
    }

    #[test]
    fn preserves_a_valid_existing_global_choice() -> Result<(), SnapshotError> {
        let mut value = fixture();
        value["proxies"]["GLOBAL"]["now"] = "node-b".into();
        assert_eq!(global_proxy_target(&value, &[])?, "node-b");
        Ok(())
    }

    #[test]
    fn does_not_treat_direct_reject_missing_or_cycles_as_proxy_routes() -> Result<(), SnapshotError> {
        let mut value = fixture();
        value["proxies"]["loop"] = json!({"type":"Selector","all":["loop"],"now":"loop"});
        assert_eq!(
            global_proxy_target(&value, &["DIRECT", "REJECT", "loop", "missing"])?,
            "node-a"
        );
        value["proxies"]["GLOBAL"]["all"] = json!(["DIRECT", "REJECT", "loop"]);
        assert_eq!(global_proxy_target(&value, &[]), Err(SnapshotError::InvalidShape));
        Ok(())
    }
}
