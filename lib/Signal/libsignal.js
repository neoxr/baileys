"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeLibSignalRepository = makeLibSignalRepository;
/* @ts-ignore */
const libsignal = __importStar(require("libsignal"));
const Utils_1 = require("../Utils");
const WABinary_1 = require("../WABinary");
const sender_key_name_1 = require("./Group/sender-key-name");
const sender_key_record_1 = require("./Group/sender-key-record");
const Group_1 = require("./Group");
const lid_mapping_1 = require("./lid-mapping");
function makeLibSignalRepository(auth, onWhatsAppFunc) {
    const lidMapping = new lid_mapping_1.LIDMappingStore(auth.keys, onWhatsAppFunc);
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
            const cipher = new Group_1.GroupCipher(storage, senderName);
            // Use transaction to ensure atomicity
            return parsedKeys.transaction(async () => {
                return cipher.decrypt(msg);
            }, group);
        },
        async processSenderKeyDistributionMessage({ item, authorJid }) {
            const builder = new Group_1.GroupSessionBuilder(storage);
            if (!item.groupId) {
                throw new Error('Group ID is required for sender key distribution message');
            }
            const senderName = jidToSignalSenderKeyName(item.groupId, authorJid);
            const senderMsg = new Group_1.SenderKeyDistributionMessage(null, null, null, null, item.axolotlSenderKeyDistributionMessage);
            const senderNameStr = senderName.toString();
            const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr]);
            if (!senderKey) {
                await storage.storeSenderKey(senderName, new sender_key_record_1.SenderKeyRecord());
            }
            return parsedKeys.transaction(async () => {
                const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr]);
                if (!senderKey) {
                    await storage.storeSenderKey(senderName, new sender_key_record_1.SenderKeyRecord());
                }
                await builder.process(senderName, senderMsg);
            }, item.groupId);
        },
        async decryptMessage({ jid, type, ciphertext }) {
            const addr = jidToSignalProtocolAddress(jid);
            const session = new libsignal.SessionCipher(storage, addr);
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
                if (lidForPN === null || lidForPN === void 0 ? void 0 : lidForPN.includes('@lid')) {
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
            const builder = new Group_1.GroupSessionBuilder(storage);
            const senderNameStr = senderName.toString();
            return parsedKeys.transaction(async () => {
                const { [senderNameStr]: senderKey } = await auth.keys.get('sender-key', [senderNameStr]);
                if (!senderKey) {
                    await storage.storeSenderKey(senderName, new sender_key_record_1.SenderKeyRecord());
                }
                const senderKeyDistributionMessage = await builder.create(senderName);
                const session = new Group_1.GroupCipher(storage, senderName);
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
            var _a;
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
                    lid: (0, WABinary_1.transferDevice)(jid, toJid),
                    pn: jid
                }));
                await lidMapping.storeLIDPNMappings(mappings);
                // 2. Prepare migration operations
                const migrationOps = validJids.map(jid => {
                    const lidWithDevice = (0, WABinary_1.transferDevice)(jid, toJid);
                    const fromDecoded = (0, WABinary_1.jidDecode)(jid);
                    const toDecoded = (0, WABinary_1.jidDecode)(lidWithDevice);
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
                    if (fromSession === null || fromSession === void 0 ? void 0 : fromSession.haveOpenSession()) {
                        // Copy session to LID address
                        const sessionBytes = fromSession.serialize();
                        const copiedSession = libsignal.SessionRecord.deserialize(sessionBytes);
                        await storage.storeSession(op.toAddr.toString(), copiedSession);
                        // Delete PN session
                        await auth.keys.set({ session: { [op.fromAddr.toString()]: null } });
                    }
                }));
                return { migrated: opsToMigrate.length, skipped: skippedCount, total: validJids.length };
            }, `migrate-${validJids.length}-sessions-${(_a = (0, WABinary_1.jidDecode)(toJid)) === null || _a === void 0 ? void 0 : _a.user}`);
        },
        async encryptMessageWithWire({ encryptionJid, wireJid, data }) {
            const result = await repository.encryptMessage({ jid: encryptionJid, data });
            return { ...result, wireJid };
        }
    };
    return repository;
}
const jidToSignalProtocolAddress = (jid) => {
    const decoded = (0, WABinary_1.jidDecode)(jid);
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
    return new sender_key_name_1.SenderKeyName(group, jidToSignalProtocolAddress(user));
};
function signalStorage({ creds, keys }, lidMapping) {
    return {
        loadSession: async (id) => {
            try {
                // LID SINGLE SOURCE OF TRUTH: Auto-redirect PN to LID if mapping exists
                let actualId = id;
                if (id.includes('.') && !id.includes('_1')) {
                    // This is a PN signal address format (e.g., "1234567890.0")
                    // Convert back to JID to check for LID mapping
                    const parts = id.split('.');
                    const device = parts[1] || '0';
                    const pnJid = device === '0' ? `${parts[0]}@s.whatsapp.net` : `${parts[0]}:${device}@s.whatsapp.net`;
                    const lidForPN = await lidMapping.getLIDForPN(pnJid);
                    if (lidForPN === null || lidForPN === void 0 ? void 0 : lidForPN.includes('@lid')) {
                        const lidAddr = jidToSignalProtocolAddress(lidForPN);
                        const lidId = lidAddr.toString();
                        // Check if LID session exists
                        const { [lidId]: lidSession } = await keys.get('session', [lidId]);
                        if (lidSession) {
                            actualId = lidId;
                        }
                    }
                }
                const { [actualId]: sess } = await keys.get('session', [actualId]);
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
            await keys.set({ session: { [id]: session.serialize() } });
        },
        isTrustedIdentity: () => {
            return true;
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
                return sender_key_record_1.SenderKeyRecord.deserialize(key);
            }
            return new sender_key_record_1.SenderKeyRecord();
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
                pubKey: Buffer.from((0, Utils_1.generateSignalPubKey)(signedIdentityKey.public))
            };
        }
    };
}
