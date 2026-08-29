import { describe, expect, it } from "vitest";
import { buildServeCommand } from "./service-command.js";

describe("buildServeCommand", () => {
  it("never places the node executable inside the argv (v0.5.0 double-execPath regression)", () => {
    const engine = "C:/skill/cli/bin.js";
    const project = "D:/target-project";
    const argv = buildServeCommand(engine, project, "session_1");

    expect(argv).toEqual([engine, "--project", project, "serve", "--session", "session_1"]);
    // `spawn(process.execPath, commandLine)` prepends node itself: if the
    // argv already began with node.exe, node parsed node.exe as its entry
    // script and every background start died with a PE SyntaxError.
    expect(argv.some((part) => /node(\.exe)?$/i.test(part))).toBe(false);
    expect(argv[0]).toMatch(/bin\.js$/);
  });

  it("routes source checkouts through the tsx loader before the script", () => {
    const argv = buildServeCommand(
      "D:/repo/packages/cli/src/bin.ts",
      "D:/target-project",
      "session_2",
      "D:/repo/node_modules/tsx/dist/cli.mjs",
    );
    expect(argv[0]).toBe("D:/repo/node_modules/tsx/dist/cli.mjs");
    expect(argv[1]).toBe("D:/repo/packages/cli/src/bin.ts");
    expect(argv.slice(2)).toEqual(["--project", "D:/target-project", "serve", "--session", "session_2"]);
  });
});
