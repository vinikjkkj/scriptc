// Element compounds (a[k] op= e) with a receiver and a key that have side effects:
// each is evaluated ONCE, before the read, in JavaScript's order. Covers a string
// array element on a dyn url-like path (the whatwg-url shape), a typed number
// array, and a dyn receiver. The calls log is the load-bearing line.
let calls = "";
function key(k: number): number { calls += "k" + k + ";"; return k; }
function recv(r: any): any { calls += "r;"; return r; }

class Url {
  url: any;
  constructor(url: any) {
    this.url = url;
  }
  pathAppend(c: string): boolean {
    this.url.path[this.url.path.length - 1] += c;
    return true;
  }
  pathSide(c: string): void {
    this.url.path[key(this.url.path.length - 1)] += c;
  }
}

const u = new Url({ path: ["a", "b"] });
u.pathAppend("x");
u.pathSide("y");
console.log(JSON.stringify(u.url.path));

// receiver and key evaluated once, in JS order
const arr: string[] = ["p", "q", "r"];
arr[key(1)] += "!";
recv(arr)[key(2)] += "?";
console.log(arr.join("|"), calls);

// numeric string-free arrays with side-effect key
const nums: number[] = [1, 2, 3];
calls = "";
nums[key(0)] += 10;
recv(nums)[key(1)] *= 3;
nums[key(2)] -= 1;
console.log(nums.join(","), calls);

// dyn receiver with side-effect key
const dyn: any = { 0: 5, name: "n" };
calls = "";
recv(dyn)[key(0)] += 7;
dyn[key(0)] -= 2;
console.log(dyn[0], calls);
