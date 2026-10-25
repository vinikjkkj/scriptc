// Prototype method reads by literal key: a subclass override and an inherited method, each called with an explicit receiver.
class Base {
  run(x) { return 'base-run:' + x; }
  stop() { return 'base-stop'; }
}
class Child extends Base {
  run(x) { return 'child-run:' + x; }
}
console.log(typeof Child.prototype['run'], typeof Base.prototype['run'], typeof Child.prototype['absent']);
console.log(Child.prototype['run'].call(new Child(), 'c'), Base.prototype['run'].call(new Base(), 'b'));
console.log(Child.prototype['stop'].call(new Child()));
const inst = new Child();
const name = 'run';
console.log(inst[name](7));
