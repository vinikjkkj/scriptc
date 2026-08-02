// One generic class instantiated at two UNRELATED record types, with the
// element type reached only through the constructor callback and a Map slot.
//
// Regression guard for the mapType cache: a type parameter and a generic
// class's own instance type both answer per-instantiation, so caching either
// as if it were context-free compiles the second instantiation against the
// first one's fields (measured: `expected '{ fromMe... }', got '{ jid... }'`).
// Both instantiations must keep their own layout here.
type Msg = { id: string; fromMe: boolean };
type Thread = { jid: string; pinned: number };

class Queue<K extends string, V> {
  private readonly writer: (key: K, value: V) => void;
  private readonly pending: Map<K, V>;
  constructor(writer: (key: K, value: V) => void) {
    this.writer = writer;
    this.pending = new Map();
  }
  enqueue(key: K, value: V): void {
    this.pending.set(key, value);
    this.writer(key, value);
  }
  size(): number {
    return this.pending.size;
  }
}

const msgs = new Queue<string, Msg>((k, v) => console.log("m", k, v.id, v.fromMe));
const threads = new Queue<string, Thread>((k, v) => console.log("t", k, v.jid, v.pinned));

msgs.enqueue("a", { id: "x1", fromMe: true });
msgs.enqueue("b", { id: "x2", fromMe: false });
threads.enqueue("c", { jid: "j1", pinned: 2 });

console.log(msgs.size(), threads.size());
