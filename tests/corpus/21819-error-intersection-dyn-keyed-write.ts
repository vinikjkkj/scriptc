// A dynamic (any) keyed write to an error object, then an optional typed read of the same key through the intersection.
const err = new Error('keyed');
const dyn: any = err;
dyn.route = 'users';
const typed = err as Error & { route?: string };
console.log(typed.route, typed.message);
