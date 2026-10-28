'use strict'
// the cloneQueryConfig shape over a dyn config
const config: any = JSON.parse('{"text":"select 1","values":[1,2],"name":"q"}');
function cloneQueryConfig(c: any): any {
  if (c == null) return c;
  return Object.defineProperties(Object.create(Object.getPrototypeOf(c)), Object.getOwnPropertyDescriptors(c));
}
const cl: any = cloneQueryConfig(config);
console.log(cl.text, cl.name, cl.values.length);
console.log(JSON.stringify(cl));
console.log(cloneQueryConfig(null));
