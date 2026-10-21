class Counter {
  static count = 0;
  static total: number = 10;
  static label = "c";
  static hits(): number { Counter.count++; Counter.total += 5; Counter.label += "!"; return Counter.count; }
}
console.log(Counter.hits(), Counter.hits());
Counter.count += 10;
Counter.total *= 2;
Counter.total -= 1;
console.log(Counter.count, Counter.total, Counter.label);
const old = Counter.count++;
const pre = ++Counter.count;
console.log(old, pre, Counter.count--, --Counter.count);
