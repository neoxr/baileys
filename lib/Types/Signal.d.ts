import { proto } from '../../WAProto';
import type { LIDMappingStore } from '../Signal/lid-mapping';
type DecryptGroupSignalOpts = {
    group: string;
    authorJid: string;
    msg: Uint8Array;
};
type ProcessSenderKeyDistributionMessageOpts = {
    item: proto.Message.ISenderKeyDistributionMessage;
    authorJid: string;
};
type DecryptSignalProtoOpts = {
    jid: string;
    type: 'pkmsg' | 'msg';
    ciphertext: Uint8Array;
};
type EncryptMessageOpts = {
    jid: string;
    data: Uint8Array;
};
type EncryptGroupMessageOpts = {
    group: string;
    data: Uint8Array;
    meId: string;
};
type PreKey = {
    keyId: number;
    publicKey: Uint8Array;
};
type SignedPreKey = PreKey & {
    signature: Uint8Array;
};
type E2ESession = {
    registrationId: number;
    identityKey: Uint8Array;
    signedPreKey: SignedPreKey;
    preKey: PreKey;
};
type E2ESessionOpts = {
    jid: string;
    session: E2ESession;
};
type EncryptMessageWithWireOpts = {
    encryptionJid: string;
    wireJid: string;
    data: Uint8Array;
};
export type SignalRepository = {
    deleteSession(jid: string): unknown;
    migrateSession(fromJid: string, toJid: string): Promise<void>;
    decryptGroupMessage(opts: DecryptGroupSignalOpts): Promise<Uint8Array>;
    processSenderKeyDistributionMessage(opts: ProcessSenderKeyDistributionMessageOpts): Promise<void>;
    encryptMessageWithWire(opts: EncryptMessageWithWireOpts): Promise<{
        type: 'pkmsg' | 'msg';
        ciphertext: Uint8Array;
        wireJid: string;
    }>;
    decryptMessage(opts: DecryptSignalProtoOpts): Promise<Uint8Array>;
    encryptMessage(opts: EncryptMessageOpts): Promise<{
        type: 'pkmsg' | 'msg';
        ciphertext: Uint8Array;
    }>;
    encryptGroupMessage(opts: EncryptGroupMessageOpts): Promise<{
        senderKeyDistributionMessage: Uint8Array;
        ciphertext: Uint8Array;
    }>;
    storeLIDPNMapping(lid: string, pn: string): Promise<void>;
    getLIDMappingStore(): LIDMappingStore;
    injectE2ESession(opts: E2ESessionOpts): Promise<void>;
    jidToSignalProtocolAddress(jid: string): string;
    validateSession(jid: string): Promise<{
        exists: boolean;
        reason?: string;
    }>;
    destroy(): void;
};
export {};
