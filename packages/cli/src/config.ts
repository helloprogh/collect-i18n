import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ProjectConfigSchema, type ProjectConfig } from "@collect-i18n/core";

export const CONFIG_DIRECTORY = ".collect-i18n";
export const CONFIG_FILE = "config.json";

export function configPath(projectRoot: string): string {
  return join(resolve(projectRoot), CONFIG_DIRECTORY, CONFIG_FILE);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function detectDevCommand(projectRoot: string): Promise<string> {
  const manifestPath = join(projectRoot, "package.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { scripts?: Record<string, string> };
    const script = manifest.scripts?.dev ? "dev" : manifest.scripts?.serve ? "serve" : undefined;
    if (!script) return "pnpm dev";
    if (await exists(join(projectRoot, "pnpm-lock.yaml"))) return `pnpm ${script}`;
    if (await exists(join(projectRoot, "yarn.lock"))) return `yarn ${script}`;
    if (await exists(join(projectRoot, "bun.lockb"))) return `bun run ${script}`;
    return `npm run ${script}`;
  } catch {
    return "pnpm dev";
  }
}

export async function createDefaultConfig(projectRootInput: string): Promise<ProjectConfig> {
  const projectRoot = resolve(projectRootInput);
  return ProjectConfigSchema.parse({
    version: 1,
    projectRoot,
    stateDirectory: CONFIG_DIRECTORY,
    source: {},
    locales: { source: "zh-cn", target: "en-us", roots: ["src"] },
    app: {
      baseUrl: "http://127.0.0.1:5173",
      devCommand: await detectDevCommand(projectRoot),
      workingDirectory: projectRoot,
      healthPath: "/",
    },
    browser: { headless: false, locale: "zh-CN" },
    instrumentation: { enabled: true, devOnly: true },
  });
}

export async function saveConfig(config: ProjectConfig): Promise<string> {
  const parsed = ProjectConfigSchema.parse(config);
  const file = configPath(parsed.projectRoot);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return file;
}

export async function loadConfig(projectRoot: string): Promise<ProjectConfig> {
  const file = configPath(projectRoot);
  try {
    return ProjectConfigSchema.parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`项目尚未初始化或配置无效：${file}\n${message}`);
  }
}

export interface DoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
}

export async function doctorProject(projectRootInput: string): Promise<{ projectRoot: string; ready: boolean; checks: DoctorCheck[] }> {
  const projectRoot = resolve(projectRootInput);
  const checks: DoctorCheck[] = [];
  const fileChecks: Array<[string, string, boolean]> = [
    ["package", "package.json", true],
    ["vite", "vite.config", true],
    ["source", "src", true],
    ["config", join(CONFIG_DIRECTORY, CONFIG_FILE), false],
  ];
  for (const [id, relativeFile, required] of fileChecks) {
    let ok = false;
    let found = relativeFile;
    if (id === "vite") {
      const candidates = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"];
      const match = await Promise.all(candidates.map(async (candidate) => [candidate, await exists(join(projectRoot, candidate))] as const));
      found = match.find(([, present]) => present)?.[0] ?? candidates.join(" / ");
      ok = match.some(([, present]) => present);
    } else {
      ok = await exists(join(projectRoot, relativeFile));
    }
    checks.push({ id, label: relativeFile, ok, required, detail: ok ? found : `未找到 ${found}` });
  }

  try {
    const manifest = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const name of ["vue", "vite", "vue-i18n", "element-plus"]) {
      checks.push({ id: `dependency:${name}`, label: name, ok: Boolean(dependencies[name]), required: name === "vue" || name === "vite", detail: dependencies[name] ?? "未在项目依赖中声明" });
    }
  } catch {
    // The package.json check above is authoritative.
  }

  const version = Number(process.versions.node.split(".")[0]);
  checks.push({ id: "node", label: "Node.js >= 22", ok: version >= 22, required: true, detail: process.version });
  return { projectRoot, ready: checks.every((check) => !check.required || check.ok), checks };
}
