const dyn: any = ['a b', 'c/d', 'é'];
console.log(dyn.map(encodeURIComponent).join(','));
