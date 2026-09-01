// NEGATIVE CONTROL 2: an undeclared name that is NOT in the measured table.
// The assertion alone must buy nothing.
console.log('1 zorb:', typeof (globalThis as { readonly Zorb?: unknown }).Zorb)
