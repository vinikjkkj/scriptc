// An unannotated 'newListener' listener that reads only the event name.
// Node calls it with the name and the listener function; the function is
// never read here, so the program observes the name alone.
const { EventEmitter } = require('events')

const bus = new EventEmitter()
const seen = []
bus.on('newListener', function (eventName) {
  seen.push(String(eventName))
})
bus.on('ping', (n) => console.log('ping', n))
bus.once('pong', (n) => console.log('pong', n))
bus.on('ping', (n) => console.log('ping again', n))
bus.emit('ping', 1)
bus.emit('pong', 2)
bus.emit('pong', 3)
console.log(seen.join(','))
console.log(bus.listenerCount('ping'))
