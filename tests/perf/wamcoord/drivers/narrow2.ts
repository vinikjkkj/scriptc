// How narrow is it? String() of an array on its own vs inside a union.
declare const arr: string[]
declare const nums: number[]
declare const u1: string | string[]
declare const u2: string | number[]
declare const u3: string | { tag: string }

console.log('a=' + String(arr))          // an array on its own
console.log('b=' + String(nums))
console.log('c=' + `${arr}`)             // template spelling
console.log('d=' + String(u3))           // union with a RECORD arm
console.log('e=' + String(u1))           // union with an ARRAY arm
console.log('f=' + String(u2))
