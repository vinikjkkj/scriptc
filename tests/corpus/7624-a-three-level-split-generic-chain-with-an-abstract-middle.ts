// The shape mongodb's cursors are: a non-generic base, an abstract generic
// middle whose `extends` mentions its parameter, another abstract layer, two
// concrete leaves, and a fourth class that fixes the parameter. Overrides at
// every level, two instantiations reached, and dispatch through references
// typed at each level of the chain.
class Emitter {
  events: string[] = []
  emit(e: string): void { this.events.push(e) }
  name(): string { return 'emitter' }
}
abstract class Cursor<TS> extends Emitter {
  buf: TS[] = []
  closed = false
  abstract label(): string
  push(v: TS): void { this.buf.push(v); this.emit('push') }
  next(): TS | undefined { return this.buf.shift() }
  name(): string { return 'cursor:' + this.label() }
}
abstract class Explainable<TS> extends Cursor<TS> {
  explains = 0
  explain(): string { this.explains = this.explains + 1; return 'explain:' + this.label() }
}
class FindC<TS> extends Explainable<TS> {
  label(): string { return 'find' }
  next(): TS | undefined { this.emit('next'); return this.buf.shift() }
}
class AggC<TS> extends Explainable<TS> {
  label(): string { return 'agg' }
}
class DocFind extends FindC<string> {
  label(): string { return 'docfind' }
}

const f: Cursor<number> = new FindC<number>()
const g: Cursor<string> = new FindC<string>()
const a: Cursor<number> = new AggC<number>()
const d: Cursor<string> = new DocFind()
f.push(1); f.push(2)
g.push('x')
a.push(9)
d.push('q')
console.log(f.name(), g.name(), a.name(), d.name())
console.log(f.next(), g.next(), a.next(), d.next())
console.log(f.events.join(','), g.events.join(','), a.events.join(','), d.events.join(','))
const ef: Explainable<number> = f as Explainable<number>
console.log(ef.explain(), ef.explains)
const em: Emitter = d
console.log(em.name(), em.events.length)
console.log(f.closed, d.closed)
