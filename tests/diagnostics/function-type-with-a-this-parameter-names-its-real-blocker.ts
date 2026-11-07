// A function type with a declared `this:` pseudo-parameter is not variadic: the refusal names the parameter whose type
// does not compile (the DOM MessageEvent — Event itself compiles now), not an 'arguments'-reading signature.
function on(listener: (this: AbortSignal, event: MessageEvent) => void): void {
  void listener;
}
on(function () {});
