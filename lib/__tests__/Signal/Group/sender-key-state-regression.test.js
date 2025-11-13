"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sender_key_state_1 = require("../../../Signal/Group/sender-key-state.js");
const sender_message_key_1 = require("../../../Signal/Group/sender-message-key.js");
describe('SenderKeyState regression: missing senderMessageKeys array', () => {
    it('should initialize senderMessageKeys when absent in provided structure', () => {
        var _a;
        const legacyStructure = {
            senderKeyId: 42,
            senderChainKey: { iteration: 0, seed: Buffer.from([1, 2, 3]) },
            senderSigningKey: { public: Buffer.from([4, 5, 6]) }
        };
        const state = new sender_key_state_1.SenderKeyState(null, null, null, null, null, null, legacyStructure);
        const msgKey = new sender_message_key_1.SenderMessageKey(0, Buffer.from([7, 8, 9]));
        state.addSenderMessageKey(msgKey);
        const structure = state.getStructure();
        expect(structure.senderMessageKeys).toBeDefined();
        expect(Array.isArray(structure.senderMessageKeys)).toBe(true);
        expect(structure.senderMessageKeys.length).toBe(1);
        expect((_a = structure.senderMessageKeys[0]) === null || _a === void 0 ? void 0 : _a.iteration).toBe(0);
    });
});
