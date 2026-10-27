// Two different unions of optional scalars: undefined equals only undefined,
// NaN equals nothing, and +0 equals -0 across the arms.
function same(x: string | undefined, y: number | undefined): boolean { return x === y; }
function differ(x: number | undefined, y: number | string | undefined): boolean { return x !== y; }
console.log(same(undefined, undefined), same('1' as any, 1 as any), same(undefined, 0 as any));
console.log(differ(undefined, undefined), differ(0, undefined), differ(NaN, NaN), differ(-0, 0));
console.log(differ(1, '1'), differ(2, 2));
