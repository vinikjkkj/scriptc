// Object.assign onto an intersection with a refinement member: two sources, two keys, in order.
const e = new Error('merge') as Error & { errors: Error[]; tag: string };
const list = [new Error('first')];
Object.assign(e, { errors: list }, { tag: 'merged' });
console.log(e.message, e.errors.length, e.errors[0].message, e.tag);
