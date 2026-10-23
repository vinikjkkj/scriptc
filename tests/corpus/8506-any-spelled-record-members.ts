// A type-literal member that spells any / any[] (pg-protocol's BindOpts).
type BindOpts = {
  portal?: string;
  binary?: boolean;
  values?: any[];
  extra: any;
};
function bind(config: BindOpts = { extra: 0 }): string {
  const vals = config.values || [];
  return (config.portal || "-") + ":" + vals.length + ":" + String(config.extra) + ":" + (config.binary ? "b" : "t");
}
console.log(bind(), bind({ portal: "p", values: [1, "x", null], extra: "e", binary: true }));
class Holder { public opts: BindOpts = { extra: 1, values: [1] }; }
console.log(new Holder().opts.values?.length);
