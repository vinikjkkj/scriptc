/// <reference lib="esnext.disposable" />
const kDispose: unique symbol = (Symbol.dispose as any) ?? Symbol('dispose');
interface Disposable { [kDispose](): void; }
export function addAbortListener(
  signal: AbortSignal | undefined | null,
  listener: (this: AbortSignal, event: Event) => void
): Disposable | undefined {
  if (signal == null) return;
  signal.addEventListener('abort', listener, { once: true });
  return { [kDispose]: () => signal.removeEventListener('abort', listener) };
}
const c = new AbortController();
const d = addAbortListener(c.signal, function (ev) { console.log('L1', ev.type, (this.reason as Error).name, ev.target === this); });
const d2 = addAbortListener(c.signal, function () { console.log('L2', this.aborted); });
const d3 = addAbortListener(c.signal, function () { console.log('L3 never'); });
d3?.[kDispose]();
c.abort();
