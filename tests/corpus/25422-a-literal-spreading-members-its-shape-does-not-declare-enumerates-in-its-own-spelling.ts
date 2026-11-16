// zapo's group metadata: `{ ...commons, owner, restrict }` returned as an interface that declares fewer members than
// the spread contributes, in another order. The members the shape keeps enumerate in the order the literal spells them.
// Only JSON.stringify is compared: Object.keys / entries / console.log of Node also show the undeclared member the
// shape's copy ends, which is the separate width-copy defect (a copy must carry every run-time member).
interface Commons { jid: string; subject: string; size?: number; creation?: number; subjectOwner?: string; subjectOwnerPhoneNumber?: string; subjectTime?: number; membershipApprovalEnabled: boolean }
interface Meta {
  readonly jid: string;
  readonly subject: string;
  readonly subjectOwner?: string;
  readonly subjectTime?: number;
  readonly owner?: string;
  readonly creation?: number;
  readonly restrict: boolean;
  readonly size?: number;
  readonly membershipApprovalEnabled: boolean;
}
function commons(attrs: Record<string, string | undefined>): Commons {
  return {
    jid: attrs['id'] ?? '',
    subject: attrs['subject'] ?? '',
    size: attrs['size'] ? Number(attrs['size']) : undefined,
    creation: attrs['creation'] ? Number(attrs['creation']) : undefined,
    subjectOwner: attrs['s_o'],
    subjectOwnerPhoneNumber: attrs['s_o_pn'],
    subjectTime: attrs['s_t'] ? Number(attrs['s_t']) : undefined,
    membershipApprovalEnabled: attrs['join'] === 'on',
  };
}
function meta(attrs: Record<string, string | undefined>): Meta {
  const c = commons(attrs);
  return { ...c, owner: attrs['creator'], restrict: attrs['locked'] === '1' };
}
// The REST app's flow: the record crosses an async function and an `unknown` parameter before JSON.stringify.
function send(payload: unknown): string { return JSON.stringify(payload); }
async function create(attrs: Record<string, string | undefined>): Promise<Meta> { return meta(attrs); }
async function main(): Promise<void> {
  console.log(send(await create({ id: 'g1@g.us', subject: 'hello', size: '3', creation: '1700000000', s_o: 'u1@s.whatsapp.net', s_t: '1700000001', join: 'on', creator: 'u1@s.whatsapp.net', locked: '1' })));
  console.log(send(await create({ id: 'g2@g.us', subject: 'x', join: 'off', creator: 'u2@s.whatsapp.net', creation: '5' })));
}
main();
