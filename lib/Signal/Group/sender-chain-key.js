"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SenderChainKey = void 0;
const crypto_1 = require("libsignal/src/crypto");
const sender_message_key_1 = require("./sender-message-key");
class SenderChainKey {
    constructor(iteration, chainKey) {
        this.MESSAGE_KEY_SEED = Buffer.from([0x01]);
        this.CHAIN_KEY_SEED = Buffer.from([0x02]);
        this.iteration = iteration;
        if (Buffer.isBuffer(chainKey)) {
            this.chainKey = chainKey;
        }
        else if (chainKey instanceof Uint8Array) {
            this.chainKey = Buffer.from(chainKey);
        }
        else if (chainKey && typeof chainKey === 'object') {
            // backported from @MartinSchere (#1741)
            this.chainKey = Buffer.from(Object.values(chainKey)); // temp fix // backported from @MartinSchere (#1741)
        }
        else {
            this.chainKey = Buffer.alloc(0);
        }
    }
    getIteration() {
        return this.iteration;
    }
    getSenderMessageKey() {
        return new sender_message_key_1.SenderMessageKey(this.iteration, this.getDerivative(this.MESSAGE_KEY_SEED, this.chainKey));
    }
    getNext() {
        return new SenderChainKey(this.iteration + 1, this.getDerivative(this.CHAIN_KEY_SEED, this.chainKey));
    }
    getSeed() {
        return this.chainKey;
    }
    getDerivative(seed, key) {
        return (0, crypto_1.calculateMAC)(key, seed);
    }
}
exports.SenderChainKey = SenderChainKey;
