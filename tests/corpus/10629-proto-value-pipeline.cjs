// A small pipeline of instances: each stage reads the stage datum or its own write.
class Stage {
  constructor(id) { this.id = id; }
  run(x) { this.out = x * this.id; }
}
Stage.prototype.out = -1;
const stages = [new Stage(1), new Stage(2), new Stage(3)];
stages[0].run(5);
stages[2].run(2);
console.log(stages.map((s) => s.out).join(' '));
