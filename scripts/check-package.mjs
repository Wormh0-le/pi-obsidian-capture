import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = join(root, "extensions", "obsidian-capture");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const entry = join(root, packageJson.pi.extensions[0]);

if (!(await stat(entry)).isFile()) throw new Error(`Missing Pi extension entry: ${entry}`);

for (const name of await readdir(join(root, "examples"))) {
  if (!name.endsWith(".json")) continue;
  JSON.parse(await readFile(join(root, "examples", name), "utf8"));
}

const sourceNames = (await readdir(extensionRoot)).filter((name) => name.endsWith(".ts"));
const forbidden = [/\/home\//, /gho_[A-Za-z0-9]/, /github_pat_[A-Za-z0-9_]/, /sk-[A-Za-z0-9]{16,}/];

for (const name of sourceNames) {
  const file = join(extensionRoot, name);
  const content = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(content)) throw new Error(`Forbidden machine-local or credential-like value in ${name}`);
  }

  for (const match of content.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
    const imported = resolve(dirname(file), match[1]);
    await stat(imported).catch(() => {
      throw new Error(`Broken relative import in ${name}: ${match[1]}`);
    });
  }
}

console.log(`Package checks passed: ${sourceNames.length} extension modules, examples valid, no personal paths or credential-like values.`);
