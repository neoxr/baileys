/* @ts-ignore */
import * as libsignal from 'libsignal';
// @ts-ignore
import { PreKeyWhisperMessage } from 'libsignal/src/protobufs.js';
import { generateSignalPubKey } from '../Utils/index.js';
import { jidDecode, transferDevice, WAJIDDomains } from '../WABinary/index.js';
import { SenderKeyName } from './Group/sender-key-name.js';
import { SenderKeyRecord } from './Group/sender-key-record.js';
import { GroupCipher, GroupSessionBuilder, SenderKeyDistributionMessage } from './Group/index.js';
import { LIDMappingStore } from './lid-mapping.js';
/** Extract identity key from PreKeyWhisperMessage for identity change detection */
function extractIdentityFromPkmsg(ciphertext) {
    try {
        if (!ciphertext || ciphertext.length < 2) {
            return undefined;
        }
        // Version byte check (version 3)
        const version = ciphertext[0];
        if ((version & 0xf) !== 3) {
            return undefined;
        }
        // Parse protobuf (skip version byte)
        const preKeyProto = PreKeyWhisperMessage.decode(ciphertext.slice(1));
        if (preKeyProto.identityKey?.length === 33) {
            return new Uint8Array(preKeyProto.identityKey);
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
export function makeLibSignalRepository(auth, onWhatsAppFunc) {
    const lidMapping = new LIDMappingStore(auth.keys, onWhatsAppFunc);
    const storage = signalStorage(auth, lidMapping);
    const parsedKeys = auth.keys;
    function isLikelySyncMessage(addr) {
        const key = addr.toString();
        // Only bypass for WhatsApp system addresses, not regular user contacts
        // Be very specific about sync service patterns
        return (key.includes('@lid.whatsapp.net') || // WhatsApp system messages
            key.includes('@broadcast') || // Broadcast messages
            key.includes('@newsletter'));
    }
    const repository = {
        decryptGroupMessage({ group, authorJid, msg }) {
            const senderName = jidToSignalSenderKeyName(group, authorJid);
            const cipher = new GroupCipher(storage, senderName);
            // Use transaction to ensure atomicity
            return parsedKeys.transaction(async () => {
                return cipher.decrypt(msg);
            }, group);
        },
        async processSenderKeyDistributionMessage({ item, authorJid }) {
            const builder = new GroupSessionBuilder(storage);
            if (!item.groupId) {
                throw new Error('Group ID is required for sender key distribution message');
            }
            const senderName = jidToSignalSenderKeyName(item.groupId, authorJid);
            const senderMsg = new SenderKeyDistributionMessage(null, null, null, null, item.axolotlSenderKeyDistributionMessage);
            const senderNameStr = senderName.toString();
            const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr]);
            if (!senderKey) {
                await storage.storeSenderKey(senderName, new SenderKeyRecord());
            }
            return parsedKeys.transaction(async () => {
                const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr]);
                if (!senderKey) {
                    await storage.storeSenderKey(senderName, new SenderKeyRecord());
                }
                await builder.process(senderName, senderMsg);
            }, item.groupId);
        },
        async decryptMessage({ jid, type, ciphertext }) {
            const addr = jidToSignalProtocolAddress(jid);
            const session = new libsignal.SessionCipher(storage, addr);
            // Extract and save sender's identity key before decryption for identity change detection
            if (type === 'pkmsg') {
                const identityKey = extractIdentityFromPkmsg(ciphertext);
                if (identityKey) {
                    const addrStr = addr.toString();
                    const identityChanged = await storage.saveIdentity(addrStr, identityKey);
                    if (identityChanged) {
                        console.info({ jid, addr: addrStr }, 'identity key changed or new contact, session will be re-established');
                    }
                }
            }
            async function doDecrypt() {
                let result;
                switch (type) {
                    case 'pkmsg':
                        result = await session.decryptPreKeyWhisperMessage(ciphertext);
                        break;
                    case 'msg':
                        result = await session.decryptWhisperMessage(ciphertext);
                        break;
                }
                return result;
            }
            if (isLikelySyncMessage(addr)) {
                // If it's a sync message, we can skip the transaction
                // as it is likely to be a system message that doesn't require strict atomicity
                return await doDecrypt();
            }
            // If it's not a sync message, we need to ensure atomicity
            // For regular messages, we use a transaction to ensure atomicity
            return parsedKeys.transaction(async () => {
                return await doDecrypt();
            }, jid);
        },
        async encryptMessage({ jid, data }) {
            // LID SINGLE SOURCE OF TRUTH: Always prefer LID when available
            let encryptionJid = jid;
            // Check for LID mapping and use it if session exists
            if (jid.includes('@s.whatsapp.net')) {
                const lidForPN = await lidMapping.getLIDForPN(jid);
                if (lidForPN?.includes('@lid')) {
                    const lidAddr = jidToSignalProtocolAddress(lidForPN);
                    const { [lidAddr.toString()]: lidSession } = await auth.keys.get('session', [lidAddr.toString()]);
                    if (lidSession) {
                        // LID session exists, use it
                        encryptionJid = lidForPN;
                    }
                    else {
                        // Try to migrate if PN session exists
                        const pnAddr = jidToSignalProtocolAddress(jid);
                        const { [pnAddr.toString()]: pnSession } = await auth.keys.get('session', [pnAddr.toString()]);
                        if (pnSession) {
                            // Migrate PN to LID
                            await repository.migrateSession([jid], lidForPN);
                            encryptionJid = lidForPN;
                        }
                    }
                }
            }
            const addr = jidToSignalProtocolAddress(encryptionJid);
            const cipher = new libsignal.SessionCipher(storage, addr);
            // Use transaction to ensure atomicity
            return parsedKeys.transaction(async () => {
                const { type: sigType, body } = await cipher.encrypt(data);
                const type = sigType === 3 ? 'pkmsg' : 'msg';
                return { type, ciphertext: Buffer.from(body, 'binary') };
            }, jid);
        },
        async encryptGroupMessage({ group, meId, data }) {
            const senderName = jidToSignalSenderKeyName(group, meId);
            const builder = new GroupSessionBuilder(storage);
            const senderNameStr = senderName.toString();
            return parsedKeys.transaction(async () => {
                const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr]);
                if (!senderKey) {
                    await storage.storeSenderKey(senderName, new SenderKeyRecord());
                }
                const senderKeyDistributionMessage = await builder.create(senderName);
                const session = new GroupCipher(storage, senderName);
                const ciphertext = await session.encrypt(data);
                return {
                    ciphertext,
                    senderKeyDistributionMessage: senderKeyDistributionMessage.serialize()
                };
            }, group);
        },
        async injectE2ESession({ jid, session }) {
            const cipher = new libsignal.SessionBuilder(storage, jidToSignalProtocolAddress(jid));
            return parsedKeys.transaction(async () => {
                await cipher.initOutgoing(session);
            }, jid);
        },
        jidToSignalProtocolAddress(jid) {
            return jidToSignalProtocolAddress(jid).toString();
        },
        // Optimized direct access to LID mapping store
        lidMapping,
        async validateSession(jid) {
            try {
                const addr = jidToSignalProtocolAddress(jid);
                const session = await storage.loadSession(addr.toString());
                if (!session) {
                    return { exists: false, reason: 'no session' };
                }
                if (!session.haveOpenSession()) {
                    return { exists: false, reason: 'no open session' };
                }
                return { exists: true };
            }
            catch (error) {
                return { exists: false, reason: 'validation error' };
            }
        },
        async deleteSession(jids) {
            if (!jids.length)
                return;
            // Convert JIDs to signal addresses and prepare for bulk deletion
            const sessionUpdates = {};
            jids.forEach(jid => {
                const addr = jidToSignalProtocolAddress(jid);
                sessionUpdates[addr.toString()] = null;
            });
            // Single transaction for all deletions
            return parsedKeys.transaction(async () => {
                await auth.keys.set({ session: sessionUpdates });
            }, `delete-${jids.length}-sessions`);
        },
        async migrateSession(fromJids, toJid) {
            if (!fromJids.length || !toJid.includes('@lid'))
                return { migrated: 0, skipped: 0, total: 0 };
            // Filter valid PN JIDs
            const validJids = fromJids.filter(jid => jid.includes('@s.whatsapp.net'));
            if (!validJids.length)
                return { migrated: 0, skipped: 0, total: fromJids.length };
            // Single optimized transaction for all migrations
            return parsedKeys.transaction(async () => {
                // 1. Batch store all LID mappings
                const mappings = validJids.map(jid => ({
                    lid: transferDevice(jid, toJid),
                    pn: jid
                }));
                await lidMapping.storeLIDPNMappings(mappings);
                // 2. Prepare migration operations
                const migrationOps = validJids.map(jid => {
                    const lidWithDevice = transferDevice(jid, toJid);
                    const fromDecoded = jidDecode(jid);
                    const toDecoded = jidDecode(lidWithDevice);
                    return {
                        fromJid: jid,
                        toJid: lidWithDevice,
                        pnUser: fromDecoded.user,
                        lidUser: toDecoded.user,
                        deviceId: fromDecoded.device || 0,
                        fromAddr: jidToSignalProtocolAddress(jid),
                        toAddr: jidToSignalProtocolAddress(lidWithDevice)
                    };
                });
                // 3. Batch check which LID sessions already exist
                const lidAddrs = migrationOps.map(op => op.toAddr.toString());
                const existingSessions = await auth.keys.get('session', lidAddrs);
                // 4. Filter out sessions that already have LID sessions
                const opsToMigrate = migrationOps.filter(op => !existingSessions[op.toAddr.toString()]);
                const skippedCount = migrationOps.length - opsToMigrate.length;
                if (!opsToMigrate.length) {
                    return { migrated: 0, skipped: skippedCount, total: validJids.length };
                }
                // 5. Execute all migrations in parallel
                await Promise.all(opsToMigrate.map(async (op) => {
                    const fromSession = await storage.loadSession(op.fromAddr.toString());
                    if (fromSession?.haveOpenSession()) {
                        // Copy session to LID address
                        const sessionBytes = fromSession.serialize();
                        const copiedSession = libsignal.SessionRecord.deserialize(sessionBytes);
                        await storage.storeSession(op.toAddr.toString(), copiedSession);
                        // Delete PN session
                        await auth.keys.set({ session: { [op.fromAddr.toString()]: null } });
                    }
                }));
                return { migrated: opsToMigrate.length, skipped: skippedCount, total: validJids.length };
            }, `migrate-${validJids.length}-sessions-${jidDecode(toJid)?.user}`);
        },
        async encryptMessageWithWire({ encryptionJid, wireJid, data }) {
            const result = await repository.encryptMessage({ jid: encryptionJid, data });
            return { ...result, wireJid };
        }
    };
    return repository;
}
const jidToSignalProtocolAddress = (jid) => {
    const decoded = jidDecode(jid);
    const { user, device, server } = decoded;
    if (!user) {
        throw new Error(`JID decoded but user is empty: "${jid}" -> user: "${user}", server: "${server}", device: ${device}`);
    }
    // LID addresses get _1 suffix for Signal protocol
    const signalUser = server === 'lid' ? `${user}_1` : user;
    const finalDevice = device || 0;
    return new libsignal.ProtocolAddress(signalUser, finalDevice);
};
const jidToSignalSenderKeyName = (group, user) => {
    return new SenderKeyName(group, jidToSignalProtocolAddress(user));
};
function signalStorage({ creds, keys }, lidMapping) {
    // Shared function to resolve PN signal address to LID if mapping exists
    const resolveLIDSignalAddress = async (id) => {
        if (id.includes('.')) {
            const [deviceId, device] = id.split('.');
            const [user, domainType_] = deviceId.split('_');
            const domainType = parseInt(domainType_ || '0');
            if (domainType === WAJIDDomains.LID || domainType === WAJIDDomains.HOSTED_LID)
                return id;
            const pnJid = `${user}${device !== '0' ? `:${device}` : ''}@${domainType === WAJIDDomains.HOSTED ? 'hosted' : 's.whatsapp.net'}`;
            const lidForPN = await lidMapping.getLIDForPN(pnJid);
            if (lidForPN) {
                const lidAddr = jidToSignalProtocolAddress(lidForPN);
                return lidAddr.toString();
            }
        }
        return id;
    };
    return {
        loadSession: async (id) => {
            try {
                const wireJid = await resolveLIDSignalAddress(id);
                const { [wireJid]: sess } = await keys.get('session', [wireJid]);
                if (sess) {
                    return libsignal.SessionRecord.deserialize(sess);
                }
            }
            catch (e) {
                return null;
            }
            return null;
        },
        storeSession: async (id, session) => {
            const wireJid = await resolveLIDSignalAddress(id);
            await keys.set({ session: { [wireJid]: session.serialize() } });
        },
        isTrustedIdentity: () => {
            return true; // TOFU - Trust on First Use (same as WhatsApp Web)
        },
        loadIdentityKey: async (id) => {
            const wireJid = await resolveLIDSignalAddress(id);
            const { [wireJid]: key } = await keys.get('identity-key', [wireJid]);
            return key || undefined;
        },
        saveIdentity: async (id, identityKey) => {
            const wireJid = await resolveLIDSignalAddress(id);
            const { [wireJid]: existingKey } = await keys.get('identity-key', [wireJid]);
            const keysMatch = existingKey &&
                existingKey.length === identityKey.length &&
                existingKey.every((byte, i) => byte === identityKey[i]);
            if (existingKey && !keysMatch) {
                // Identity changed - clear session and update key
                await keys.set({
                    session: { [wireJid]: null },
                    'identity-key': { [wireJid]: identityKey }
                });
                return true;
            }
            if (!existingKey) {
                // New contact - Trust on First Use (TOFU)
                await keys.set({ 'identity-key': { [wireJid]: identityKey } });
                return true;
            }
            return false;
        },
        loadPreKey: async (id) => {
            const keyId = id.toString();
            const { [keyId]: key } = await keys.get('pre-key', [keyId]);
            if (key) {
                return {
                    privKey: Buffer.from(key.private),
                    pubKey: Buffer.from(key.public)
                };
            }
        },
        removePreKey: (id) => keys.set({ 'pre-key': { [id]: null } }),
        loadSignedPreKey: () => {
            const key = creds.signedPreKey;
            return {
                privKey: Buffer.from(key.keyPair.private),
                pubKey: Buffer.from(key.keyPair.public)
            };
        },
        loadSenderKey: async (senderKeyName) => {
            const keyId = senderKeyName.toString();
            const { [keyId]: key } = await keys.get('sender-key', [keyId]);
            if (key) {
                return SenderKeyRecord.deserialize(key);
            }
            return new SenderKeyRecord();
        },
        storeSenderKey: async (senderKeyName, key) => {
            const keyId = senderKeyName.toString();
            const serialized = JSON.stringify(key.serialize());
            await keys.set({ 'sender-key': { [keyId]: Buffer.from(serialized, 'utf-8') } });
        },
        getOurRegistrationId: () => creds.registrationId,
        getOurIdentity: () => {
            const { signedIdentityKey } = creds;
            return {
                privKey: Buffer.from(signedIdentityKey.private),
                pubKey: Buffer.from(generateSignalPubKey(signedIdentityKey.public))
            };
        }
    };
}
//# sourceMappingURL=libsignal.js.map