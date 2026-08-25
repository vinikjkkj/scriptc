/* The cascade shape: a class field typed by a type-only import from a
 * SUBPATH of a dist/esm package. Both defects at once — the subpath does
 * not map, and the type-only import never registers the specifier — so
 * the field is an island value, the class has no compiled declaration,
 * and every call of its generic method refuses.
 *
 * No constructor parameter property: Node's strip-only mode rejects one,
 * and Node running this file is the oracle. */
import type { Logger } from "dualdist/util";

export class Coord {
  readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  commit<K extends string>(key: K, fields: Record<string, number>): string {
    this.logger.warn(key);
    return key + ":" + Object.keys(fields).length;
  }
}

export function emit(c: Coord): string {
  return c.commit("X", { a: 1, b: 2 });
}

const sink: Logger = {
  warn(message: string): void {
    console.log("warn " + message);
  },
};

console.log(emit(new Coord(sink)));
