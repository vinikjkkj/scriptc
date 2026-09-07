// `obj.f op= e` used to refuse whenever the receiver was neither an identifier
// nor `this`, because the desugar evaluated the receiver TWICE: once for the
// read's field target and again when the write re-derived it from the AST.
// Non-simple receivers are now pinned into a hidden local, so the receiver is
// evaluated exactly once -- which is what JavaScript does.
//
// `calls` and `idx` are the load-bearing lines: each counts evaluations of a
// receiver with a side effect, and each reads 1 here and would read 2 under a
// two-evaluation desugar. Node is the oracle for every line.
class Stats {
    connected = 0
    sentBytes = 0
}
class Conn {
    stats = new Stats()
}
class Outer {
    inner = new Conn()
}
class Relay {
    stats = new Stats()
    conns: Conn[] = [new Conn(), new Conn()]
    calls = 0
    pick(i: number): Conn {
        this.calls += 1
        return this.conns[i]!
    }
}

const r = new Relay()

// two levels, through `this` inside the class and through a local
r.stats.connected++
r.stats.connected++
r.stats.sentBytes += 7
r.stats.sentBytes -= 2
console.log('a=' + String(r.stats.connected) + ',' + String(r.stats.sentBytes))

const c = r.conns[0]!
c.stats.connected++
c.stats.sentBytes += 41
console.log('b=' + String(c.stats.connected) + ',' + String(c.stats.sentBytes))

// three levels
const o = new Outer()
o.inner.stats.connected += 5
console.log('c=' + String(o.inner.stats.connected))

// ONCE-EVALUATION through a call receiver
r.pick(1).stats.connected++
console.log('calls=' + String(r.calls))
console.log('d=' + String(r.conns[1]!.stats.connected))

// value position, prefix and postfix
const v = r.stats.connected++
const w = ++r.stats.connected
console.log('e=' + String(v) + ',' + String(w) + ',' + String(r.stats.connected))

// ONCE-EVALUATION through a side-effecting index
let idx = 0
function nextIdx(): number {
    idx += 1
    return 0
}
r.conns[nextIdx()]!.stats.sentBytes += 3
console.log('idx=' + String(idx) + ',f=' + String(r.conns[0]!.stats.sentBytes))
