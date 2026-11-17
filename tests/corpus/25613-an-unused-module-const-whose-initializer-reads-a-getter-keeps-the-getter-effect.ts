// Reading an accessor runs its body: the unused const that reads one is still evaluated (the getter writes a counter and prints).
let reads = 0;
class Probe {
  get value(): number {
    reads += 1;
    console.log("getter ran", reads);
    return 7;
  }
}
const p = new Probe();
export const UNUSED_READ = [p.value, p.value * 2];
console.log("reads", reads);
