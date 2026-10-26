const raw: any = [10, 2.5, true, null];
const out = raw.map(String);
console.log(JSON.stringify(out));
console.log(raw.map(Boolean).join(','));
