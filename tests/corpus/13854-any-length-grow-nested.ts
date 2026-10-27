// A length compound that GROWS an any-typed array reached through a nested member. The
// new slots read as undefined; the program reads only the length and the element values.
const h: any = { list: [1, 2, 3] };
h.list.length += 2;
console.log(h.list.length, h.list[0], h.list[2], String(h.list[4]), h.list[4] === undefined);
console.log(JSON.stringify(h.list.slice(0, 3)));
h.list.length -= 4;
console.log(h.list.length, JSON.stringify(h.list));
