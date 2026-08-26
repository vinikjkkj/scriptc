// A GENERIC METHOD in a record -- zapo's `WaSqliteConnection.get<T extends
// Record<string, unknown>>(sql, params?)`.
//
// A record member with its own type parameters maps to ONE closure slot:
// mapTypeInner binds every type parameter to its CONSTRAINT, on the
// argument that the body typechecks for every type satisfying the
// constraint, so the constraint itself is among them. Three producers
// could fill that slot -- a named generic function, an object-literal
// ARROW written against it, and a `.bind` of a class method. The fourth,
// an object-literal METHOD that writes the type parameters out, was
// refused with a bare "generic methods", so two spellings of one member
// disagreed: `{ pick: (k) => ... }` compiled and `{ pick<K...>(k) {...} }`
// did not.
//
// What this pins is that the erased method answers Node at every
// instantiation, and that the two spellings answer each other.

interface Rows {
  // T appears only in the RETURN -- store-sqlite's shape.
  get<T extends Record<string, unknown>>(key: string): T | null;
  all<T extends Record<string, unknown>>(key: string): readonly T[];
}

const table: Record<string, Record<string, unknown>> = {
  a: { k: 'a', n: 1 },
  b: { k: 'b', n: 2, extra: 'e' },
};

const rows: Rows = {
  get<T extends Record<string, unknown>>(key: string): T | null {
    const hit = table[key];
    return hit === undefined ? null : (hit as T);
  },
  all<T extends Record<string, unknown>>(key: string): readonly T[] {
    const hit = table[key];
    return hit === undefined ? [] : ([hit] as readonly T[]);
  },
};

// The SAME member at two different instantiations, in call order.
const one = rows.get<{ k: string; n: number }>('a');
console.log(one === null ? 'null' : one.k + '/' + String(one.n));
const two = rows.get<{ k: string; n: number; extra: string }>('b');
console.log(two === null ? 'null' : two.k + '/' + String(two.n) + '/' + two.extra);
const miss = rows.get<{ k: string; n: number }>('zzz');
console.log(miss === null ? 'null' : 'not-null');

const list = rows.all<{ k: string; n: number }>('a');
console.log('all=' + String(list.length) + ':' + (list[0] === undefined ? '-' : list[0].k));
console.log('all-miss=' + String(rows.all<{ k: string; n: number }>('zzz').length));

// The ARROW spelling of the identical member, as the A/A control: the two
// producers fill one slot and must answer alike.
interface KeyMap {
  readonly a: number;
  readonly b: number;
}
const reg: KeyMap = { a: 10, b: 20 };

interface OpsArrow {
  readonly pick: <K extends keyof KeyMap>(k: K) => number;
}
interface OpsMethod {
  pick<K extends keyof KeyMap>(k: K): number;
}
const viaArrow: OpsArrow = { pick: (k) => reg[k] };
const viaMethod: OpsMethod = {
  pick<K extends keyof KeyMap>(k: K): number {
    return reg[k];
  },
};
console.log('arrow=' + String(viaArrow.pick('a')) + ',' + String(viaArrow.pick('b')));
console.log('method=' + String(viaMethod.pick('a')) + ',' + String(viaMethod.pick('b')));

// A generic method beside ORDINARY members and an OPTIONAL parameter, all
// in one record -- the store-sqlite interface in miniature.
interface Conn {
  readonly driver: string;
  exec(sql: string): void;
  run(sql: string, params?: readonly unknown[]): void;
  get<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): T | null;
}

const seen: string[] = [];
const conn: Conn = {
  driver: 'memory',
  exec(sql: string): void {
    seen.push('exec:' + sql);
  },
  run(sql: string, params?: readonly unknown[]): void {
    seen.push('run:' + sql + ':' + (params === undefined ? 'undefined' : String(params.length)));
  },
  get<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): T | null {
    seen.push('get:' + sql + ':' + (params === undefined ? 'undefined' : String(params.length)));
    return sql === 'none' ? null : ({ sql, n: params === undefined ? 0 : params.length } as unknown as T);
  },
};

console.log('driver=' + conn.driver);
conn.exec('CREATE');
conn.run('INSERT');
conn.run('INSERT', [1, 2]);
const r1 = conn.get<{ sql: string; n: number }>('SELECT');
console.log(r1 === null ? 'null' : r1.sql + '#' + String(r1.n));
const r2 = conn.get<{ sql: string; n: number }>('SELECT', ['x']);
console.log(r2 === null ? 'null' : r2.sql + '#' + String(r2.n));
console.log(conn.get<{ sql: string; n: number }>('none') === null ? 'none=null' : 'none=?');
for (const line of seen) console.log(line);

// The record flows as a VALUE through a parameter -- the call there reads
// the same slot, and the generic member has no receiver to monomorphize
// against, which is the whole reason the slot has to hold a closure.
function drive(c: Conn): string {
  const got = c.get<{ sql: string; n: number }>('VIA-PARAM', [1, 2, 3]);
  return got === null ? 'null' : got.sql + '#' + String(got.n);
}
console.log(drive(conn));
