function get(): any { return JSON.parse('{"a":5,"s":"5","u":null,"o":{"k":1},"arr":[1]}'); }
const o = get();
console.log(o.a == 5, o.a == "5", o.s == 5, o.u == null, o.q == null, o.u == undefined, o.a != "5", o.a == o.s);
console.log(o.o === o.o, o.o === o.arr, o.o == o.o, o.arr === o.arr);
const p: any = o.o; console.log(p === o.o, p !== o.o);
const str: string = "5"; const num: number = 5;
console.log(o.a == str, str == o.a, o.s == str, o.a === num, num === o.a);
