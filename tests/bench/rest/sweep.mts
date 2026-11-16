/* sweep.mts: the zapo-100% sweep of the REST app (RR_SCENARIO=sweep). One pass over every route the app exposes that the fake server can serve, plus the inbound
 * traffic (peer messages, edits, revokes, reactions, media, group messages, history) that feeds them; every response lands in http.json so the Node arm and the
 * compiled arm can be diffed request by request, and the store is read back at the end. RR_SWEEP_PHASES picks phases (default A,B,C,D,E,F; G = routes the fake
 * server has no handler for, which may time out). The app and the fake server are never edited. */
type Ctx = {
    server: any; self: any; pipeline: any; req: (m: string, p: string, b?: any) => Promise<any>; results: any[]; sleep: (ms: number) => Promise<void>
    SELF: string; mark: (s: string) => void; outDir: string
}
const J = (r: any): any => { try { return JSON.parse(r?.body_resp ?? 'null') } catch { return null } }
export async function runSweep(c: Ctx): Promise<void> {
    const { server, self, pipeline, req, results, sleep, SELF, mark } = c
    const phases = new Set((process.env.RR_SWEEP_PHASES ?? 'A,B,C,D,E,F').split(','))
    const step = async (name: string, f: () => Promise<any>) => { try { await f() } catch (e) { results.push({ sweepStep: name, driverError: String(e).slice(0, 300) }) } }
    const P1 = '5511911112222@s.whatsapp.net', P2 = '5511933334444@s.whatsapp.net'
    const SELFJ = `${SELF}@s.whatsapp.net`
    const id = (n: number) => `3A5EE${String(n).padStart(5, '0')}`.padEnd(20, 'F')
    const peer1 = await server.createFakePeer({ jid: P1 }, pipeline)
    const peer2 = await server.createFakePeer({ jid: P2 }, pipeline)
    const png = new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 7 + 3) & 255))
    const blob = async (mediaType: string, bytes: Uint8Array) => {
        const b = await server.publishMediaBlob({ mediaType, plaintext: bytes })
        return { directPath: server.mediaUrl(b.path).replace('//127.0.0.1:', '//fake-media.local:'), mediaKey: b.mediaKey, fileSha256: b.fileSha256, fileEncSha256: b.fileEncSha256, fileLength: b.fileLength }
    }
    let n = 1
    if (phases.has('A')) {
        mark('phase A: inbound')
        await step('A.text', () => peer1.sendConversation('sweep text one', { id: id(1) }))
        await step('A.text2', () => peer2.sendConversation('sweep text two', { id: id(2) }))
        await sleep(800)
        await step('A.edit', () => peer1.sendMessageEdit({ targetMessageId: id(1), newText: 'sweep text one (edited)' }))
        await step('A.rev.msg', () => peer1.sendConversation('to be revoked', { id: id(3) }))
        await sleep(500)
        await step('A.rev', () => peer1.sendMessageRevoke({ targetMessageId: id(3) }))
        await step('A.react', () => peer2.sendReaction({ targetMessageId: id(2), emoji: '\u{1F44D}' }))
        await step('A.image', async () => peer1.sendImageMessage({ ...(await blob('image', png)), mimetype: 'image/jpeg', caption: 'an image', width: 10, height: 10 }, { id: id(10) }))
        await step('A.video', async () => peer1.sendVideoMessage({ ...(await blob('video', png)), mimetype: 'video/mp4', caption: 'a video' } as any, { id: id(11) }))
        await step('A.audio', async () => peer1.sendAudioMessage({ ...(await blob('audio', png)), mimetype: 'audio/ogg; codecs=opus', ptt: true } as any, { id: id(12) }))
        await step('A.doc', async () => peer1.sendDocumentMessage({ ...(await blob('document', png)), mimetype: 'application/pdf', fileName: 'a.pdf' } as any, { id: id(13) }))
        await step('A.sticker', async () => peer1.sendStickerMessage({ ...(await blob('sticker', png)), mimetype: 'image/webp' } as any, { id: id(14) }))
        await step('A.history', () => self.sendHistorySync({ chunkOrder: 1, progress: 100, conversations: Array.from({ length: 4 }, (_, i) => ({
            id: `55119${200000 + i}@s.whatsapp.net`, name: `Hist ${i}`, unreadCount: i,
            messages: Array.from({ length: 5 }, (_, m) => ({ id: id(100 + i * 10 + m), fromMe: m % 2 === 0, timestamp: 1700000000 + i * 100 + m, message: { conversation: `hist ${i}.${m}` } })) })) as any }))
        await sleep(4000)
    }
    if (phases.has('B')) {
        mark('phase B: reads')
        for (const g of ['/health', '/state', '/sessions', '/sessions/rows', '/sessions/connection', '/credentials', '/clockSkewMs', '/auth/getState', '/events', '/events?type=message',
            '/events?since=2&limit=3', '/messages', '/messages?since=1&limit=2', '/store/tables', '/store/counts', '/store/threads', '/store/threads?limit=2', '/store/contacts',
            '/store/contacts?limit=2', `/store/contact?jid=${P1}`, `/store/thread?jid=${P1}`, `/store/messages?thread=${P1}`, `/store/messages?thread=${P1}&limit=1`,
            `/store/message?id=${id(1)}`, `/store/message?id=${id(10)}`, '/store/thread?jid=55119200001@s.whatsapp.net', '/store/messages?thread=55119200001@s.whatsapp.net', '/qr', '/nonexistent'])
            await req('GET', g)
    }
    if (phases.has('C')) {
        mark('phase C: outbound messages')
        const dir = c.outDir
        const { writeFileSync } = await import('node:fs')
        const files: Record<string, string> = {}
        for (const [k, ext] of [['image', 'jpg'], ['video', 'mp4'], ['audio', 'ogg'], ['document', 'pdf'], ['sticker', 'webp']]) { files[k] = `${dir}/sweep-${k}.${ext}`; writeFileSync(files[k]!, Buffer.from(png)) }
        const tgt = { targetRemoteJid: P1, targetId: id(1) }
        await req('POST', '/message/sendText', { to: P1, text: 'out text' })
        await req('POST', '/message/sendText', { to: P1 })
        await req('POST', '/message/reply', { to: P1, text: 'a reply', quotedRemoteJid: P1, quotedId: id(1) })
        await req('POST', '/message/react', { to: P1, emoji: '\u{2764}', ...tgt })
        await req('POST', '/message/poll', { to: P1, name: 'pick one', options: ['a', 'b', 'c'], selectableCount: 1 })
        await req('POST', '/message/pin', { to: P1, ...tgt, durationSecs: 86400 })
        await req('POST', '/message/pin', { to: P1, ...tgt, unpin: true })
        for (const k of ['image', 'video', 'audio', 'document', 'sticker'])
            await req('POST', '/message/sendMedia', { to: P1, type: k, media: files[k], ...(k === 'document' ? { fileName: 'a.pdf', mimetype: 'application/pdf' } : {}), ...(k === 'image' ? { caption: 'cap', mimetype: 'image/jpeg' } : {}) })
        for (const k of ['text', 'reaction', 'poll'])
            await req('POST', '/message/send', { to: P2, content: k === 'text' ? { type: 'text', text: 'via send' } : k === 'reaction' ? { type: 'reaction', emoji: 'x', ...tgt } : { type: 'poll', name: 'q', options: ['y', 'n'] } })
        await req('POST', '/message/send', { to: P2, content: { type: 'image', media: files.image, caption: 'via send image' } })
        await req('POST', '/message/send', { to: P2, content: { type: 'bogus' } })
        await req('POST', '/message/sendReceipt', { jid: P1, ids: [id(1)], type: 'read' })
        await req('POST', '/message/revoke', { to: P1, ...tgt })
        await req('POST', '/message/syncSignalSession', { jid: P1 })
        await req('POST', '/message/requestHistorySync', { input: {} })
        await req('GET', '/message/getNewChatMessageCapping')
        await req('GET', '/message/getReachoutTimelock')
        // inbound media downloaded through the app (the seq is the event sequence number of the media message)
        const ev = J(await req('GET', '/events?type=message'))
        const list: any[] = Array.isArray(ev) ? ev : (ev?.events ?? [])
        for (const e of list.slice(0, 40)) if (JSON.stringify(e).includes('imageMessage') || JSON.stringify(e).includes('"image"')) { await req('GET', `/message/downloadBytes?seq=${e.seq}`); await req('POST', '/message/downloadToFile', { seq: e.seq, filePath: `${dir}/sweep-dl-${e.seq}.bin` }); break }
        await req('GET', '/message/downloadBytes?seq=999999')
        await sleep(2000)
    }
    let gid = ''
    if (phases.has('D')) {
        mark('phase D: groups')
        const g1 = J(await req('POST', '/group/createGroup', { subject: 'Sweep group', participants: [P1, P2] }))
        gid = g1?.id ?? g1?.jid ?? g1?.groupJid ?? g1?.gid ?? ''
        if (gid === '') { const all = J(await req('GET', '/group/queryAllGroups')); const first = Array.isArray(all) ? all[0] : (all?.groups?.[0] ?? null); gid = first?.id ?? first?.jid ?? '' }
        mark(`group jid=${gid}`)
        await req('GET', '/group/queryAllGroups')
        if (gid !== '') {
            await req('GET', `/group/queryGroupMetadata?groupJid=${gid}`)
            await req('POST', '/group/setSubject', { groupJid: gid, subject: 'Sweep group renamed' })
            await req('POST', '/group/setDescription', { groupJid: gid, description: 'a description' })
            await req('POST', '/group/addParticipants', { groupJid: gid, participants: ['5511944445555@s.whatsapp.net'] })
            await req('POST', '/group/promoteParticipants', { groupJid: gid, participants: [P1] })
            await req('POST', '/group/demoteParticipants', { groupJid: gid, participants: [P1] })
            await req('POST', '/group/removeParticipants', { groupJid: gid, participants: ['5511944445555@s.whatsapp.net'] })
            await req('POST', '/group/setSetting', { groupJid: gid, setting: 'announcement' })
            await req('POST', '/group/setEphemeralDuration', { groupJid: gid, expirationSeconds: 86400 })
            await req('POST', '/group/setMemberAddMode', { groupJid: gid, mode: 'all_member_add' })
            await req('POST', '/group/setMemberLinkMode', { groupJid: gid, mode: 'admin_link' })
            await req('POST', '/group/setMemberShareGroupHistoryMode', { groupJid: gid, mode: 'all_member_share' })
            await req('GET', `/group/queryInviteCode?groupJid=${gid}`)
            await req('POST', '/group/revokeInvite', { groupJid: gid })
            await req('GET', `/group/isInternalGroup?groupJid=${gid}`)
            await req('GET', `/group/queryMembershipApprovalRequests?groupJid=${gid}`)
            await step('D.groupmsg', () => peer1.sendGroupConversation(gid, 'hello group', { id: id(200), participant: P1 } as any))
            await sleep(1500)
            await req('POST', '/message/sendText', { to: gid, text: 'to the group' })
            await req('POST', '/message/react', { to: gid, emoji: 'x', targetRemoteJid: gid, targetId: id(200), targetParticipant: P1 })
            await req('GET', `/store/messages?thread=${gid}`)
            await req('POST', '/group/leaveGroup', { groupJids: [gid] })
        }
        await req('POST', '/group/createCommunity', { subject: 'Sweep community' })
        await req('POST', '/group/joinGroupViaInvite', { code: 'ABCDEFGHIJKLMNOP' })
        await req('GET', '/group/queryGroupInviteInfo?code=ABCDEFGHIJKLMNOP')
    }
    if (phases.has('E')) {
        mark('phase E: chat mutations')
        const ch = P1
        await req('POST', '/chat/setChatPin', { chatJid: ch, pinned: true })
        await req('POST', '/chat/setChatMute', { chatJid: ch, muted: true, muteEndTimestampMs: 4102444800000 })
        await req('POST', '/chat/setChatArchive', { chatJid: ch, archived: true })
        await req('POST', '/chat/setChatRead', { chatJid: ch, read: true })
        await req('POST', '/chat/setChatLock', { chatJid: ch, locked: true })
        await req('POST', '/chat/setMessageStar', { chatJid: ch, id: id(1), starred: true })
        await req('POST', '/chat/setUserStatusMute', { jid: ch, muted: true })
        await req('POST', '/chat/setStatusPrivacy', {})
        await req('POST', '/chat/deleteMessageForMe', { chatJid: ch, id: id(2) })
        await req('POST', '/chat/clearChat', { chatJid: P2 })
        await req('POST', '/chat/deleteChat', { chatJid: '55119200001@s.whatsapp.net' })
        await req('POST', '/chat/flushMutations')
        await req('POST', '/chat/sync')
        await sleep(2500)
        await req('GET', '/store/threads')
        await req('GET', '/store/counts')
    }
    if (phases.has('F')) {
        mark('phase F: profile, privacy, presence, status, business')
        await req('POST', '/presence/send', { type: 'available' })
        await req('POST', '/presence/send', { type: 'unavailable' })
        await req('POST', '/presence/sendChatstate', { jid: P1, state: 'composing' })
        await req('POST', '/presence/sendChatstate', { jid: P1, state: 'recording', media: 'audio' })
        await req('POST', '/presence/subscribe', { jid: P1 })
        await req('GET', '/privacy/getPrivacySettings')
        await req('POST', '/privacy/setPrivacySetting', { setting: 'last', value: 'contacts' })
        await req('GET', '/privacy/getPrivacySettings')
        await req('POST', '/privacy/blockUser', { jid: P2 })
        await req('GET', '/privacy/getBlocklist')
        await req('POST', '/privacy/unblockUser', { jid: P2 })
        await req('GET', '/privacy/getBlocklist')
        await req('GET', '/privacy/getDisallowedList?category=last')
        await req('GET', `/profile/getProfilePicture?jid=${P1}`)
        await req('GET', `/profile/getProfilePicture?jid=${P1}&type=image`)
        await req('GET', `/profile/getStatus?jid=${P1}`)
        await req('GET', `/profile/getAboutStatus?jid=${P1}`)
        await req('POST', '/profile/getProfiles', { jids: [P1, P2] })
        await req('POST', '/profile/getDisappearingMode', { jids: [P1] })
        await req('POST', '/profile/setDisappearingMode', { durationSeconds: 86400 })
        await req('POST', '/profile/setPushName', { name: 'Sweep User' })
        await req('POST', '/profile/setStatus', { text: 'sweeping' })
        await req('POST', '/profile/deleteProfilePicture', {})
        await req('POST', '/status/send', { text: 'a status' })
        await req('POST', '/status/setPrivacy', {})
        await req('POST', '/status/setUserMuted', { jid: P1, muted: true })
        await req('POST', '/status/revokeStatus', {})
        await req('POST', '/business/getBusinessProfile', { jids: [P1] })
        await req('POST', '/business/getVerifiedNames', { jids: [P1] })
        await req('GET', `/business/getVerifiedName?jid=${P1}`)
        await req('POST', '/business/editBusinessProfile', {})
        await req('POST', '/lowlevel/sendNode', { node: { tag: 'presence', attrs: { type: 'available' } } })
    }
    if (phases.has('G')) {
        mark('phase G: routes without a fake-server handler')
        for (const [m, p, b] of [['GET', '/newsletter/listSubscribed'], ['POST', '/newsletter/follow', { newsletterJid: '120363000000000001@newsletter' }],
            ['GET', '/newsletter/fetchRecommended'], ['POST', '/newsletter/send', { newsletterJid: '120363000000000001@newsletter', text: 'x' }],
            ['GET', '/bot/listBots'], ['GET', '/email/getStatus'], ['GET', '/mobile/listCompanions'], ['POST', '/mobile/reconcileCompanions'],
            ['POST', '/auth/requestPairingCode', { phoneNumber: '5511999990000' }], ['GET', '/auth/fetchPairingCountryCodeIso'],
            ['POST', '/lowlevel/query', { node: { tag: 'iq', attrs: { xmlns: 'w:p', type: 'get', to: 's.whatsapp.net' } }, timeoutMs: 3000 }],
            ['POST', '/broadcastList/send'], ['POST', '/chat/setBroadcastList'], ['POST', '/profile/getTextStatuses', { jids: [P1] }], ['POST', '/profile/getLidsByPhoneNumbers', { phoneNumbers: ['5511911112222'] }],
            ['GET', '/profile/getOwnUsername'], ['GET', '/profile/checkUsernameAvailability?username=sweepuser']] as any[])
            await req(m, p, b)
    }
    mark('sweep-end')
    for (const g of ['/store/counts', '/store/threads', '/store/tables', '/events', '/messages', '/health']) await req('GET', g)
    const th = J(await req('GET', '/store/threads'))
    const tl: any[] = Array.isArray(th) ? th : (th?.threads ?? [])
    for (const t of tl.slice(0, 30)) { const j = t.jid ?? t.id ?? t.chatJid; if (j) await req('GET', `/store/messages?thread=${encodeURIComponent(j)}`) }
    void SELFJ; void n
}
