const { EventEmitter } = require('events')
class Conn extends EventEmitter {
  go(n) {
    const nm = n > 0 ? 'row' : 'other'
    return this.emit(nm, n)
  }
}
const c = new Conn()
c.on('row', function (m) { console.log('row', m) })
c.on('other', (m) => console.log('other', m))
console.log(c.go(1), c.go(-1))
