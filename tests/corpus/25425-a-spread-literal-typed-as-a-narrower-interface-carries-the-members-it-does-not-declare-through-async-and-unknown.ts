// zapo's group metadata with the extra member DEFINED: a literal spreading a wider record into a narrower interface.
// Node keeps every spread member; the narrow shape's copy must carry the ones the interface does not declare.
interface Commons { jid: string; subject: string; creation?: number; subjectOwner?: string; subjectOwnerPhoneNumber?: string; membershipApprovalEnabled: boolean }
interface Meta { readonly jid: string; readonly subject: string; readonly subjectOwner?: string; readonly owner?: string; readonly creation?: number; readonly restrict: boolean; readonly membershipApprovalEnabled: boolean }
function commons(attrs: Record<string, string | undefined>): Commons {
  return { jid: attrs['id'] ?? '', subject: attrs['subject'] ?? '', creation: attrs['creation'] ? Number(attrs['creation']) : undefined, subjectOwner: attrs['s_o'], subjectOwnerPhoneNumber: attrs['s_o_pn'], membershipApprovalEnabled: attrs['join'] === 'on' };
}
function meta(attrs: Record<string, string | undefined>): Meta {
  const c = commons(attrs);
  return { ...c, owner: attrs['creator'], restrict: attrs['locked'] === '1' };
}
function send(payload: unknown): string { return JSON.stringify(payload); }
async function create(attrs: Record<string, string | undefined>): Promise<Meta> { return meta(attrs); }
async function main(): Promise<void> {
  const m = await create({ id: 'g1@g.us', subject: 'hello', creation: '1700000000', s_o: 'u1@s.whatsapp.net', s_o_pn: '5511999990000@s.whatsapp.net', join: 'on', creator: 'u1@s.whatsapp.net', locked: '1' });
  console.log(send(m));
  console.log(Object.keys(m).join(','));
  console.log(JSON.stringify(Object.entries(m)));
  console.log(m);
}
main();
