class Job {
  constructor(handle) {
    this.handle = handle;
  }

  cancel() {
    clearTimeout(this.handle);
    this.handle = null;
  }
}

let fired = 0;
const live = new Job(setTimeout(() => { fired += 10; }, 5));
const kept = new Job(setTimeout(() => { fired += 1; }, 5));
live.cancel();
new Job(undefined).cancel();
new Job('nope').cancel();
setTimeout(() => console.log('fired', fired), 30);

function when(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
}

console.log(when('2020-02-03T04:05:06Z'));
console.log(when(86400000));
console.log(when(null));
console.log(when(undefined));
console.log(when(true));
console.log(when('garbage'));
