# Push Rule

- Update the `version` field in `package.json` before every `git push`.
- Use semantic versioning for the bump:
  - `patch` for fixes/chore updates.
  - `minor` for new backward-compatible features.
  - `major` for breaking changes.
- Do not push if `package.json` version was not updated in the current changes.
