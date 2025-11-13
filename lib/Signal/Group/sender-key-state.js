import { SenderChainKey } from './sender-chain-key.js';
import { SenderMessageKey } from './sender-message-key.js';
export class SenderKeyState {
    constructor(id, iteration, chainKey, signatureKeyPair, signatureKeyPublic, signatureKeyPrivate, senderKeyStateStructure) {
        this.MAX_MESSAGE_KEYS = 2000;
        const toBuffer = (val) => {
            if (!val)
                return Buffer.alloc(0);
            if (typeof val === 'string')
                return Buffer.from(val, 'base64');
            if (val instanceof Uint8Array || Array.isArray(val))
                return Buffer.from(val);
            return Buffer.alloc(0);
        };
        if (senderKeyStateStructure) {
            this.senderKeyStateStructure = {
                ...senderKeyStateStructure,
                senderMessageKeys: Array.isArray(senderKeyStateStructure.senderMessageKeys)
                    ? senderKeyStateStructure.senderMessageKeys
                    : []
            };
        }
        else {
            if (signatureKeyPair) {
                signatureKeyPublic = signatureKeyPair.public;
                signatureKeyPrivate = signatureKeyPair.private;
            }
            chainKey = typeof chainKey === 'string' ? Buffer.from(chainKey, 'base64') : chainKey;
            const senderChainKeyStructure = {
                iteration: iteration || 0,
                seed: chainKey ? toBuffer(chainKey) : Buffer.alloc(0)
            };
            const signingKeyStructure = {
                public: toBuffer(signatureKeyPublic),
                private: signatureKeyPrivate ? toBuffer(signatureKeyPrivate) : undefined
            };
            this.senderKeyStateStructure = {
                senderKeyId: id || 0,
                senderChainKey: senderChainKeyStructure,
                senderSigningKey: signingKeyStructure,
                senderMessageKeys: []
            };
        }
    }
    getKeyId() {
        return this.senderKeyStateStructure.senderKeyId;
    }
    getSenderChainKey() {
        return new SenderChainKey(this.senderKeyStateStructure.senderChainKey.iteration, this.senderKeyStateStructure.senderChainKey.seed);
    }
    setSenderChainKey(chainKey) {
        this.senderKeyStateStructure.senderChainKey = {
            iteration: chainKey.getIteration(),
            seed: chainKey.getSeed()
        };
    }
    getSigningKeyPublic() {
        let key = this.senderKeyStateStructure.senderSigningKey.public;
        // normalize into Buffer
        if (!Buffer.isBuffer(key)) {
            if (key instanceof Uint8Array) {
                key = Buffer.from(key);
            }
            else if (typeof key === 'string') {
                key = Buffer.from(key, 'base64');
            }
            else if (key && typeof key === 'object') {
                return Buffer.from(Object.values(key)); // temp fix // inspired by @MartinSchere 's #1741
            }
            else {
                key = Buffer.from(key || []);
            }
        }
        const publicKey = key;
        if (publicKey.length === 32) {
            const fixed = Buffer.alloc(33);
            fixed[0] = 0x05;
            publicKey.copy(fixed, 1);
            return fixed;
        }
        return publicKey;
    }
    getSigningKeyPrivate() {
        const privateKey = this.senderKeyStateStructure.senderSigningKey.private;
        if (!privateKey) {
            return undefined;
        }
        if (Buffer.isBuffer(privateKey)) {
            return privateKey;
        }
        else if (privateKey instanceof Uint8Array) {
            return Buffer.from(privateKey);
        }
        else if (privateKey && typeof privateKey === 'object') {
            return Buffer.from(Object.values(privateKey)); // temp fix // inspired by @MartinSchere 's #1741
        }
        else if (typeof privateKey === 'string') {
            return Buffer.from(privateKey, 'base64');
        }
        return Buffer.from(privateKey || []);
    }
    hasSenderMessageKey(iteration) {
        return this.senderKeyStateStructure.senderMessageKeys.some(key => key.iteration === iteration);
    }
    addSenderMessageKey(senderMessageKey) {
        this.senderKeyStateStructure.senderMessageKeys.push({
            iteration: senderMessageKey.getIteration(),
            seed: senderMessageKey.getSeed()
        });
        if (this.senderKeyStateStructure.senderMessageKeys.length > this.MAX_MESSAGE_KEYS) {
            this.senderKeyStateStructure.senderMessageKeys.shift();
        }
    }
    removeSenderMessageKey(iteration) {
        const index = this.senderKeyStateStructure.senderMessageKeys.findIndex(key => key.iteration === iteration);
        if (index !== -1) {
            const messageKey = this.senderKeyStateStructure.senderMessageKeys[index];
            this.senderKeyStateStructure.senderMessageKeys.splice(index, 1);
            return new SenderMessageKey(messageKey.iteration, messageKey.seed);
        }
        return null;
    }
    getStructure() {
        return this.senderKeyStateStructure;
    }
}
//# sourceMappingURL=sender-key-state.js.map