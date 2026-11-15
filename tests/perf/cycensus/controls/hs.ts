// the holder-scan control for dyn STR nodes (build with -DSCR_CYCEN_HOLD_KIND=3): a known number of STR nodes, held by a known kind of holder, from two known sites
const held: any[] = [];
const boxes: any[] = [];
// site A: 3000 string nodes held ONLY by one array (the item buffer of `held`)
function siteA(n: number) { for (let i = 0; i < n; i++) { const a: any = JSON.parse('["held-by-array-' + i + '"]'); held.push(a[0]); } }
// site B: 1000 string nodes, each held by its own one-field object (a dyn OBJ entry), and the objects held by an array
function siteB(n: number) { for (let i = 0; i < n; i++) { const o: any = JSON.parse('{"s":"held-by-object-' + i + '"}'); boxes.push(o); } }
siteA(3000);
siteB(1000);
setTimeout(() => { console.log(held.length, boxes.length); }, 5);
