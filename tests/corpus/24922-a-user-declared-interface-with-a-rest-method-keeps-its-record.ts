// zapo's WaProxyDispatcher: a user-declared interface whose only member takes a rest parameter stays a typed record, so the branches that test its presence
// keep the liveness they had (remapping it to a dynamic object made a stdlib-typed assignment behind `if (dispatcher)` reachable).
interface Dispatcher {
  dispatch(...args: readonly unknown[]): unknown;
}
function toDispatcher(proxy: Dispatcher | undefined): Dispatcher | undefined {
  return proxy !== undefined && typeof proxy.dispatch === "function" ? proxy : undefined;
}
function describe(proxy: Dispatcher | undefined): string {
  const d = toDispatcher(proxy);
  const init: { method: string; dispatcher?: Dispatcher } = { method: "GET" };
  if (d) init.dispatcher = d;
  return init.dispatcher === undefined ? "direct" : "via " + String(init.dispatcher.dispatch(1, "a"));
}
console.log(describe(undefined));
console.log(describe({ dispatch: (...a: readonly unknown[]) => a.length }));
