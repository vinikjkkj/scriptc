// node:net's happy-eyeballs attempt budget, read BEFORE anything sets it.
// 2500 only ever asks after a set, so the shipped default was invisible to
// it: Node raised getDefaultAutoSelectFamilyAttemptTimeout()'s default from
// the 250 the flag launched with, and v25.9.0 answers 500. The budget is
// also what a dial actually spends on a candidate whose family cannot
// egress, so a stale number here is a wrong wall, not just a wrong getter.
import {
  getDefaultAutoSelectFamilyAttemptTimeout,
  setDefaultAutoSelectFamilyAttemptTimeout,
} from "node:net";

const shipped = getDefaultAutoSelectFamilyAttemptTimeout();
console.log("default", typeof shipped, shipped);

// The knob still round-trips, and still floors at 10.
setDefaultAutoSelectFamilyAttemptTimeout(750);
console.log("set 750 ->", getDefaultAutoSelectFamilyAttemptTimeout());
setDefaultAutoSelectFamilyAttemptTimeout(9);
console.log("set 9   ->", getDefaultAutoSelectFamilyAttemptTimeout());

// ...and restoring the shipped value reads back exactly, so a program that
// saves and restores the budget around a dial sees no drift.
setDefaultAutoSelectFamilyAttemptTimeout(shipped);
console.log("restored", getDefaultAutoSelectFamilyAttemptTimeout() === shipped);
