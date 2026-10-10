import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readAgentsRules,
  writeAgentsRules,
  DEFAULT_AGENTS_RULES_TEMPLATE,
} from "../dist/file/agentsRules.js";

test("readAgentsRules returns default template when file does not exist", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "zcode-rules-test-"));
  try {
    const res = await readAgentsRules({
      scope: "workspace",
      workspacePath: tempDir,
    });
    assert.equal(res.exists, false);
    assert.equal(res.content, DEFAULT_AGENTS_RULES_TEMPLATE);
    assert.equal(res.filePath, join(tempDir, "AGENTS.md"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("writeAgentsRules writes AGENTS.md and readAgentsRules reads it back", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "zcode-rules-test-"));
  try {
    const customContent = "# My Custom Test Rules\n\nAlways speak nicely.";
    const writeRes = await writeAgentsRules({
      scope: "workspace",
      workspacePath: tempDir,
      content: customContent,
    });
    assert.equal(writeRes.filePath, join(tempDir, "AGENTS.md"));

    const diskContent = await readFile(writeRes.filePath, "utf-8");
    assert.equal(diskContent, customContent);

    const readRes = await readAgentsRules({
      scope: "workspace",
      workspacePath: tempDir,
    });
    assert.equal(readRes.exists, true);
    assert.equal(readRes.content, customContent);
    assert.equal(readRes.filePath, join(tempDir, "AGENTS.md"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
