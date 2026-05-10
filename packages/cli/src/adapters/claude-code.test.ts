import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter } from "./claude-code";

test("parseFrontmatter: BOM-prefixed input parses correctly", () => {
  const md = "﻿---\nname: foo\nversion: 1.2.3\nrequires_icons: \">=0.1.0\"\n---\n# body";
  const fm = parseFrontmatter(md);
  assert.equal(fm.name, "foo");
  assert.equal(fm.version, "1.2.3");
  assert.equal(fm.requires_icons, ">=0.1.0");
});

test("parseFrontmatter: requires_icons with >= prefix preserved", () => {
  const md = '---\nrequires_icons: ">=0.1.0"\n---';
  assert.equal(parseFrontmatter(md).requires_icons, ">=0.1.0");
});

test("parseFrontmatter: trailing # comment stripped from unquoted value", () => {
  const md = "---\nname: foo  # canonical name\n---";
  assert.equal(parseFrontmatter(md).name, "foo");
});

test("parseFrontmatter: # inside quoted value preserved", () => {
  const md = '---\nname: "foo # not-a-comment"\n---';
  assert.equal(parseFrontmatter(md).name, "foo # not-a-comment");
});

test("parseFrontmatter: no frontmatter returns empty object", () => {
  assert.deepEqual(parseFrontmatter("# just a markdown heading\nbody"), {});
});

test("parseFrontmatter: missing closing --- returns empty object", () => {
  assert.deepEqual(parseFrontmatter("---\nname: foo\nbody"), {});
});

test("parseFrontmatter: only known keys are extracted", () => {
  const md = "---\nname: foo\ndescription: long blob\nrandom_key: x\n---";
  const fm = parseFrontmatter(md);
  assert.equal(fm.name, "foo");
  // description + random_key are not in the typed set
  assert.equal(("description" in fm), false);
});

test("parseFrontmatter: CRLF line endings supported", () => {
  const md = "---\r\nname: foo\r\nrequires_icons: \">=0.1.0\"\r\n---\r\n";
  const fm = parseFrontmatter(md);
  assert.equal(fm.name, "foo");
  assert.equal(fm.requires_icons, ">=0.1.0");
});
