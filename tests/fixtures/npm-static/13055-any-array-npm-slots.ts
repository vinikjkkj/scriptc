// A JS npm package builds parallel any[] slot tables (lru.min's shape) and a
// TypeScript program reads them back through the package's own surface.
import { createSlots } from "anyslots13055";

const slots = createSlots(3);
slots.put(1, "k1", 10);
console.log(slots.capacity(), slots.size());
console.log(String(slots.key(0)), String(slots.key(1)), String(slots.value(1)));
console.log(slots.key(2) === undefined, slots.value(0) === undefined);
