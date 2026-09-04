// OUTSIDE the cluster: a.ts imports it, and it imports nothing back.
// The constructor is deliberately imperative -- a loop, a throw and a
// push -- so that no expression-level inertness survey could admit it.
// It does not have to: it cannot name a binding of a.ts or b.ts.
export class Doc {
  protected readonly bytes: Uint8Array;
  private readonly stops: number[] = [];

  constructor(bytes: Uint8Array) {
    if (bytes.length === 0) {
      throw new Error("empty document");
    }
    this.bytes = bytes;
    let i = 0;
    while (i < bytes.length) {
      if (bytes[i] === 0) {
        this.stops.push(i);
      }
      i += 1;
    }
  }

  count(): number {
    return this.stops.length;
  }

  sum(): number {
    let total = 0;
    for (const s of this.stops) {
      total += s;
    }
    return total;
  }
}
