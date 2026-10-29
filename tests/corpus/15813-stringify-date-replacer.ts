// A Date in a replacer walk answers its toJSON string, as Node.
const when: unknown = { at: new Date(0) };
console.log(JSON.stringify(when, (k: string, v: unknown) => v));
console.log(JSON.stringify(when));
