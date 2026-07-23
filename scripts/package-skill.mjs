#!/usr/bin/env node

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const skillDirectory = join(repositoryRoot, "skill", "collect-i18n");
const manifestPath = join(repositoryRoot, "package.json");

function parseArguments(argv) {
  const options = { check: false, output: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.check = true;
    else if (argument === "--output") {
      const output = argv[++index];
      if (!output) throw new Error("--output requires a path");
      options.output = resolve(output);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

function portable(path) {
  return path.split(sep).join("/");
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("SKILL.md must begin with YAML frontmatter");
  const values = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (pair) values.set(pair[1], pair[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2").trim());
  }
  return values;
}

async function validateSkill(files) {
  const relativeFiles = files.map((file) => portable(relative(skillDirectory, file)));
  for (const required of ["SKILL.md", "references/cli-protocol.md", "references/trigger-plan.md", "cli/bootstrap.mjs"]) {
    if (!relativeFiles.includes(required)) throw new Error(`Missing required skill file: ${required}`);
  }
  const platformSpecificFile = relativeFiles.find((file) =>
    file.startsWith("agents/") ||
    file.startsWith(".claude/") ||
    file.startsWith(".codex/")
  );
  if (platformSpecificFile) {
    throw new Error(`Universal Skill package must not contain platform-specific metadata: ${platformSpecificFile}`);
  }

  const markdown = await readFile(join(skillDirectory, "SKILL.md"), "utf8");
  const metadata = frontmatter(markdown);
  if (metadata.get("name") !== "collect-i18n") throw new Error("SKILL.md frontmatter name must be collect-i18n");
  const description = metadata.get("description") ?? "";
  if (description.length < 20 || description.length > 1024) throw new Error("SKILL.md description must contain 20-1024 characters");
  if (!markdown.includes("references/cli-protocol.md") || !markdown.includes("references/trigger-plan.md")) {
    throw new Error("SKILL.md must route the Agent to both protocol references");
  }

  return relativeFiles;
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(name, data, crc) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  return header;
}

function centralHeader(name, data, crc, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(33, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

function endRecord(fileCount, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(fileCount, 8);
  record.writeUInt16LE(fileCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

async function createZip(files, output, extraEntries = []) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const addEntry = (entryName, data) => {
    const name = Buffer.from(entryName, "utf8");
    const crc = crc32(data);
    const header = localHeader(name, data, crc);
    locals.push(header, name, data);
    centrals.push(centralHeader(name, data, crc, offset), name);
    offset += header.length + name.length + data.length;
  };
  for (const file of files) {
    const entryName = portable(join(basename(skillDirectory), relative(skillDirectory, file)));
    addEntry(entryName, await readFile(file));
  }
  for (const entry of extraEntries) {
    addEntry(entry.entryName, entry.data);
  }
  const total = files.length + extraEntries.length;
  const central = Buffer.concat(centrals);
  const archive = Buffer.concat([...locals, central, endRecord(total, central.length, offset)]);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, archive);
}

// Engine assets generated at package time and embedded in the skill zip. They
// are not committed source files, so the bundled engine, every executable
// runtime module (plus source maps), and the skill-cli package.json are added
// as extra zip entries alongside the walked skill source.
async function buildEngineEntries(version) {
  const bundlePath = join(repositoryRoot, "packages", "cli", "bundle", "bin.js");
  const runtimeDirectory = join(repositoryRoot, "packages", "runtime", "dist");
  for (const [label, path] of [["bundled engine", bundlePath], ["runtime entry", join(runtimeDirectory, "index.js")]]) {
    try {
      await readFile(path);
    } catch {
      throw new Error(`${label} not found at ${path}. Run "pnpm build" then "pnpm --filter @collect-i18n/cli build:bundle" before packaging the skill.`);
    }
  }
  const skillPkg = {
    name: "@collect-i18n/skill-cli",
    version,
    private: true,
    type: "module",
    dependencies: { "playwright-core": "^1.55.0" },
  };
  const prefix = portable(basename(skillDirectory));
  const runtimeFiles = (await walk(runtimeDirectory)).filter((path) => path.endsWith(".js") || path.endsWith(".js.map"));
  const runtimeNames = new Set(runtimeFiles.map((path) => portable(relative(runtimeDirectory, path))));
  for (const runtimeFile of runtimeFiles.filter((path) => extname(path) === ".js")) {
    const source = await readFile(runtimeFile, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*\()\s*["'](\.\.?\/[^"']+)["']/g)) {
      const dependency = portable(relative(runtimeDirectory, resolve(dirname(runtimeFile), match[1])));
      if (!runtimeNames.has(dependency)) {
        throw new Error(`Runtime module ${portable(relative(runtimeDirectory, runtimeFile))} imports missing ${dependency}`);
      }
    }
  }
  return [
    { entryName: `${prefix}/cli/bin.js`, data: await readFile(bundlePath) },
    { entryName: `${prefix}/cli/package.json`, data: Buffer.from(JSON.stringify(skillPkg, null, 2) + "\n", "utf8") },
    ...await Promise.all(runtimeFiles.map(async (runtimeFile) => ({
      entryName: `${prefix}/cli/runtime/${portable(relative(runtimeDirectory, runtimeFile))}`,
      data: await readFile(runtimeFile),
    }))),
  ];
}

const options = parseArguments(process.argv.slice(2));
const files = await walk(skillDirectory);
const relativeFiles = await validateSkill(files);

if (options.check) {
  process.stdout.write(`Skill validation passed (${relativeFiles.length} files).\n`);
} else {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const extraEntries = await buildEngineEntries(manifest.version);
  const output = options.output ?? join(repositoryRoot, "release", `collect-i18n-skill-v${manifest.version}.zip`);
  await createZip(files, output, extraEntries);
  const entries = [...relativeFiles, ...extraEntries.map((entry) => entry.entryName)];
  process.stdout.write(`${JSON.stringify({ output, files: relativeFiles.length, entries }, null, 2)}\n`);
}
