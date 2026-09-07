// The compound-assignment change, exercised against node as the oracle.
// The load-bearing case is ONCE-EVALUATION: the receiver must be evaluated
// exactly once, which is what JS does and what the old two-evaluation desugar
// could not promise for a non-simple receiver.
class Stats { connected = 0; sentBytes = 0; arr: number[] = [0, 0] }
class Conn { stats = new Stats(); id = 'c1' }
class Relay {
    stats = new Stats()
    conns: Conn[] = [new Conn(), new Conn()]
    calls = 0
    pick(i: number): Conn { this.calls += 1; return this.conns[i] }
}

const r = new Relay()

// two-level through `this` and through an identifier
r.stats.connected++
r.stats.connected++
r.stats.sentBytes += 7
r.stats.sentBytes -= 2
console.log('a=' + r.stats.connected + ',' + r.stats.sentBytes)

const c = r.conns[0]
c.stats.connected++
c.stats.sentBytes += 41
console.log('b=' + c.stats.connected + ',' + c.stats.sentBytes)

// THREE levels
class Outer { inner = new Conn() }
const o = new Outer()
o.inner.stats.connected += 5
console.log('c=' + o.inner.stats.connected)

// ONCE-EVALUATION: pick() bumps a counter. If the receiver were evaluated
// twice, calls would be 2 after one statement, and node says 1.
r.pick(1).stats.connected++
console.log('calls=' + r.calls)
console.log('d=' + r.conns[1].stats.connected)

// value position, not just statement position
const v = r.stats.connected++
const w = ++r.stats.connected
console.log('e=' + v + ',' + w + ',' + r.stats.connected)

// element access with a side-effecting index, once only
let idx = 0
function nextIdx(): number { idx += 1; return 0 }
r.conns[nextIdx()].stats.sentBytes += 3
console.log('idx=' + idx + ',f=' + r.conns[0].stats.sentBytes)
