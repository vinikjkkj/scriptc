// An OPTIONAL PARAMETER in a record's function-typed member.
//
// `{ run(sql: string, params?: readonly unknown[]): void }` -- zapo's
// `WaSqliteConnection.run` -- did not compile, and the refusal took the
// WHOLE record type down with it (SC2009 "its member 'run' has type ...,
// which does not compile"), which in turn took every value of that type,
// every record holding one, and every Map and Promise over it.
//
// The cause was not the optional parameter. `params: readonly unknown[] |
// undefined` -- the SAME type, one spelling apart -- mapped fine. An
// optional parameter's slot is re-armed with an undefined arm, and
// `readonly unknown[] | undefined` maps to the DYNAMIC tier, which cannot
// be a union arm; the re-arming therefore turned a representable slot into
// a mapping failure. A dyn already admits undefined.
//
// What this pins is the observable side: an ABSENT optional parameter must
// read `undefined`, an explicitly-`undefined` one must read the same, and
// neither may read the value a PREVIOUS call left in the slot.

interface Conn {
  exec(sql: string): void;
  run(sql: string, params?: readonly unknown[]): void;
  tag(a: string, b?: number, c?: string): string;
}

const log: string[] = [];

const conn: Conn = {
  exec(sql: string): void {
    log.push('exec:' + sql);
  },
  run(sql: string, params?: readonly unknown[]): void {
    log.push('run:' + sql + ':' + (params === undefined ? 'undefined' : String(params.length)));
  },
  tag(a: string, b?: number, c?: string): string {
    return a + '|' + String(b) + '|' + String(c) + '|' + String(typeof b) + '|' + String(typeof c);
  },
};

conn.exec('CREATE');

// The three cases that must agree.
conn.run('absent');
conn.run('given', [1, 2, 3]);
conn.run('explicit-undefined', undefined);

// THE STALE-SLOT TEST. A present argument followed by an absent one: if the
// omitted slot were reused rather than filled with undefined, the second
// call would report 3.
conn.run('present-then', ['a', 'b', 'c']);
conn.run('absent-after');

// Fewer arguments than the record declares, at every arity.
console.log(conn.tag('x'));
console.log(conn.tag('x', 7));
console.log(conn.tag('x', 7, 'z'));
console.log(conn.tag('x', undefined, 'z'));

for (const line of log) console.log(line);

// The record flows as a VALUE: through a binding, a parameter, and a field
// of another record. The slot must survive every hop.
function drive(c: Conn): void {
  c.run('via-param');
  c.run('via-param', [0]);
}
drive(conn);

interface Holder {
  readonly inner: Conn;
}
const holder: Holder = { inner: conn };
holder.inner.run('via-field');
holder.inner.run('via-field', [9, 9]);

for (const line of log.slice(7)) console.log('later:' + line);
console.log('total=' + String(log.length));
