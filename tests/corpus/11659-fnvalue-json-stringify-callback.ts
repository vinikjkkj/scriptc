const docs: any = [{ a: 1 }, [2], 'x'];
console.log(docs.map(JSON.stringify).join('|'));
