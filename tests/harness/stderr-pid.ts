/* The process id in a Node warning report.
 *
 * Node prints `(node:<pid>)` before every warning line ("(node:12993)
 * ExperimentalWarning: ..."), and the compiled binary prints the same
 * prefix with its own pid. The pid is process identity, not program output,
 * so the exit-0 stderr comparison replaces it on both sides with a fixed
 * `(node:PID)` token. Only that prefix is touched: the warning name, the
 * message and the hint line still compare byte for byte. */
export function normalizeWarningPid(text: string): string {
  return text.replace(/\(node:\d+\)/g, "(node:PID)");
}
