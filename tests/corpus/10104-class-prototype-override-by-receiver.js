// Prototype reads by arbitrary key: typeof, absent names, inherited methods, and an override picked by the receiver's class.
class Base {
  run(x) { return 'base-run:' + x; }
  stop() { return 'base-stop'; }
}
class Child extends Base {
  run(x) { return 'child-run:' + x; }
}
const keys = ['run', 'stop', 'absent'];
for (const k of keys) {
  console.log(k, typeof Child.prototype[k], typeof Base.prototype[k]);
}
for (const k of ['run', 'stop']) {
  console.log(Child.prototype[k].call(new Child(), 'c'), Base.prototype[k].call(new Base(), 'b'));
}
const inst = new Child();
const name = 'run';
console.log(inst[name](7));
console.log(inst['stop'] === undefined ? 'no' : 'yes');
