# Changelog

Public changelog for the `azure-icons-for-architecture-diagrams` project — covers both the icons track (`icons-vX.Y.Z`) and the skill track (`skill-vX.Y.Z`). One section per release.

Drafted on 2026-05-14 from existing GitHub Release tags. From `skill-v0.10.0` onward, each release commit updates this file in lockstep.

---

## skill-v1.4.2 — 2026-05-19

- CLI: top-level version flag renamed `-V, --cli-version` so the subcommand `install --version <semver>` no longer short-circuits to the version printer and correctly pins the bundle source.
- CLI: frontmatter parser replaced with `js-yaml` (handles folded scalars + multi-line description values); `js-yaml@4.1.1` added as a runtime dependency.
- CLI: dependency refresh (TypeScript 5.9.3, `@types/node` 22.18.0); `npm audit` clean.
- New `Makefile` with a one-time `make setup` (enables the leak-check pre-push hook + verifies prerequisites) plus `smoke-cli` / `smoke-urls` / `test-fixture-drift` shortcuts.
- Content-only skill bump; icons unchanged at `icons-v1.4.0`.
- Chat-UI distribution: `chat-ui-bundle.zip` (SKILL.md + per-vendor INDEX + worked examples + per-vendor USAGE-RULES + NOTICE) attached to this release for upload into a Claude.ai Project or ChatGPT Custom GPT; setup recipes under `docs/chat-ui-distribution/`. Bundle build is byte-reproducible (`scripts/build_chat_ui_bundle.sh` + `bundle-repro` CI job).

## skill-v1.4.1 — 2026-05-18

- SKILL.md filename-enforcement hardening: a non-negotiable rule that every `<img:URL>` filename be copied verbatim from the relevant per-vendor `INDEX.md` (guessing a filename returns a silent 404 / broken image), plus a casing-quirks table, a WRONG/RIGHT anti-example, and a per-vendor INDEX guide.
- Content-only skill bump; icons unchanged at `icons-v1.4.0`.

## icons-v1.4.0 — 2026-05-18

- Added the Devicon dev-tool icon set: 149 curated dev-tool brand icons (`-original` variant at 48px) from `devicons/devicon` (MIT, community-maintained). Brings the library to five vendors (Azure + Fabric + Kubernetes + FluentUI + Devicon).

## skill-v1.4.0 — 2026-05-18

- Skill covers all five icon sources; added a DevOps-pipeline worked example (`09-devops-pipeline.puml`) combining Devicon dev tools + Azure + Kubernetes.
- `release-icons.yml` excludes non-vendor companion directories from the per-vendor release zips.

## icons-v1.3.0 — 2026-05-18

- Added the Microsoft FluentUI System Icons decorator subset: 75 PNGs (25 curated concepts × 3 sizes, `_color` variant) from `microsoft/fluentui-system-icons` (MIT, first-party).

## skill-v1.3.0 — 2026-05-18

- Added a UI-decorated worked example (`08-azure-fluentui-mixed.puml`) — Azure backbone with FluentUI status/action decorators.

## skill-v1.2.1 — 2026-05-17

- Fixed an incorrect `AzureSqlDatabase` filename in the mixed AKS example (`07-azure-aks-mixed.puml`).
- `release-icons.yml` auto-discovers `dist/<Vendor>/` directories when building per-vendor release zips.

## icons-v1.2.0 — 2026-05-17

- Added the Kubernetes icon set: 148 PNGs from `kubernetes/community` (CNCF / Linux Foundation, Apache-2.0 OR CC-BY-4.0 dual grant).

## skill-v1.2.0 — 2026-05-17

- Added a mixed Azure + Kubernetes worked example (`07-azure-aks-mixed.puml`).
- Added `docs/marketplace-listings.md` (public skill-index decision matrix).

## icons-v1.1.0 — 2026-05-16

- Per-vendor `INDEX.md` catalogs added under each `dist/<Vendor>/` directory (flat, greppable: path + human name + description + tags) to support filename lookup.

## skill-v1.1.0 — 2026-05-16

- SKILL.md instructs agents to fetch the relevant per-vendor `INDEX.md` and look up icon filenames before emitting `<img:URL>` tokens.

## icons-v1.0.0 — 2026-05-14

- First `1.0.0` icon-library release (Azure + Fabric); SemVer compatibility commitment begins on the icons track.

## skill-v1.0.0 — 2026-05-14

- First `1.0.0` skill release: multi-agent install (Claude Code, Codex CLI, Cursor), full CLI reference, troubleshooting guide, and a self-service onboarding UAT kit. SemVer compatibility commitment begins on the skill track.

## skill-v0.10.0 — 2026-05-14

- Cursor adapter `update` now short-circuits to a no-op when the installed `.mdc` provenance version matches the upstream manifest version (parity with Claude Code + Codex from v0.9.0).
- `packages/cli/README.md` rewritten — lists all three supported agents, `--agent=all`, and `--version=X.Y.Z`.
- `release-icons.yml` release notes include a zip-layout hint.
- `update-icons.yml` cron is now serialized via `concurrency:` group + carries a `${{ github.run_id }}` branch-name suffix to prevent same-day collision; an `if: failure()` catch-all watchdog opens an issue when any non-monitor step fails.
- `leak-check.yml` regex broadened to `\bR[0-9]+\b` (single-digit review-finding IDs also flagged); `tests/leak-fixtures.txt` extended accordingly.
- Bash unit tests for `scripts/_lib_icon_build.sh` + fixture-based tests for `scripts/monitor_ms_tou.sh`, both gated by a new `bash-tests` job in `ci.yml`.
- Internal: 47 deep-review findings closed; `_shared.ts` polish (load-bearing `PERSISTED_MANIFEST_BASENAME` comment, semver pre-release note, import hoist, drop transitional re-export shims in adapters).

## icons-v0.2.3 — 2026-05-13

- Test tag (content-identical to `icons-v0.2.2`) exercising the new `release-icons.yml` workflow end-to-end. Two asset zips: `dist-azure-icons-v0.2.3.zip` + `dist-fabric-icons-v0.2.3.zip`.

## skill-v0.9.0 — 2026-05-13

- New `release-icons.yml` workflow — `icons-v*` tag push creates a GitHub Release with Azure + Fabric zip assets. Removes the manual-tag SPOF that `--version=X.Y.Z` previously depended on.
- New `update-icons.yml` workflow — weekly cron + `workflow_dispatch`. Fetches upstream Azure-PlantUML + `@fabric-msft/svg-icons`, opens a PR on diff. Gated by two upstream-health monitors (`monitor_ms_tou.sh` + `monitor_azure_plantuml_health.sh`); failure opens a watchdog issue and halts.
- New `scripts/_lib_icon_build.sh` shared library — consolidates the 7 build hardenings from `build_azure.sh` + `build_fabric.sh`.
- `update` now idempotent: short-circuits to a no-op when the on-disk version matches the upstream manifest version (Claude Code + Codex; Cursor parity in v0.10.0).
- `uninstall` is manifest-scoped: reads the install-time persisted manifest at `<target>/.azure-arch-skill-manifest.json` and removes only those files, preserving any user-authored content alongside the skill.

## skill-v0.8.0 — 2026-05-13

- `dist/skill/manifest.json` now records an exact `icons_version: "X.Y.Z"` field; `verifyIconsAvailability` prefers it over the previous `requires_icons` lower-bound inference. Fallback path preserves install for pre-v0.8.0 tags that don't carry the field.

## skill-v0.7.0 — 2026-05-13

- `--version=X.Y.Z` flag wired through every subcommand. Resolves the bundle source URL to `raw.githubusercontent.com/.../skill-vX.Y.Z/`. Default = `main`.
- Hand-rolled `satisfiesRequiresIcons` semver matcher (`>=`, `^`, `~`, exact).

## skill-v0.6.0 — 2026-05-13

- `--agent=all` flag — fans out across the three supported agents. Transactional for `install` / `update` (rolls back on first failure); best-effort for `uninstall` / `list`.

## skill-v0.5.0 — 2026-05-13

- Cursor adapter (`--agent=cursor`). Installs to `<cwd>/.cursor/rules/azure-arch-skill.mdc` — per-project install model.

## skill-v0.4.0 — 2026-05-12

- Codex CLI adapter (`--agent=codex`). Installs to `~/.codex/skills/<name>/SKILL.md`.

## skill-v0.3.1 — 2026-05-12

- Adapter-prerequisite sweep: shared helpers extracted to `_shared.ts`; round-trip adapter tests; new `ci.yml` workflow; `release-skill.yml` adds an `npm test` gate before publish.

## skill-v0.3.0 — 2026-05-12

- Bundled `dist/skill/manifest.json` (+ schema). 4 new example diagrams: `03-system-architecture.puml`, `04-sequence-flow.puml`, `05-component.puml`, `06-deployment.puml`.

## icons-v0.2.2 — 2026-05-11

- Microsoft Fabric multi-size patch: 312 icons across sizes 24, 28, 32, 40, 48.

## skill-v0.2.2 — 2026-05-11

- Mirror SKILL.md update for the v0.2.2 Fabric multi-size patch.

## icons-v0.2.1 — 2026-05-11

- Fabric scope-widening patch: 65 Fabric icons (was the initial v0.2.0 set of 17).

## skill-v0.2.1 — 2026-05-11

- Mirror SKILL.md update for the v0.2.1 Fabric scope-widening patch.

## icons-v0.2.0 — 2026-05-11

- Microsoft Fabric icons added. `dist/Fabric/png/<service>_<size>_<suffix>.png`. NOTICE extended for Fabric attribution + ToU + Trademark Guidelines.

## skill-v0.2.0 — 2026-05-11

- Fabric section in SKILL.md + `02-fabric-data-pipeline.puml` worked example.
- `requires_icons: ">=0.2.0"` (breaking on icons track).

## skill-v0.1.1 — 2026-05-11

- Script hardening sweep: 7 build-script improvements, `smoke_urls.sh` per-category sampling, network-retry path in `fetchWithTimeout`.

## skill-v0.1.0 — 2026-05-11

- First public release. CLI `install` / `uninstall` / `update` / `list` for Claude Code. `npm publish --provenance` via Trusted Publishing OIDC.

## icons-v0.1.0 — 2026-05-11

- First public icon release. Azure core (~528 PNG files, both colored + monochrome variants) sourced from `plantuml-stdlib/Azure-PlantUML` upstream under MIT.
