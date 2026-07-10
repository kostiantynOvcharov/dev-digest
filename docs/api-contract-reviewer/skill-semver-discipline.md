# SemVer discipline — when a change forces a MAJOR bump

Any backward-**incompatible** change to the public API forces a **MAJOR** version
bump. If the diff makes such a change without a major bump, the contract and the
version disagree — flag it.

MAJOR (breaking) — requires a major version bump:
- Removed or renamed route, method, or response field.
- Changed/narrowed field type; non-null field made nullable; new required request field.
- Removed enum value a response can return; changed default that alters output.

MINOR (additive, backward-compatible) — no major bump needed:
- New optional response field, new optional request field, new endpoint.

PATCH — bug fix with no contract change.

## Bad

```diff
 // package.json
-  "version": "2.4.1",
+  "version": "2.4.2",   // PATCH — but the diff removes the `userId` field (breaking)
```

## Good

```diff
 // package.json
-  "version": "2.4.1",
+  "version": "3.0.0",   // MAJOR — matches the removed/renamed public field
```

Flag as: **CRITICAL** when the diff contains a breaking contract change but the
version bump is not MAJOR (or is absent). Cite both the breaking diff line and the
version line.
