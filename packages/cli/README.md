# @hanv89/azure-arch-skill

> **Status**: pre-publish. The package is not yet on npmjs.com — the `npx` command below works once the first release ships.

CLI installer for the Azure architecture diagram skill. Drops the skill bundle (`SKILL.md` + worked PlantUML examples) into your AI coding agent's skill folder so that prompts like *"draw an Azure context diagram"* produce diagrams that use official Microsoft Azure architecture icons.

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

## Repository

See the [project README](https://github.com/hanv89/azure-icons-for-architecture-diagrams#readme) for icon source, licensing, and the full skill specification.
