// An IMPORTED rejection handler -- one of the shapes `.catch(h)` takes
// that no inline function literal can spell.
export function imported(e: unknown): void {
  console.log("imported:", e instanceof Error ? e.message : "?");
}

export function rethrow(e: unknown): never {
  console.log("rethrow saw:", e instanceof Error ? e.message : "?");
  throw e;
}
