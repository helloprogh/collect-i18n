// esbuild normalizes `node:sqlite` to the bare `sqlite` when leaving it
// external, but Node's experimental sqlite builtin only resolves under the
// `node:` prefix. Restore the prefix in the bundled output.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "..", "bundle", "bin.js");
let source = readFileSync(file, "utf8");
const before = source;
source = source
  .replaceAll('from "sqlite"', 'from "node:sqlite"')
  .replaceAll("from 'sqlite'", "from 'node:sqlite'")
  .replaceAll('require("sqlite")', 'require("node:sqlite")')
  .replaceAll("require('sqlite')", "require('node:sqlite')");
if (source !== before) {
  writeFileSync(file, source);
  console.log("patch-bundle: restored node:sqlite prefix");
} else {
  console.log("patch-bundle: no sqlite rewrite needed");
}