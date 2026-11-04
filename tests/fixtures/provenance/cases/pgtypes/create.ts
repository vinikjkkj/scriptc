import { arrayParser } from "pgtypes";
const lie = arrayParser as any;
console.log(typeof lie, Object.keys(lie), typeof lie.create);
const p = lie.create("{1,2,3}", (e: string) => parseInt(e, 10) * 2);
console.log(p.parse());
