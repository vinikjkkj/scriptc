// `${null}` / `${undefined}` template substitutions of unit-typed values (the mysql2 SC1090 site shape)
console.log(`${null}`);
console.log(`${undefined}`);
const n: null = null;
console.log(`[${n}]`);
const u: undefined = undefined;
console.log(`[${u}]`);
console.log(`a${null}b${undefined}c`);
