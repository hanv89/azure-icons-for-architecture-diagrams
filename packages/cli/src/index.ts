#!/usr/bin/env node

import pkg from "../package.json";

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

function wantsHelp(argv: string[]): boolean {
  return argv.includes("-h") || argv.includes("--help") || argv.includes("help");
}

async function stub(name: string, argv: string[]): Promise<number> {
  if (wantsHelp(argv)) { process.stdout.write(USAGE); return 0; }
  process.stderr.write(`[stub] ${name}: not yet implemented.\n`);
  return 0;
}

async function install(argv: string[]):   Promise<number> { return stub("install", argv); }
async function uninstall(argv: string[]): Promise<number> { return stub("uninstall", argv); }
async function update(argv: string[]):    Promise<number> { return stub("update", argv); }
async function list(argv: string[]):      Promise<number> { return stub("list", argv); }

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
    case "help":
    case "-h":
    case "--help":    process.stdout.write(USAGE); return 0;
    case "version":
    case "-V":
    case "--version": process.stdout.write(pkg.version + "\n"); return 0;
    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv)
  .then(code => process.exit(code))
  .catch(err => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
