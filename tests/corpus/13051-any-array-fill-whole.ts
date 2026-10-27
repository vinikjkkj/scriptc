// new Array(n).fill(v) of any: every slot takes v, fill answers the receiver.
const xs: any[] = new Array(4).fill(undefined);
console.log(xs.length, String(xs[0]), String(xs[3]));
const ys: any[] = new Array(3).fill(0);
console.log(ys.length, String(ys[0]), String(ys[2]));
ys[1] = "mid";
console.log(String(ys[0]), String(ys[1]), String(ys[2]));
const zs: any[] = new Array(2).fill("z").fill(true);
console.log(zs.length, String(zs[0]), String(zs[1]));
