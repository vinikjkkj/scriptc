// `new Array(n).fill(undefined)` annotated as (number | undefined)[]: every
// slot is a real undefined (not a hole), reads are typed, writes land.
function makeSlots(max: number): (number | undefined)[] {
  const slots: (number | undefined)[] = new Array(max).fill(undefined);
  slots[0] = 10;
  slots[2] = 30;
  return slots;
}

const slots = makeSlots(4);
console.log(slots.length, slots[0], slots[1], slots[2], slots[3]);
console.log(slots[1] === undefined, slots[2] === 30);
slots.length = 2;
console.log(slots.length, slots[0], slots[1], slots[2]);
slots.length = 3;
console.log(slots.length, slots[2] === undefined);
slots.fill(undefined);
console.log(slots.length, slots[0], slots[1]);
