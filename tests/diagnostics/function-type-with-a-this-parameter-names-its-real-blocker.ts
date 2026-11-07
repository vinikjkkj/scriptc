// A function type with a declared `this:` pseudo-parameter is not variadic: the refusal names the parameter whose type
// does not compile (the DOM Event), not an 'arguments'-reading signature.
function on(listener: (this: AbortSignal, event: Event) => void): void {
  void listener;
}
on(function () {});
