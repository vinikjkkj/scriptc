# zapo-rest — API reference

Every route answers JSON. A success is `{"ok":true,"result":...}`; a failure is
`{"error":"...","detail":"..."}` with an HTTP status. Both a query string and a JSON
body are accepted on **every** route and merged into one parameter bag, so any route
can be driven with `?name=value` alone.

| status | meaning |
|---|---|
| 200 | the call ran |
| 400 | a required parameter is missing, or the body is not JSON |
| 401 | `ZAPO_REST_TOKEN` is set and the `x-api-key` header does not match |
| 404 | no such route |
| 500 | zapo threw (not connected, WhatsApp refused, …) — `detail` carries the message |
| **501** | **the compiler has no static lowering for this zapo method.** `diagnostic` carries the `[SCxxxx]` code. See "Unimplemented" at the end. |

Routes in this build: **189**, covering **170 of 210** public members of zapo's client surface.

## service

### `GET /clockSkewMs`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/clockSkewMs' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /connect`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/connect' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `GET /credentials`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/credentials' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /disconnect`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/disconnect' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `GET /events`

| parameter | type | required |
|---|---|---|
| `type` | string | no |
| `since` | number | no |
| `limit` | number | no |

```sh
curl -s 'http://127.0.0.1:8787/events?type=OPTIONAL&since=OPTIONAL&limit=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /health`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/health' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /logout`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/logout' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `GET /messages`

| parameter | type | required |
|---|---|---|
| `since` | number | no |
| `limit` | number | no |

```sh
curl -s 'http://127.0.0.1:8787/messages?since=OPTIONAL&limit=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /qr`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/qr' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /state`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/state' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

## store reads

### `GET /store/contact`

| parameter | type | required |
|---|---|---|
| `phone` | string | no |
| `jid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/store/contact?phone=OPTIONAL&jid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /store/contacts`

| parameter | type | required |
|---|---|---|
| `limit` | number | no |

```sh
curl -s 'http://127.0.0.1:8787/store/contacts?limit=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /store/counts`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/store/counts' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /store/message`

| parameter | type | required |
|---|---|---|
| `id` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/store/message?id=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /store/messages`

| parameter | type | required |
|---|---|---|
| `thread` | string | yes |
| `limit` | number | no |
| `before` | number | no |

```sh
curl -s 'http://127.0.0.1:8787/store/messages?thread=VALUE&limit=OPTIONAL&before=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /store/tables`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/store/tables' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /store/thread`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/store/thread?jid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /store/threads`

| parameter | type | required |
|---|---|---|
| `limit` | number | no |

```sh
curl -s 'http://127.0.0.1:8787/store/threads?limit=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

## auth

### `POST /auth/clearStoredCredentials`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/auth/clearStoredCredentials' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `POST /auth/clearTransientState`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/auth/clearTransientState' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `GET /auth/fetchPairingCountryCodeIso`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/auth/fetchPairingCountryCodeIso' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /auth/getState`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/auth/getState' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /auth/loadOrCreateCredentials`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/auth/loadOrCreateCredentials' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /auth/requestPairingCode`

| parameter | type | required |
|---|---|---|
| `phoneNumber` | string | yes |
| `shouldShowPushNotification` | boolean | no |
| `customCode` | string | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/auth/requestPairingCode' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"phoneNumber": "VALUE", "shouldShowPushNotification": true, "customCode": "VALUE"}'
```

### `POST /auth/setNextConnectMobileAppVersion`

| parameter | type | required |
|---|---|---|
| `appVersion` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/auth/setNextConnectMobileAppVersion' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"appVersion": "VALUE"}'
```

### `POST /auth/setNextConnectVersion`

| parameter | type | required |
|---|---|---|
| `version` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/auth/setNextConnectVersion' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"version": "VALUE"}'
```

## message

### `POST /message/downloadBytes`

| parameter | type | required |
|---|---|---|
| `message` | object (JSON) | no |
| `maxBytes` | number | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/message/downloadBytes' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"message": {}, "maxBytes": 0}'
```

### `POST /message/downloadToFile`

| parameter | type | required |
|---|---|---|
| `message` | object (JSON) | no |
| `filePath` | string | yes |
| `maxBytes` | number | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/message/downloadToFile' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"message": {}, "filePath": "VALUE", "maxBytes": 0}'
```

### `GET /message/getNewChatMessageCapping`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/message/getNewChatMessageCapping' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /message/getReachoutTimelock`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/message/getReachoutTimelock' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /message/pin`

| parameter | type | required |
|---|---|---|
| `durationSecs` | number | no |
| `to` | string | yes |
| `unpin` | boolean | no |
| `targetRemoteJid` | string | yes |
| `targetId` | string | yes |
| `targetFromMe` | boolean | no |
| `targetParticipant` | string | no |

```sh
curl -s 'http://127.0.0.1:8787/message/pin?durationSecs=OPTIONAL&to=VALUE&unpin=OPTIONAL&targetRemoteJid=VALUE&targetId=VALUE&targetFromMe=OPTIONAL&targetParticipant=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /message/poll`

| parameter | type | required |
|---|---|---|
| `to` | string | yes |
| `name` | string | yes |
| `options` | string[] (comma-separated, or a JSON array) | yes |
| `selectableCount` | number | no |

```sh
curl -s 'http://127.0.0.1:8787/message/poll?to=VALUE&name=VALUE&options=VALUE&selectableCount=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /message/react`

| parameter | type | required |
|---|---|---|
| `to` | string | yes |
| `emoji` | string | yes |
| `targetRemoteJid` | string | yes |
| `targetId` | string | yes |
| `targetFromMe` | boolean | no |
| `targetParticipant` | string | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/message/react' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"to": "VALUE", "emoji": "VALUE", "targetRemoteJid": "VALUE", "targetId": "VALUE", "targetFromMe": true, "targetParticipant": "VALUE"}'
```

### `GET /message/reply`

| parameter | type | required |
|---|---|---|
| `to` | string | yes |
| `text` | string | yes |
| `quotedRemoteJid` | string | yes |
| `quotedId` | string | yes |
| `quotedFromMe` | boolean | no |
| `quotedParticipant` | string | no |

```sh
curl -s 'http://127.0.0.1:8787/message/reply?to=VALUE&text=VALUE&quotedRemoteJid=VALUE&quotedId=VALUE&quotedFromMe=OPTIONAL&quotedParticipant=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /message/requestHistorySync`

| parameter | type | required |
|---|---|---|
| `input` | object (JSON) | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/message/requestHistorySync' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"input": {}}'
```

### `POST /message/revoke`

| parameter | type | required |
|---|---|---|
| `to` | string | yes |
| `targetRemoteJid` | string | yes |
| `targetId` | string | yes |
| `targetFromMe` | boolean | no |
| `targetParticipant` | string | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/message/revoke' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"to": "VALUE", "targetRemoteJid": "VALUE", "targetId": "VALUE", "targetFromMe": true, "targetParticipant": "VALUE"}'
```

### `POST /message/send`

| parameter | type | required |
|---|---|---|
| `to` | string | yes |
| `text` | string | no |
| `content` | object (JSON) | no |
| `options` | object (JSON) | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/message/send' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"to": "VALUE", "text": "VALUE", "content": {}, "options": {}}'
```

### `POST /message/sendMedia`

| parameter | type | required |
|---|---|---|
| `type` | string | yes |
| `media` | string | yes |
| `to` | string | yes |
| `mimetype` | string | no |
| `caption` | string | no |
| `ptt` | boolean | no |
| `fileName` | string | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/message/sendMedia' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"type": "VALUE", "media": "VALUE", "to": "VALUE", "mimetype": "VALUE", "caption": "VALUE", "ptt": true, "fileName": "VALUE"}'
```

### `POST /message/sendReceipt`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |
| `ids` | string[] (comma-separated, or a JSON array) | yes |
| `type` | string | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/message/sendReceipt' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"jid": "VALUE", "ids": ["a","b"], "type": "VALUE"}'
```

### `POST /message/sendText`

| parameter | type | required |
|---|---|---|
| `to` | string | yes |
| `text` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/message/sendText' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"to": "VALUE", "text": "VALUE"}'
```

### `POST /message/syncSignalSession`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |
| `reasonIdentity` | boolean | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/message/syncSignalSession' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"jid": "VALUE", "reasonIdentity": true}'
```

## presence

### `POST /presence/send`

| parameter | type | required |
|---|---|---|
| `type` | string | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/presence/send' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"type": "VALUE"}'
```

### `POST /presence/sendChatstate`

| parameter | type | required |
|---|---|---|
| `state` | string | yes |
| `media` | string | no |
| `jid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/presence/sendChatstate' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"state": "VALUE", "media": "VALUE", "jid": "VALUE"}'
```

### `GET /presence/subscribe`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/presence/subscribe?jid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

## chat (app-state mutations)

### `POST /chat/clearChat`

| parameter | type | required |
|---|---|---|
| `chatJid` | string | yes |
| `deleteStarred` | boolean | no |
| `deleteMedia` | boolean | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/clearChat' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"chatJid": "VALUE", "deleteStarred": true, "deleteMedia": true}'
```

### `POST /chat/deleteChat`

| parameter | type | required |
|---|---|---|
| `chatJid` | string | yes |
| `deleteMedia` | boolean | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/deleteChat' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"chatJid": "VALUE", "deleteMedia": true}'
```

### `POST /chat/deleteMessageForMe`

| parameter | type | required |
|---|---|---|
| `chatJid` | string | yes |
| `id` | string | yes |
| `fromMe` | boolean | yes |
| `participantJid` | string | no |
| `deleteMedia` | boolean | no |
| `messageTimestampMs` | number | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/deleteMessageForMe' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"chatJid": "VALUE", "id": "VALUE", "fromMe": true, "participantJid": "VALUE", "deleteMedia": true, "messageTimestampMs": 0}'
```

### `POST /chat/flushMutations`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/flushMutations' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `POST /chat/removeBroadcastList`

| parameter | type | required |
|---|---|---|
| `id` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/removeBroadcastList' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"id": "VALUE"}'
```

### `POST /chat/setChatArchive`

| parameter | type | required |
|---|---|---|
| `chatJid` | string | yes |
| `archived` | boolean | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/setChatArchive' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"chatJid": "VALUE", "archived": true}'
```

### `POST /chat/setChatLock`

| parameter | type | required |
|---|---|---|
| `chatJid` | string | yes |
| `locked` | boolean | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/setChatLock' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"chatJid": "VALUE", "locked": true}'
```

### `POST /chat/setChatMute`

| parameter | type | required |
|---|---|---|
| `chatJid` | string | yes |
| `muted` | boolean | yes |
| `muteEndTimestampMs` | number | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/setChatMute' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"chatJid": "VALUE", "muted": true, "muteEndTimestampMs": 0}'
```

### `POST /chat/setChatPin`

| parameter | type | required |
|---|---|---|
| `chatJid` | string | yes |
| `pinned` | boolean | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/setChatPin' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"chatJid": "VALUE", "pinned": true}'
```

### `POST /chat/setChatRead`

| parameter | type | required |
|---|---|---|
| `chatJid` | string | yes |
| `read` | boolean | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/setChatRead' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"chatJid": "VALUE", "read": true}'
```

### `POST /chat/setMessageStar`

| parameter | type | required |
|---|---|---|
| `chatJid` | string | yes |
| `id` | string | yes |
| `fromMe` | boolean | yes |
| `participantJid` | string | no |
| `starred` | boolean | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/setMessageStar' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"chatJid": "VALUE", "id": "VALUE", "fromMe": true, "participantJid": "VALUE", "starred": true}'
```

### `POST /chat/setUserStatusMute`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |
| `muted` | boolean | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/setUserStatusMute' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"jid": "VALUE", "muted": true}'
```

### `POST /chat/sync`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/sync' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

## group

### `POST /group/addParticipants`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `participants` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/addParticipants' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "participants": ["a","b"]}'
```

### `POST /group/approveMembershipRequests`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `participantJids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/approveMembershipRequests' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "participantJids": ["a","b"]}'
```

### `POST /group/cancelMembershipRequests`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `participantJids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/cancelMembershipRequests' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "participantJids": ["a","b"]}'
```

### `POST /group/createCommunity`

| parameter | type | required |
|---|---|---|
| `subject` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/createCommunity' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"subject": "VALUE"}'
```

### `POST /group/createGroup`

| parameter | type | required |
|---|---|---|
| `subject` | string | yes |
| `participants` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/createGroup' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"subject": "VALUE", "participants": ["a","b"]}'
```

### `POST /group/deactivateCommunity`

| parameter | type | required |
|---|---|---|
| `communityJid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/deactivateCommunity' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"communityJid": "VALUE"}'
```

### `POST /group/demoteParticipants`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `participants` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/demoteParticipants' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "participants": ["a","b"]}'
```

### `GET /group/fetchSubGroups`

| parameter | type | required |
|---|---|---|
| `communityJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/group/fetchSubGroups?communityJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /group/fetchSubgroupSuggestions`

| parameter | type | required |
|---|---|---|
| `communityJid` | string | yes |
| `hintSubgroupJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/group/fetchSubgroupSuggestions?communityJid=VALUE&hintSubgroupJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /group/isInternalGroup`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/group/isInternalGroup?groupJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /group/joinGroupViaInvite`

| parameter | type | required |
|---|---|---|
| `code` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/joinGroupViaInvite' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"code": "VALUE"}'
```

### `POST /group/joinLinkedGroup`

| parameter | type | required |
|---|---|---|
| `communityJid` | string | yes |
| `subGroupJid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/joinLinkedGroup' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"communityJid": "VALUE", "subGroupJid": "VALUE"}'
```

### `POST /group/leaveGroup`

| parameter | type | required |
|---|---|---|
| `groupJids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/leaveGroup' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJids": ["a","b"]}'
```

### `POST /group/linkSubGroups`

| parameter | type | required |
|---|---|---|
| `communityJid` | string | yes |
| `subGroupJids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/linkSubGroups' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"communityJid": "VALUE", "subGroupJids": ["a","b"]}'
```

### `POST /group/promoteParticipants`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `participants` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/promoteParticipants' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "participants": ["a","b"]}'
```

### `GET /group/queryAllGroups`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/group/queryAllGroups' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /group/queryGroupInviteInfo`

| parameter | type | required |
|---|---|---|
| `code` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/group/queryGroupInviteInfo?code=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /group/queryGroupMetadata`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/group/queryGroupMetadata?groupJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /group/queryInviteCode`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/group/queryInviteCode?groupJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /group/queryLinkedGroupsParticipants`

| parameter | type | required |
|---|---|---|
| `communityJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/group/queryLinkedGroupsParticipants?communityJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /group/queryMembershipApprovalRequests`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/group/queryMembershipApprovalRequests?groupJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /group/rejectMembershipRequests`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `participantJids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/rejectMembershipRequests' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "participantJids": ["a","b"]}'
```

### `POST /group/removeParticipants`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `participants` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/removeParticipants' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "participants": ["a","b"]}'
```

### `POST /group/revokeInvite`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/revokeInvite' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE"}'
```

### `POST /group/setDescription`

| parameter | type | required |
|---|---|---|
| `description` | string | no |
| `groupJid` | string | yes |
| `prevDescId` | string | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/setDescription' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"description": "VALUE", "groupJid": "VALUE", "prevDescId": "VALUE"}'
```

### `POST /group/setEphemeralDuration`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `expirationSeconds` | number | yes |
| `trigger` | number | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/setEphemeralDuration' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "expirationSeconds": 0, "trigger": 0}'
```

### `POST /group/setMemberAddMode`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `mode` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/setMemberAddMode' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "mode": "VALUE"}'
```

### `POST /group/setMemberLinkMode`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `mode` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/setMemberLinkMode' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "mode": "VALUE"}'
```

### `POST /group/setMemberShareGroupHistoryMode`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `mode` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/setMemberShareGroupHistoryMode' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "mode": "VALUE"}'
```

### `POST /group/setSetting`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `setting` | string | yes |
| `enabled` | boolean | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/setSetting' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "setting": "VALUE", "enabled": true}'
```

### `POST /group/setSubject`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |
| `subject` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/setSubject' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE", "subject": "VALUE"}'
```

### `POST /group/submitGroupSuspensionAppeal`

| parameter | type | required |
|---|---|---|
| `groupJid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/submitGroupSuspensionAppeal' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"groupJid": "VALUE"}'
```

### `POST /group/transferCommunityOwnership`

| parameter | type | required |
|---|---|---|
| `communityJid` | string | yes |
| `newOwnerJid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/transferCommunityOwnership' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"communityJid": "VALUE", "newOwnerJid": "VALUE"}'
```

### `POST /group/unlinkSubGroups`

| parameter | type | required |
|---|---|---|
| `communityJid` | string | yes |
| `subGroupJids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/group/unlinkSubGroups' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"communityJid": "VALUE", "subGroupJids": ["a","b"]}'
```

## privacy

### `POST /privacy/blockUser`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/privacy/blockUser' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"jid": "VALUE"}'
```

### `GET /privacy/getBlocklist`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/privacy/getBlocklist' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /privacy/getDisallowedList`

| parameter | type | required |
|---|---|---|
| `category` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/privacy/getDisallowedList?category=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /privacy/getPrivacySettings`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/privacy/getPrivacySettings' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /privacy/setPrivacySetting`

| parameter | type | required |
|---|---|---|
| `setting` | string | yes |
| `value` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/privacy/setPrivacySetting' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"setting": "VALUE", "value": "VALUE"}'
```

### `POST /privacy/unblockUser`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/privacy/unblockUser' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"jid": "VALUE"}'
```

## profile

### `GET /profile/checkUsernameAvailability`

| parameter | type | required |
|---|---|---|
| `username` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/profile/checkUsernameAvailability?username=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /profile/deleteProfilePicture`

| parameter | type | required |
|---|---|---|
| `targetJid` | string | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/profile/deleteProfilePicture' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"targetJid": "VALUE"}'
```

### `POST /profile/deleteUsername`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/profile/deleteUsername' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `GET /profile/getAboutStatus`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/profile/getAboutStatus?jid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /profile/getDisappearingMode`

| parameter | type | required |
|---|---|---|
| `jids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s 'http://127.0.0.1:8787/profile/getDisappearingMode?jids=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /profile/getLidsByPhoneNumbers`

| parameter | type | required |
|---|---|---|
| `phoneNumbers` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s 'http://127.0.0.1:8787/profile/getLidsByPhoneNumbers?phoneNumbers=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /profile/getOwnUsername`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/profile/getOwnUsername' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /profile/getProfilePicture`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |
| `type` | string | no |
| `existingId` | string | no |

```sh
curl -s 'http://127.0.0.1:8787/profile/getProfilePicture?jid=VALUE&type=OPTIONAL&existingId=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /profile/getProfiles`

| parameter | type | required |
|---|---|---|
| `jids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s 'http://127.0.0.1:8787/profile/getProfiles?jids=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /profile/getStatus`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/profile/getStatus?jid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /profile/getTextStatuses`

| parameter | type | required |
|---|---|---|
| `jids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s 'http://127.0.0.1:8787/profile/getTextStatuses?jids=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /profile/getUsernames`

| parameter | type | required |
|---|---|---|
| `jids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s 'http://127.0.0.1:8787/profile/getUsernames?jids=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /profile/setDisappearingMode`

| parameter | type | required |
|---|---|---|
| `durationSeconds` | number | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/profile/setDisappearingMode' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"durationSeconds": 0}'
```

### `POST /profile/setPushName`

| parameter | type | required |
|---|---|---|
| `name` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/profile/setPushName' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"name": "VALUE"}'
```

### `POST /profile/setStatus`

| parameter | type | required |
|---|---|---|
| `text` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/profile/setStatus' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"text": "VALUE"}'
```

### `POST /profile/setUsernameKey`

| parameter | type | required |
|---|---|---|
| `pin` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/profile/setUsernameKey' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"pin": "VALUE"}'
```

## business

### `POST /business/deleteCoverPhoto`

| parameter | type | required |
|---|---|---|
| `id` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/business/deleteCoverPhoto' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"id": "VALUE"}'
```

### `GET /business/getBusinessProfile`

| parameter | type | required |
|---|---|---|
| `jids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s 'http://127.0.0.1:8787/business/getBusinessProfile?jids=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /business/getVerifiedName`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/business/getVerifiedName?jid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /business/getVerifiedNames`

| parameter | type | required |
|---|---|---|
| `jids` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s 'http://127.0.0.1:8787/business/getVerifiedNames?jids=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

## bot

### `GET /bot/getBotProfile`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/bot/getBotProfile?jid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /bot/listBots`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/bot/listBots' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /bot/sendPrompt`

| parameter | type | required |
|---|---|---|
| `to` | string | yes |
| `text` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/bot/sendPrompt' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"to": "VALUE", "text": "VALUE"}'
```

## email

### `POST /email/confirm`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/email/confirm' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `GET /email/getStatus`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/email/getStatus' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /email/setEmail`

| parameter | type | required |
|---|---|---|
| `email` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/email/setEmail' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"email": "VALUE"}'
```

### `POST /email/verifyCode`

| parameter | type | required |
|---|---|---|
| `code` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/email/verifyCode' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"code": "VALUE"}'
```

## mobile (companion management)

### `POST /mobile/linkCompanion`

| parameter | type | required |
|---|---|---|
| `qr` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/mobile/linkCompanion' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"qr": "VALUE"}'
```

### `POST /mobile/linkCompanionByCode`

| parameter | type | required |
|---|---|---|
| `pairingCode` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/mobile/linkCompanionByCode' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"pairingCode": "VALUE"}'
```

### `GET /mobile/listCompanions`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/mobile/listCompanions' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /mobile/publishKeyIndexList`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/mobile/publishKeyIndexList' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `POST /mobile/reconcileCompanions`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/mobile/reconcileCompanions' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `POST /mobile/revokeAllCompanions`

| parameter | type | required |
|---|---|---|
| `reason` | string | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/mobile/revokeAllCompanions' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"reason": "VALUE"}'
```

### `POST /mobile/revokeCompanion`

| parameter | type | required |
|---|---|---|
| `companionDeviceJid` | string | yes |
| `reason` | string | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/mobile/revokeCompanion' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"companionDeviceJid": "VALUE", "reason": "VALUE"}'
```

### `POST /mobile/shareAppStateSyncKeys`

| parameter | type | required |
|---|---|---|
| `companionDeviceJid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/mobile/shareAppStateSyncKeys' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"companionDeviceJid": "VALUE"}'
```

## status (stories)

### `POST /status/setUserMuted`

| parameter | type | required |
|---|---|---|
| `jid` | string | yes |
| `muted` | boolean | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/status/setUserMuted' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"jid": "VALUE", "muted": true}'
```

## broadcast lists

### `POST /broadcastList/removeList`

| parameter | type | required |
|---|---|---|
| `id` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/broadcastList/removeList' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"id": "VALUE"}'
```

## newsletter (channels)

### `POST /newsletter/acceptAdminInvite`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/acceptAdminInvite' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"newsletterJid": "VALUE"}'
```

### `POST /newsletter/delete`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/delete' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"newsletterJid": "VALUE"}'
```

### `POST /newsletter/editMessage`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |
| `parentMessageId` | string | yes |
| `text` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/editMessage' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"newsletterJid": "VALUE", "parentMessageId": "VALUE", "text": "VALUE"}'
```

### `GET /newsletter/fetchAdminInfo`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchAdminInfo?newsletterJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchFollowers`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchFollowers?newsletterJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchIsDomainPreviewable`

| parameter | type | required |
|---|---|---|
| `domains` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchIsDomainPreviewable?domains=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchPendingInvites`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchPendingInvites?newsletterJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchReports`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchReports' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /newsletter/follow`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/follow' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"newsletterJid": "VALUE"}'
```

### `POST /newsletter/send`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |
| `text` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/send' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"newsletterJid": "VALUE", "text": "VALUE"}'
```

### `GET /newsletter/subscribeLiveUpdates`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/subscribeLiveUpdates?newsletterJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /newsletter/unfollow`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/unfollow' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"newsletterJid": "VALUE"}'
```

## lowlevel

### `GET /lowlevel/query`

| parameter | type | required |
|---|---|---|
| `node` | object (JSON) | no |
| `timeoutMs` | number | no |

```sh
curl -s 'http://127.0.0.1:8787/lowlevel/query?node=OPTIONAL&timeoutMs=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /lowlevel/sendNode`

| parameter | type | required |
|---|---|---|
| `node` | object (JSON) | no |

```sh
curl -s -X POST 'http://127.0.0.1:8787/lowlevel/sendNode' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"node": {}}'
```

## status (stories), record-argument routes

### `POST /status/revokeStatus`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/status/revokeStatus' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /status/send`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/status/send' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /status/setPrivacy`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/status/setPrivacy' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

## broadcast lists, record-argument routes

### `POST /broadcastList/send`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/broadcastList/send' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /broadcastList/setList`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/broadcastList/setList' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /chat/setBroadcastList`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/setBroadcastList' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /chat/setStatusPrivacy`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/chat/setStatusPrivacy' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

## profile / business / email, record-argument routes

### `POST /business/editBusinessProfile`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/business/editBusinessProfile' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /email/requestVerificationCode`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/email/requestVerificationCode' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /profile/setTextStatus`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/profile/setTextStatus' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /profile/setUsername`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/profile/setUsername' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

## newsletter (channels), the rest of the surface

### `POST /newsletter/acceptTos`

| parameter | type | required |
|---|---|---|
| `noticeIds` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/acceptTos' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"noticeIds": ["a","b"]}'
```

### `POST /newsletter/changeOwner`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/changeOwner' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /newsletter/create`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/create' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /newsletter/createAdminInvite`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/createAdminInvite' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /newsletter/demoteAdmin`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/demoteAdmin' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `GET /newsletter/fetch`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetch?newsletterJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchAdminCapabilities`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchAdminCapabilities?newsletterJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchByInvite`

| parameter | type | required |
|---|---|---|
| `inviteCode` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchByInvite?inviteCode=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchDehydrated`

| parameter | type | required |
|---|---|---|
| `keyOrInvite` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchDehydrated?keyOrInvite=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchDirectoryCategoriesPreview`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchDirectoryCategoriesPreview' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchDirectoryList`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchDirectoryList' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchEnforcements`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchEnforcements?newsletterJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchInsights`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchInsights?newsletterJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchMessageReactionSenders`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |
| `messageServerId` | number | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchMessageReactionSenders?newsletterJid=VALUE&messageServerId=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchMessages`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |
| `count` | number | no |
| `before` | number | no |
| `after` | number | no |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchMessages?newsletterJid=VALUE&count=OPTIONAL&before=OPTIONAL&after=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchMessageUpdates`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |
| `count` | number | no |
| `since` | number | no |
| `before` | number | no |
| `after` | number | no |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchMessageUpdates?newsletterJid=VALUE&count=OPTIONAL&since=OPTIONAL&before=OPTIONAL&after=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchPollVoters`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |
| `messageServerId` | number | yes |
| `voteHash` | string | yes |
| `limit` | number | no |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchPollVoters?newsletterJid=VALUE&messageServerId=VALUE&voteHash=VALUE&limit=OPTIONAL' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchRecommended`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchRecommended' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/fetchSimilar`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/fetchSimilar?newsletterJid=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `GET /newsletter/listSubscribed`

No parameters.

```sh
curl -s 'http://127.0.0.1:8787/newsletter/listSubscribed' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /newsletter/logExposures`

No parameters.

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/logExposures' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{}'
```

### `POST /newsletter/mute`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/mute' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `GET /newsletter/queryTosState`

| parameter | type | required |
|---|---|---|
| `noticeIds` | string[] (comma-separated, or a JSON array) | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/queryTosState?noticeIds=VALUE' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /newsletter/react`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/react' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /newsletter/revoke`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/revoke' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /newsletter/revokeAdminInvite`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/revokeAdminInvite' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `GET /newsletter/searchDirectory`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s 'http://127.0.0.1:8787/newsletter/searchDirectory' -H 'x-api-key: $ZAPO_REST_TOKEN'
```

### `POST /newsletter/sendViewReceipt`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/sendViewReceipt' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

### `POST /newsletter/update`

| parameter | type | required |
|---|---|---|
| `newsletterJid` | string | yes |
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/update' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{"newsletterJid": "VALUE"}'
```

### `POST /newsletter/votePoll`

| parameter | type | required |
|---|---|---|
| `(whole JSON body)` | object — the zapo input record; or wrap it in an "input" member | yes |

```sh
curl -s -X POST 'http://127.0.0.1:8787/newsletter/votePoll' -H 'x-api-key: $ZAPO_REST_TOKEN' \
       -H 'content-type: application/json' -d '{ ...the zapo input record... }'
```

## Unimplemented, and why

40 of zapo's 210 public client members are deliberately not routed. None is
omitted silently — each is listed here with its reason.

| zapo member | reason |
|---|---|
| `auth.buildCommsConfig` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `auth.clearRoutingInfo` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `auth.getCurrentCredentials` | returns private key material; deliberately not exposed over HTTP (GET /credentials reports presence only) |
| `auth.handleCompanionRegRefreshNotification` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `auth.handleIncomingIqSet` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `auth.handleLinkCodeNotification` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `auth.persistRoutingInfo` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `auth.persistServerHasPreKeys` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `auth.persistServerStaticKey` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `auth.persistSuccessAttributes` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `bot.tryDecryptChunk` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `business.updateCoverPhoto` | takes an upload handle / media source object rather than a scalar; use the media routes |
| `chat.emitEventsFromSyncResult` | takes a WaAppStateSyncResult value returned by another call in the same process; not addressable over HTTP |
| `chat.getBlockedCollections` | takes a WaAppStateSyncResult value returned by another call in the same process; not addressable over HTTP |
| `chat.remove` | argument is the 60-arm app-state schema union; no stable JSON spelling — use the named per-collection routes |
| `chat.set` | argument is the 60-arm app-state schema union; no stable JSON spelling — use the named per-collection routes |
| `client.addListener` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.emit` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.eventNames` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.getMaxListeners` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.ignoreKey` | takes a callback and returns an unsubscribe function — cannot cross an HTTP boundary; use GET /events |
| `client.listenerCount` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.listeners` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.off` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.on` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.once` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.prependListener` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.prependOnceListener` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.rawListeners` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.removeAllListeners` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.removeListener` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `client.setMaxListeners` | EventEmitter plumbing — not a REST operation; subscribe by polling GET /events instead |
| `lowlevel.registerIncomingHandler` | takes a callback and returns an unsubscribe function — cannot cross an HTTP boundary; use GET /events |
| `lowlevel.registerIncomingStanzaFilter` | takes a callback and returns an unsubscribe function — cannot cross an HTTP boundary; use GET /events |
| `lowlevel.unregisterIncomingHandler` | takes a callback and returns an unsubscribe function — cannot cross an HTTP boundary; use GET /events |
| `message.download` | returns a Node Readable the caller must own; use the bytes form instead |
| `message.tryDecryptAddon` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `message.upload` | takes an upload handle / media source object rather than a scalar; use the media routes |
| `mobile.sendHistorySyncBootstrap` | internal protocol plumbing (takes a BinaryNode / raw crypto material or is driven by the connection state machine); not a user-facing operation |
| `profile.setProfilePicture` | takes an upload handle / media source object rather than a scalar; use the media routes |
