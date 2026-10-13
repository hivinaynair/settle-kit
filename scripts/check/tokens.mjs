import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { isTokenSourcePath, rawTokenHits } from "./lib/token-report.mjs";

const repoRoot = join(import.meta.dir, "../..");
const roots = [join(repoRoot, "apps"), join(repoRoot, "packages", "ui", "src")];

async function walk(dir, files) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      await walk(full, files);
      continue;
    }
    if (!/\.(tsx|ts|css)$/.test(name)) continue;
    files.push(full);
  }
}

const files = [];
for (const root of roots) await walk(root, files);

const violations = [];
for (const file of files) {
  const rel = relative(repoRoot, file);
  if (!isTokenSourcePath(rel)) continue;
  const source = await readFile(file, "utf8");
  for (const hit of rawTokenHits(source)) {
    violations.push(`${rel}:${hit.line}: ${hit.text}`);
  }
}

if (violations.length) {
  console.error("Raw palette values — use a semantic token (bg-primary, text-muted-foreground).");
  for (const line of violations) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`ok: no raw palette values (${files.length} files scanned)`);
