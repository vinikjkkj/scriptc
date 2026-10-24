// Default import of node:events in a JavaScript source: the default export
// IS the EventEmitter class.
import events from 'node:events'

const e = new events()
console.log(e !== null)
