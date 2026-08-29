/**
 * Build the detached daemon argv for the hidden `serve` command. The array
 * holds the SCRIPT and its arguments only — the caller supplies the node
 * executable itself via `spawn(process.execPath, commandLine)`.
 *
 * v0.5.0/v0.6.0 prefixed another process.execPath here, so node parsed
 * node.exe as its entry script (a PE/MZ SyntaxError) and every real
 * background start silently died before writing its service descriptor.
 * Guarded by service-command.test.ts.
 */
export function buildServeCommand(
  executable: string,
  projectRoot: string,
  sessionId: string,
  tsxCli?: string,
): string[] {
  return tsxCli
    ? [tsxCli, executable, "--project", projectRoot, "serve", "--session", sessionId]
    : [executable, "--project", projectRoot, "serve", "--session", sessionId];
}
