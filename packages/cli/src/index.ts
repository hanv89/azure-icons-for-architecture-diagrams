#!/usr/bin/env node

const USAGE = `Usage: azure-arch-skill <subcommand> [options]

Subcommands:
  install      Install the Azure architecture skill into an AI agent's skill folder.
  uninstall    Remove a previously installed skill.
  update       Update an installed skill to the latest version.
  list         List installed skills and their versions.

Examples:
  azure-arch-skill install --agent=claude-code
  azure-arch-skill list
`;

function install(_argv: string[]): number {
  process.stderr.write("[stub] install: not yet implemented (Phase 0.9 will land Claude Code adapter).\n");
  return 0;
}

function uninstall(_argv: string[]): number {
  process.stderr.write("[stub] uninstall: not yet implemented.\n");
  return 0;
}

function update(_argv: string[]): number {
  process.stderr.write("[stub] update: not yet implemented.\n");
  return 0;
}

function list(_argv: string[]): number {
  process.stderr.write("[stub] list: not yet implemented.\n");
  return 0;
}

function main(argv: string[]): number {
  const [, , subcommand, ...rest] = argv;

  if (!subcommand) {
    process.stdout.write(USAGE);
    return 0;
  }

  switch (subcommand) {
    case "install":   return install(rest);
    case "uninstall": return uninstall(rest);
    case "update":    return update(rest);
    case "list":      return list(rest);
    case "-h":
    case "--help":    process.stdout.write(USAGE); return 0;
    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${USAGE}`);
      return 1;
  }
}

process.exit(main(process.argv));
