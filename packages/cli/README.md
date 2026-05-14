# @hanv89/azure-arch-skill

CLI installer for the Azure architecture diagram skill. Drops the skill bundle (`SKILL.md` + worked PlantUML examples) into your AI coding agent's skill folder so that prompts like *"draw an Azure context diagram"* produce diagrams that use official Microsoft Azure + Fabric architecture icons.

Published with Sigstore provenance via npm Trusted Publishing — verify with `npm view @hanv89/azure-arch-skill@latest dist.attestations`.

## Requirements

- Node.js ≥ 20

## Install

Install for one agent:

```sh
npx @hanv89/azure-arch-skill install --agent=claude-code
npx @hanv89/azure-arch-skill install --agent=codex
npx @hanv89/azure-arch-skill install --agent=cursor
```

Install for all supported agents in one shot (transactional — rolls back on first failure):

```sh
npx @hanv89/azure-arch-skill install --agent=all
```

Pin a specific skill bundle version (default = latest from main):

```sh
npx @hanv89/azure-arch-skill install --agent=claude-code --version=0.9.0
```

## Supported agents

| Agent | Default install location | Discovery model |
|---|---|---|
| `claude-code` | `~/.claude/skills/azure-architecture-diagram/` | Per-user (HOME-relative) |
| `codex` | `~/.codex/skills/azure-architecture-diagram/` (or `$CODEX_HOME/skills/...`) | Per-user (HOME-relative) |
| `cursor` | `<cwd>/.cursor/rules/azure-arch-skill.mdc` | Per-project (cwd-relative) — install from the project root so teammates pick up the rule via git |

The `cursor` adapter prints a one-line note at install time confirming the resolved target; pass `--target=<path>` to override.

## Subcommands

- `install --agent=<name>` — fetch the latest bundle (or `--version=X.Y.Z` pinned), verify icon-set reachability + `requires_icons` semver, copy files into the agent's folder.
- `uninstall --agent=<name>` — manifest-scoped removal: only the files the install wrote are removed; any user-authored content alongside the skill is preserved.
- `update --agent=<name>` — short-circuits to a no-op if the on-disk version already matches the upstream bundle; otherwise overwrites.
- `list --agent=<name>` — list installed skills under the agent's skill root + their versions.
- All four subcommands accept `--agent=all` to fan out across the supported agents.

## Environment overrides

Two environment variables exist for validation / CI use. Production users should not set them.

- **`AZURE_ARCH_SKILL_BASE_URL`** — override the bundle source. Restricted to `https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/...` paths; any other host or scheme is rejected. The CLI emits `warn: AZURE_ARCH_SKILL_BASE_URL override active: <value>` to stderr whenever the override fires.
- **`AZURE_ARCH_SKILL_TARGET_ROOT`** — widen the `--target` allow-list beyond the agent's default root. Setting this lets `install` / `uninstall` / `list` operate on directories outside the agent's config tree, so it MUST point at a directory you control (e.g. `mktemp -d` output in a test script). The CLI emits `warn: AZURE_ARCH_SKILL_TARGET_ROOT override active: <value>` once per command when honored. Never set this in a production shell.

## Repository

See the [project README](https://github.com/hanv89/azure-icons-for-architecture-diagrams#readme) for icon source, licensing, and the full skill specification.
