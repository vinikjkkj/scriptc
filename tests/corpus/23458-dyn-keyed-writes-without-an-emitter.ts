// The scoped refusal of dyn writes belongs to programs that box an emitter: a plain dyn object keeps its
// computed-key writes, its deletes and writes of the names _events / _eventsCount / _maxListeners.
const o: any = JSON.parse('{"a":1}');
const key: string = process.argv.length > 99 ? 'zz' : 'b';
o[key] = 2;
o._events = { x: 1 };
o._eventsCount = 'three';
o._maxListeners = null;
delete o.a;
delete o[key];
console.log(Object.keys(o).join(','), o._events.x, o._eventsCount, o._maxListeners);
