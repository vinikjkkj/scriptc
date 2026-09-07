// Does the IR already carry two-level field reads and writes? If the manual
// read-modify-write compiles and matches node, then widening the compound
// refusal emits shapes both emitters already handle, and it is a frontend
// predicate change rather than a lowering change.
class Stats { connected = 0; sentBytes = 0 }
class Conn { stats = new Stats() }

const c = new Conn()
c.stats.connected = 1                      // two-level WRITE
c.stats.connected = c.stats.connected + 1  // two-level READ then WRITE
c.stats.sentBytes = c.stats.sentBytes + 7
console.log('connected=' + c.stats.connected)
console.log('sentBytes=' + c.stats.sentBytes)

class Holder {
    s = new Stats()
    bump(): void {
        this.s.connected = this.s.connected + 1   // through `this`, two-level
    }
}
const h = new Holder()
h.bump(); h.bump()
console.log('holder=' + h.s.connected)
