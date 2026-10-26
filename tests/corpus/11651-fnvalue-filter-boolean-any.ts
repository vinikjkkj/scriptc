const xs: any = [0, '', 'x', null, 3];
console.log(JSON.stringify(xs.filter(Boolean)));
const ys: any = [1, 0, 'a', ''];
console.log(ys.filter(Boolean).length);
