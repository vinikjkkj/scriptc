// `...(isIos ? { distributionChannel } : { mcc, mnc, board })`: each arm's keys appear, in order, only when that arm is taken; the untaken arm's values are not evaluated.
interface UA { platform: number; label: string; distributionChannel?: number; mcc?: string; mnc?: string; board?: string }
let evaluated = 0;
function channel(c: string): number {
  evaluated += 1;
  return c.length;
}
function build(os: string, mcc: string | undefined): UA {
  const isIos = os === "ios";
  return {
    platform: isIos ? 1 : 2,
    label: "ua",
    ...(isIos
      ? { distributionChannel: channel("appstore") }
      : { mcc: mcc ?? "000", mnc: mcc ?? "111", board: "b" })
  } as UA;
}
for (const u of [build("ios", undefined), build("android", undefined), build("android", "310")]) {
  console.log(JSON.stringify(u), u.distributionChannel, u.mcc, u.board);
}
console.log("evaluated", evaluated);
