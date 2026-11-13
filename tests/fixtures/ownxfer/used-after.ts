// The array is read after the call that crosses it into a dynamic callee: a write through the copy must reach it (Node prints [1,2,3,99] twice).
// A build that wrongly treats the crossing as the array's last use loses that write; in a --sanitize build the read after the call aborts.
function consume(x: any): string {
  x.push(99);
  return JSON.stringify(x);
}
{
  const a: number[] = [1, 2, 3];
  console.log(consume(a), JSON.stringify(a));
}
