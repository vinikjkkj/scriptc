// REPRO B: zapo's group metadata. A literal with a spread of another literal's result, returned as an interface that declares the fields in ANOTHER order.
interface Commons { jid: string; subject: string; size?: number; creation?: number; subjectOwner?: string; subjectTime?: number; membershipApprovalEnabled: boolean }
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
    subjectTime: attrs['s_t'] ? Number(attrs['s_t']) : undefined,
    membershipApprovalEnabled: attrs['join'] === 'on',
  };
}
function meta(attrs: Record<string, string | undefined>): Meta {
  const c = commons(attrs);
  return { ...c, owner: attrs['creator'], restrict: attrs['locked'] === '1' };
}
const m = meta({ id: 'g1@g.us', subject: 'hello', size: '3', creation: '1700000000', s_o: 'u1@s.whatsapp.net', s_t: '1700000001', join: 'on', creator: 'u1@s.whatsapp.net', locked: '1' });
console.log(JSON.stringify(m));
console.log(Object.keys(m).join(','));
console.log(m);
