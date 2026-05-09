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

async function install(_argv: string[]): Promise<number> {
  process.stderr.write("[stub] install: not yet implemented (Claude Code adapter coming next).\n");
  return 0;
}

async function uninstall(_argv: string[]): Promise<number> {
  process.stderr.write("[stub] uninstall: not yet implemented.\n");
  return 0;
}

async function update(_argv: string[]): Promise<number> {
  process.stderr.write("[stub] update: not yet implemented.\n");
  return 0;
}

async function list(_argv: string[]): Promise<number> {
  process.stderr.write("[stub] list: not yet implemented.\n");
  return 0;
}

async function main(argv: string[]): Promise<number> {
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

main(process.argv).then(code => process.exit(code));
