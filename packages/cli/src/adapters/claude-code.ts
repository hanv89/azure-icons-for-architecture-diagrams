import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Adapter, InstallOptions, UninstallOptions, UpdateOptions, ListOptions } from "./types";

const DEFAULT_BASE_RAW_URL = "https://raw.githubusercontent.com/hanv89/azure-icons-for-architecture-diagrams/main";
const SKILL_NAME = "azure-architecture-diagram";

interface BundleFile { src: string; dest: string; }
const BUNDLE_FILES: BundleFile[] = [
  { src: "dist/skill/SKILL.md",                 dest: "SKILL.md" },
  { src: "dist/skill/examples/01-context.puml", dest: "examples/01-context.puml" },
];

const CANARY_ICON_PATH = "dist/Azure/Compute/AzureVirtualMachine.png";

function baseUrl(): string {
  return process.env.AZURE_ARCH_SKILL_BASE_URL ?? DEFAULT_BASE_RAW_URL;
}

function defaultTarget(): string {
  return path.join(os.homedir(), ".claude", "skills", SKILL_NAME);
}

function defaultSkillsRoot(): string {
  return path.join(os.homedir(), ".claude", "skills");
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} returned HTTP ${res.status}`);
  return res.text();
}

async function headOk(url: string): Promise<boolean> {
  const res = await fetch(url, { method: "HEAD" });
  return res.ok;
}

interface Frontmatter {
  name?: string;
  version?: string;
  requires_icons?: string;
}

function parseFrontmatter(md: string): Frontmatter {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const out: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*?)\s*$/);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key === "name" || key === "version" || key === "requires_icons") {
      out[key] = value;
    }
  }
  return out;
}

async function install(opts: InstallOptions): Promise<number> {
  const target = opts.target ?? defaultTarget();
  const base = baseUrl();
  try {
    const skillUrl = `${base}/${BUNDLE_FILES[0].src}`;
    const skillMd = await fetchText(skillUrl);
    const fm = parseFrontmatter(skillMd);
    if (!fm.requires_icons) {
      process.stderr.write("fatal: SKILL.md missing requires_icons frontmatter\n");
      return 1;
    }
    const canaryUrl = `${base}/${CANARY_ICON_PATH}`;
    const ok = await headOk(canaryUrl);
    if (!ok) {
      process.stderr.write(`fatal: requires_icons mismatch — canary ${canaryUrl} unreachable for requires_icons=${fm.requires_icons}\n`);
      return 1;
    }

    await fs.mkdir(path.join(target, "examples"), { recursive: true });
    await fs.writeFile(path.join(target, BUNDLE_FILES[0].dest), skillMd, "utf8");
    for (const { src, dest } of BUNDLE_FILES.slice(1)) {
      const body = await fetchText(`${base}/${src}`);
      await fs.writeFile(path.join(target, dest), body, "utf8");
    }

    process.stdout.write(`installed ${SKILL_NAME} to ${target}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function uninstall(opts: UninstallOptions): Promise<number> {
  const target = opts.target ?? defaultTarget();
  try {
    await fs.rm(target, { recursive: true, force: true });
    process.stdout.write(`uninstalled ${SKILL_NAME} from ${target}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

async function update(opts: UpdateOptions): Promise<number> {
  return install(opts);
}

async function list(opts: ListOptions): Promise<number> {
  const root = opts.target ?? defaultSkillsRoot();
  try {
    const exists = await fs.stat(root).then(() => true).catch(() => false);
    if (!exists) {
      process.stdout.write("(no skills installed)\n");
      return 0;
    }
    const entries = await fs.readdir(root, { withFileTypes: true });
    const rows: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const skillMdPath = path.join(root, e.name, "SKILL.md");
      try {
        const md = await fs.readFile(skillMdPath, "utf8");
        const fm = parseFrontmatter(md);
        rows.push(`${fm.name ?? e.name}\t${fm.version ?? "?"}`);
      } catch {
        // not a skill folder; skip silently
      }
    }
    process.stdout.write(rows.length ? rows.join("\n") + "\n" : "(no skills installed)\n");
    return 0;
  } catch (err) {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}

export const claudeCodeAdapter: Adapter = { install, uninstall, update, list };
