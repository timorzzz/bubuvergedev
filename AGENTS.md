# Change Records

- Record source, configuration, build, and workflow changes in `docs/change-records/`.
- Use one dated record per coherent change set: `YYYY-MM-DD-short-description.md`.
- Give each record a stable ID and include the actual timestamp in Asia/Shanghai
  (UTC+08:00), application version, baseline commit, cause, behavior changes,
  affected files/platforms, verification commands/results, and rollback notes.
- Update `docs/change-records/README.md` when adding a record. Update the current
  Bluelayer section in `Changelog.md` for user-visible changes.
- Keep prior records intact. Add later corrections with their own timestamps.
- Include `Change-Record: <record ID>` in the commit body so a record can locate
  its commit without embedding a self-referential commit hash.
- Record only checks actually run. Distinguish static checks, builds, runtime
  tests, user-reported results, and pending verification.
- Never put credentials, cookies, tokens, private subscription URLs, or personal
  account details in change records.
- Use `git revert` to undo published commits. Do not rewrite shared history or
  discard unrelated local changes during rollback.
