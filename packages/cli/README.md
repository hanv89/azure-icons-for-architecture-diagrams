# @hanv89/azure-arch-skill

CLI installer for the Azure architecture diagram skill. Drops the skill bundle (`SKILL.md` + worked PlantUML examples) into your AI coding agent's skill folder so that prompts like *"draw an Azure context diagram"* produce diagrams that use official Microsoft Azure architecture icons.

Published with Sigstore provenance via npm Trusted Publishing — verify with `npm view @hanv89/azure-arch-skill@latest dist.attestations`.

## Requirements

- Node.js ≥ 20

## Install

```sh
npx @hanv89/azure-arch-skill install --agent=claude-code
```

Supported agents:

- Claude Code — `~/.claude/skills/azure-architecture-diagram/`

Planned (later releases): Codex CLI, Cursor.

## Subcommands

- `install --agent=<name>` — copy the skill bundle into the agent's skill folder.
- `uninstall --agent=<name>` — remove the skill from the agent's skill folder.
- `update --agent=<name>` — refresh an installed skill to the latest version.
- `list` — list installed skills and their versions.

The icons themselves stay in this repository and are referenced from PlantUML via public `raw.githubusercontent.com` URLs — no additional download or hosting required.

## Environment overrides

Two environment variables exist for validation / CI use. Production users should not set them.

- **`AZURE_ARCH_SKILL_BASE_URL`** — override the bundle source. Restricted to `https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/...` paths; any other host or scheme is rejected. The CLI emits `warn: AZURE_ARCH_SKILL_BASE_URL override active: <value>` to stderr whenever the override fires.
- **`AZURE_ARCH_SKILL_TARGET_ROOT`** — widen the `--target` allow-list beyond the default `~/.claude/`. Setting this lets `install` / `uninstall` / `list` operate on directories outside the user's Claude config tree, so it MUST point at a directory you control (e.g. `mktemp -d` output in a test script). The CLI emits `warn: AZURE_ARCH_SKILL_TARGET_ROOT override active: <value>` once per command when honored. Never set this in a production shell — a stray `--target=$HOME` invocation against a widened allow-list could remove unrelated files.

## Repository

See the [project README](https://github.com/hanv89/azure-icons-for-architecture-diagrams#readme) for icon source, licensing, and the full skill specification.
