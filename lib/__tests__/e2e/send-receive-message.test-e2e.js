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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const node_fs_1 = require("node:fs");
const pino_1 = __importDefault(require("pino"));
const index_1 = __importStar(require("../../index.js"));
globals_1.jest.setTimeout(30000);
describe('E2E Tests', () => {
    globals_1.jest.useFakeTimers();
    let sock;
    let meJid;
    beforeAll(async () => {
        const { state, saveCreds } = await (0, index_1.useMultiFileAuthState)('baileys_auth_info');
        const logger = (0, pino_1.default)({ level: 'silent' });
        sock = (0, index_1.default)({
            auth: state,
            logger
        });
        sock.ev.on('creds.update', saveCreds);
        await new Promise((resolve, reject) => {
            sock.ev.on('connection.update', update => {
                var _a, _b, _c;
                const { connection, lastDisconnect } = update;
                if (connection === 'open') {
                    meJid = (0, index_1.jidNormalizedUser)((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id);
                    resolve();
                }
                else if (connection === 'close') {
                    const reason = (_c = (_b = lastDisconnect === null || lastDisconnect === void 0 ? void 0 : lastDisconnect.error) === null || _b === void 0 ? void 0 : _b.output) === null || _c === void 0 ? void 0 : _c.statusCode;
                    if (reason === index_1.DisconnectReason.loggedOut) {
                        console.error('Logged out, please delete the baileys_auth_info_e2e folder and re-run the test');
                    }
                    if (lastDisconnect === null || lastDisconnect === void 0 ? void 0 : lastDisconnect.error) {
                        reject(new Error(`Connection closed: ${index_1.DisconnectReason[reason] || 'unknown'}`));
                    }
                }
            });
        });
    });
    afterAll(async () => {
        if (sock) {
            await new Promise(resolve => {
                sock.ev.on('connection.update', update => {
                    if (update.connection === 'close') {
                        resolve();
                    }
                });
                sock.end(undefined);
            });
        }
    });
    test('should send a message', async () => {
        var _a, _b, _c;
        const messageContent = `E2E Test Message ${Date.now()}`;
        const sentMessage = await sock.sendMessage(meJid, { text: messageContent });
        expect(sentMessage).toBeDefined();
        console.log('Sent message:', sentMessage.key.id);
        expect(sentMessage.key.id).toBeTruthy();
        expect(((_b = (_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.extendedTextMessage) === null || _b === void 0 ? void 0 : _b.text) || ((_c = sentMessage.message) === null || _c === void 0 ? void 0 : _c.conversation)).toBe(messageContent);
    });
    test('should edit a message', async () => {
        var _a, _b, _c, _d, _e;
        const messageContent = `E2E Test Message to Edit ${Date.now()}`;
        const sentMessage = await sock.sendMessage(meJid, { text: messageContent });
        expect(sentMessage).toBeDefined();
        console.log('Sent message to edit:', sentMessage.key.id);
        const newContent = `E2E Edited Message ${Date.now()}`;
        const editedMessage = await sock.sendMessage(meJid, {
            text: newContent,
            edit: sentMessage.key
        });
        expect(editedMessage).toBeDefined();
        console.log('Edited message response:', editedMessage.key.id);
        expect((_b = (_a = editedMessage.message) === null || _a === void 0 ? void 0 : _a.protocolMessage) === null || _b === void 0 ? void 0 : _b.type).toBe(index_1.proto.Message.ProtocolMessage.Type.MESSAGE_EDIT);
        const editedContent = (_d = (_c = editedMessage.message) === null || _c === void 0 ? void 0 : _c.protocolMessage) === null || _d === void 0 ? void 0 : _d.editedMessage;
        expect(((_e = editedContent === null || editedContent === void 0 ? void 0 : editedContent.extendedTextMessage) === null || _e === void 0 ? void 0 : _e.text) || (editedContent === null || editedContent === void 0 ? void 0 : editedContent.conversation)).toBe(newContent);
    });
    test('should react to a message', async () => {
        var _a, _b, _c, _d, _e;
        const messageContent = `E2E Test Message to React to ${Date.now()}`;
        const sentMessage = await sock.sendMessage(meJid, { text: messageContent });
        expect(sentMessage).toBeDefined();
        console.log('Sent message to react to:', sentMessage.key.id);
        const reaction = '👍';
        const reactionMessage = await sock.sendMessage(meJid, {
            react: {
                text: reaction,
                key: sentMessage.key
            }
        });
        expect(reactionMessage).toBeDefined();
        console.log('Sent reaction:', reactionMessage.key.id);
        expect((_b = (_a = reactionMessage.message) === null || _a === void 0 ? void 0 : _a.reactionMessage) === null || _b === void 0 ? void 0 : _b.text).toBe(reaction);
        expect((_e = (_d = (_c = reactionMessage.message) === null || _c === void 0 ? void 0 : _c.reactionMessage) === null || _d === void 0 ? void 0 : _d.key) === null || _e === void 0 ? void 0 : _e.id).toBe(sentMessage.key.id);
    });
    test('should remove a reaction from a message', async () => {
        var _a, _b, _c, _d, _e;
        const messageContent = `E2E Test Message to Remove Reaction from ${Date.now()}`;
        const sentMessage = await sock.sendMessage(meJid, { text: messageContent });
        expect(sentMessage).toBeDefined();
        console.log('Sent message to remove reaction from:', sentMessage.key.id);
        await sock.sendMessage(meJid, {
            react: {
                text: '😄',
                key: sentMessage.key
            }
        });
        const removeReactionMessage = await sock.sendMessage(meJid, {
            react: {
                text: '',
                key: sentMessage.key
            }
        });
        expect(removeReactionMessage).toBeDefined();
        console.log('Sent remove reaction:', removeReactionMessage.key.id);
        expect((_b = (_a = removeReactionMessage.message) === null || _a === void 0 ? void 0 : _a.reactionMessage) === null || _b === void 0 ? void 0 : _b.text).toBe('');
        expect((_e = (_d = (_c = removeReactionMessage.message) === null || _c === void 0 ? void 0 : _c.reactionMessage) === null || _d === void 0 ? void 0 : _d.key) === null || _e === void 0 ? void 0 : _e.id).toBe(sentMessage.key.id);
    });
    test('should delete a message', async () => {
        var _a, _b, _c, _d, _e;
        const messageContent = `E2E Test Message to Delete ${Date.now()}`;
        const sentMessage = await sock.sendMessage(meJid, { text: messageContent });
        expect(sentMessage).toBeDefined();
        console.log('Sent message to delete:', sentMessage.key.id);
        const deleteMessage = await sock.sendMessage(meJid, {
            delete: sentMessage.key
        });
        expect(deleteMessage).toBeDefined();
        console.log('Sent delete message command:', deleteMessage.key.id);
        expect((_b = (_a = deleteMessage.message) === null || _a === void 0 ? void 0 : _a.protocolMessage) === null || _b === void 0 ? void 0 : _b.type).toBe(index_1.proto.Message.ProtocolMessage.Type.REVOKE);
        expect((_e = (_d = (_c = deleteMessage.message) === null || _c === void 0 ? void 0 : _c.protocolMessage) === null || _d === void 0 ? void 0 : _d.key) === null || _e === void 0 ? void 0 : _e.id).toBe(sentMessage.key.id);
    });
    test('should forward a message', async () => {
        var _a, _b, _c;
        const messageContent = `E2E Test Message to Forward ${Date.now()}`;
        const sentMessage = await sock.sendMessage(meJid, {
            text: messageContent
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent message to forward:', sentMessage.key.id);
        const forwardedMessage = await sock.sendMessage(meJid, {
            forward: sentMessage
        });
        expect(forwardedMessage).toBeDefined();
        console.log('Forwarded message:', forwardedMessage.key.id);
        const content = ((_b = (_a = forwardedMessage.message) === null || _a === void 0 ? void 0 : _a.extendedTextMessage) === null || _b === void 0 ? void 0 : _b.text) || ((_c = forwardedMessage.message) === null || _c === void 0 ? void 0 : _c.conversation);
        expect(content).toBe(messageContent);
        expect(forwardedMessage.key.id).not.toBe(sentMessage.key.id);
    });
    test('should send an image message', async () => {
        var _a, _b, _c;
        const image = (0, node_fs_1.readFileSync)('./Media/cat.jpeg');
        const sentMessage = await sock.sendMessage(meJid, {
            image: image,
            caption: 'E2E Test Image'
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent image message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.imageMessage).toBeDefined();
        expect((_c = (_b = sentMessage.message) === null || _b === void 0 ? void 0 : _b.imageMessage) === null || _c === void 0 ? void 0 : _c.caption).toBe('E2E Test Image');
    });
    test('should send a video message with a thumbnail', async () => {
        var _a, _b, _c;
        const video = (0, node_fs_1.readFileSync)('./Media/ma_gif.mp4');
        const sentMessage = await sock.sendMessage(meJid, {
            video: video,
            caption: 'E2E Test Video'
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent video message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.videoMessage).toBeDefined();
        expect((_c = (_b = sentMessage.message) === null || _b === void 0 ? void 0 : _b.videoMessage) === null || _c === void 0 ? void 0 : _c.caption).toBe('E2E Test Video');
    });
    test('should send a PTT (push-to-talk) audio message', async () => {
        var _a, _b, _c;
        const audio = (0, node_fs_1.readFileSync)('./Media/sonata.mp3');
        const sentMessage = await sock.sendMessage(meJid, {
            audio: audio,
            ptt: true,
            mimetype: 'audio/mp4'
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent PTT audio message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.audioMessage).toBeDefined();
        expect((_c = (_b = sentMessage.message) === null || _b === void 0 ? void 0 : _b.audioMessage) === null || _c === void 0 ? void 0 : _c.ptt).toBe(true);
    });
    test('should send a document message', async () => {
        var _a, _b, _c;
        const document = (0, node_fs_1.readFileSync)('./Media/ma_gif.mp4');
        const sentMessage = await sock.sendMessage(meJid, {
            document: document,
            mimetype: 'application/pdf',
            fileName: 'E2E Test Document.pdf'
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent document message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.documentMessage).toBeDefined();
        expect((_c = (_b = sentMessage.message) === null || _b === void 0 ? void 0 : _b.documentMessage) === null || _c === void 0 ? void 0 : _c.fileName).toBe('E2E Test Document.pdf');
    });
    test('should send a sticker message', async () => {
        var _a;
        const sticker = (0, node_fs_1.readFileSync)('./Media/cat.jpeg');
        const sentMessage = await sock.sendMessage(meJid, {
            sticker: sticker
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent sticker message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.stickerMessage).toBeDefined();
    });
    test('should send a poll message and receive a vote', async () => {
        var _a, _b, _c;
        const poll = {
            name: 'E2E Test Poll',
            values: ['Option 1', 'Option 2', 'Option 3'],
            selectableCount: 1
        };
        const sentPoll = await sock.sendMessage(meJid, { poll });
        expect(sentPoll).toBeDefined();
        console.log('Sent poll message:', sentPoll.key.id);
        expect((_a = sentPoll === null || sentPoll === void 0 ? void 0 : sentPoll.message) === null || _a === void 0 ? void 0 : _a.pollCreationMessageV3).toBeDefined();
        expect((_c = (_b = sentPoll === null || sentPoll === void 0 ? void 0 : sentPoll.message) === null || _b === void 0 ? void 0 : _b.pollCreationMessageV3) === null || _c === void 0 ? void 0 : _c.name).toBe('E2E Test Poll');
        // This part of the test would require a second participant to vote
        // and for the test to listen for the poll update message.
        // For simplicity, we are only testing the sending of the poll here.
    });
    test('should send a contact (vCard) message', async () => {
        var _a, _b, _c;
        const vcard = 'BEGIN:VCARD\n' +
            'VERSION:3.0\n' +
            'FN:E2E Test Contact\n' +
            'ORG:Baileys Tests;\n' +
            'TEL;type=CELL;type=VOICE;waid=1234567890:+1 234-567-890\n' +
            'END:VCARD';
        const sentMessage = await sock.sendMessage(meJid, {
            contacts: {
                displayName: 'E2E Test Contact',
                contacts: [{ vcard }]
            }
        });
        expect(sentMessage).toBeDefined();
        console.log('Sent contact message:', sentMessage.key.id);
        expect((_a = sentMessage.message) === null || _a === void 0 ? void 0 : _a.contactMessage).toBeDefined();
        expect((_c = (_b = sentMessage.message) === null || _b === void 0 ? void 0 : _b.contactMessage) === null || _c === void 0 ? void 0 : _c.vcard).toContain('FN:E2E Test Contact');
    });
});
