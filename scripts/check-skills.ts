#!/usr/bin/env bun
/**
 * check-skills.ts: keep agent skills small, well-formed and linked.
 * Adapted from ViperNxt (github.com/hivinaynair/vipernxt, scripts/check-skills.ts, MIT),
 * without the skills lock.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");
const skillsRoot = join(root, ".agents/skills");
const words = (text: string) => text.trim().split(/\s+/).length;
const issues: string[] = [];
let total = 0;

function checkLinks(file: string, label: string) {
  for (const match of readFileSync(file, "utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (target && !/^[a-z]+:/i.test(target) && !existsSync(resolve(dirname(file), target)))
      issues.push(`${label}: broken link ${target}`);
  }
}

for (const name of readdirSync(skillsRoot).sort()) {
  const dir = join(skillsRoot, name);
  if (!existsSync(join(dir, "SKILL.md"))) continue;
  const text = readFileSync(join(dir, "SKILL.md"), "utf8");
  total += words(text);
  if (!text.startsWith(`---\nname: ${name}\n`))
    issues.push(`${name}: frontmatter must start with name: ${name}`);
  const description = text.match(/^description: (.+)$/m)?.[1];
  if (!description || words(description) > 24) issues.push(`${name}: description needs 1-24 words`);
  if (words(text) > 360)
    issues.push(`${name}: SKILL.md exceeds 360 words; move detail to a linked file`);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")))
    checkLinks(join(dir, file), `${name}/${file}`);
}
checkLinks(join(skillsRoot, "CONTRACT.md"), "CONTRACT.md");
if (total > 2500) issues.push(`skill catalog exceeds 2500 words (${total})`);

if (issues.length) {
  console.error(issues.join("\n"));
  process.exit(1);
}
console.log(`ok: skills verified (${total} entrypoint words)`);
