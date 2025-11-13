"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const __1 = require("../../index.js");
const Defaults_1 = require("../../Defaults/index.js");
const Socket_1 = __importDefault(require("../../Socket/index.js"));
const session_1 = require("../TestUtils/session.js");
(0, session_1.mockWebSocket)();
describe('Connection Deadlock Test', () => {
    it('should not deadlock when history sync is disabled', async () => {
        const { state, clear } = await (0, session_1.makeSession)();
        state.creds.me = { id: '1234567890:1@s.whatsapp.net', name: 'Test User' };
        const sock = (0, Socket_1.default)({
            ...Defaults_1.DEFAULT_CONNECTION_CONFIG,
            auth: state,
            shouldSyncHistoryMessage: () => false
        });
        const regularMessageListener = globals_1.jest.fn();
        sock.ev.on('messages.upsert', regularMessageListener);
        // 1. Simulate receiving pending notifications. This activates the buffer.
        sock.ev.emit('connection.update', { receivedPendingNotifications: true });
        // 2. Now, emit a regular message. Because the previous step should have
        // flushed the buffer, this message should be processed immediately.
        const regularMessage = __1.proto.WebMessageInfo.create({
            key: { remoteJid: '1234567890@s.whatsapp.net', fromMe: false, id: 'REGULAR_MSG_1' },
            messageTimestamp: Date.now() / 1000,
            message: { conversation: 'Hello, world!' }
        });
        sock.ev.emit('messages.upsert', { messages: [regularMessage], type: 'notify' });
        // Wait for the event loop to process any final events.
        await new Promise(resolve => setTimeout(resolve, 50));
        // 3. Check if the regular message listener was called.
        expect(regularMessageListener).toHaveBeenCalledTimes(1);
        expect(regularMessageListener).toHaveBeenCalledWith(expect.objectContaining({
            messages: expect.arrayContaining([
                expect.objectContaining({
                    key: regularMessage.key
                })
            ]),
            type: 'notify'
        }));
        sock.end(new Error('Test completed'));
        await clear();
    });
});
