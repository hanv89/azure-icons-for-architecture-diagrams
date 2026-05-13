import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { Adapter } from "./types";
import { ADAPTERS } from "./registry";
import { parseFrontmatter } from "./claude-code";
import { installFetchMock, mkTmpdir, rmTmpdir, SYNTHETIC_VERSION } from "../__test_fixtures__/synthetic-bundle";

// ---- Adapter round-trip (install → list → uninstall) ----
// Iterates over every adapter in the shared registry. Adding a new adapter
// is a one-line entry in registry.ts plus (if the adapter writes a different
// on-disk layout than the manifest-mirror default) one EXPECTATIONS entry.

// Per-adapter assertion overrides for adapters whose on-disk layout differs
// from the default manifest-mirror (Claude Code + Codex install a folder
// containing SKILL.md + examples/; Cursor installs a single .mdc file).
interface Expectations {
  installedFile: (target: string) => string;
  readdirAt: (skillsRoot: string, target: string) => string;
  expectedTopEntries: string[];
  listTarget: (skillsRoot: string, target: string) => string;
  uninstallProbeMissing: (target: string) => string;
}

const FOLDER_INSTALL: Expectations = {
  installedFile: (t) => path.join(t, "SKILL.md"),
  readdirAt: (skillsRoot) => skillsRoot,
  expectedTopEntries: ["azure-architecture-diagram"],
  listTarget: (skillsRoot) => skillsRoot,
  uninstallProbeMissing: (t) => t,
};

const CURSOR_INSTALL: Expectations = {
  installedFile: (t) => path.join(t, "azure-arch-skill.mdc"),
  readdirAt: (_skillsRoot, target) => target,
  expectedTopEntries: ["azure-arch-skill.mdc"],
  listTarget: (_skillsRoot, target) => target,
  uninstallProbeMissing: (t) => path.join(t, "azure-arch-skill.mdc"),
};

const EXPECTATIONS: Record<string, Expectations> = {
  "claude-code": FOLDER_INSTALL,
  "codex":       FOLDER_INSTALL,
  "cursor":      CURSOR_INSTALL,
};

const ADAPTER_ENTRIES = Object.entries(ADAPTERS) as Array<[string, Adapter]>;

// Meta-test: every adapter registered in ADAPTERS must have an EXPECTATIONS
// entry, otherwise the round-trip suite silently skips it. Fails fast at
// test-run time rather than during a later release smoke.
test("meta: every registered adapter has an EXPECTATIONS entry", () => {
  const missing = Object.keys(ADAPTERS).filter(name => !EXPECTATIONS[name]);
  assert.deepEqual(missing, [], `adapters missing EXPECTATIONS: ${missing.join(", ")}`);
});

for (const [name, adapter] of ADAPTER_ENTRIES) {
  const exp = EXPECTATIONS[name];

  test(`${name} round-trip: install writes SKILL.md + example into target`, async () => {
    const tmpdir = mkTmpdir();
    const target = path.join(tmpdir, "skills", "azure-architecture-diagram");
    const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
    const { restore } = installFetchMock();
    try {
      const exit = await adapter.install({ target });
      assert.equal(exit, 0);
      assert.ok(fs.existsSync(exp.installedFile(target)), `installed file present at ${exp.installedFile(target)}`);
      const written = fs.readFileSync(exp.installedFile(target), "utf8");
      assert.ok(written.startsWith("---"), "installed file preserves frontmatter");
      assert.match(written, /azure-architecture-diagram/);
    } finally {
      restore();
      if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
      else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
      rmTmpdir(tmpdir);
    }
  });

  test(`${name} round-trip: list after install discovers the installed skill`, async () => {
    // Assert via fs + parseFrontmatter rather than capturing list()'s stdout —
    // see synthetic-bundle.ts silenceStderr() note for the gotcha.
    const tmpdir = mkTmpdir();
    const skillsRoot = path.join(tmpdir, "skills");
    const target = path.join(skillsRoot, "azure-architecture-diagram");
    const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
    const { restore } = installFetchMock();
    try {
      await adapter.install({ target });

      const skillEntries = fs.readdirSync(exp.readdirAt(skillsRoot, target), { withFileTypes: true }).map(d => d.name);
      assert.deepEqual(skillEntries, exp.expectedTopEntries, "post-install directory contains exactly the expected entries");

      const installedPath = exp.installedFile(target);
      const body = fs.readFileSync(installedPath, "utf8");
      const fm = parseFrontmatter(body);
      if (name === "cursor") {
        assert.match(body, new RegExp(`<!--\\s*azure-architecture-diagram\\s+v${SYNTHETIC_VERSION.replace(/\./g, "\\.")}\\s+`));
      } else {
        assert.equal(fm.name, "azure-architecture-diagram");
        assert.equal(fm.version, SYNTHETIC_VERSION);
      }

      const exit = await adapter.list({ target: exp.listTarget(skillsRoot, target) });
      assert.equal(exit, 0);
    } finally {
      restore();
      if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
      else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
      rmTmpdir(tmpdir);
    }
  });

  test(`${name} round-trip: uninstall removes the installed skill`, async () => {
    const tmpdir = mkTmpdir();
    const target = path.join(tmpdir, "skills", "azure-architecture-diagram");
    const prevEnv = process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
    process.env.AZURE_ARCH_SKILL_TARGET_ROOT = tmpdir;
    const { restore } = installFetchMock();
    try {
      await adapter.install({ target });
      assert.ok(fs.existsSync(exp.installedFile(target)), "precondition: install landed");
      const exit = await adapter.uninstall({ target });
      assert.equal(exit, 0);
      assert.equal(fs.existsSync(exp.uninstallProbeMissing(target)), false, "post-uninstall: target absent");
    } finally {
      restore();
      if (prevEnv === undefined) delete process.env.AZURE_ARCH_SKILL_TARGET_ROOT;
      else process.env.AZURE_ARCH_SKILL_TARGET_ROOT = prevEnv;
      rmTmpdir(tmpdir);
    }
  });
}
