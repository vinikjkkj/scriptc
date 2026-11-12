export const log: string[] = [];
export function note(s: string): void {
  log.push(s);
  console.log(s);
}
let ticks = 0;
export async function tick(): Promise<number> {
  await Promise.resolve();
  return ++ticks;
}
