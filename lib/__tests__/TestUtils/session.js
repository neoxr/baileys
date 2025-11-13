"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockWebSocket = exports.makeSession = void 0;
const globals_1 = require("@jest/globals");
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const __1 = require("../../index.js");
/**
 * Creates a temporary, isolated authentication state for tests.
 * This prevents tests from interfering with each other or with a real session.
 * @returns An object with the authentication state and a cleanup function.
 */
const makeSession = async () => {
    // Create a temporary directory for the session files
    const dir = (0, path_1.join)((0, os_1.tmpdir)(), `baileys-test-session-${Date.now()}`);
    await fs_1.promises.mkdir(dir, { recursive: true });
    // Use the multi-file auth state with the temporary directory
    const { state, saveCreds } = await (0, __1.useMultiFileAuthState)(dir);
    return {
        state,
        saveCreds,
        /**
         * Cleans up the temporary session files.
         * Call this at the end of your test.
         */
        clear: async () => {
            await fs_1.promises.rm(dir, { recursive: true, force: true });
        }
    };
};
exports.makeSession = makeSession;
const mockWebSocket = () => {
    globals_1.jest.mock('../../Socket/Client/websocket', () => {
        return {
            WebSocketClient: globals_1.jest.fn().mockImplementation(() => ({
                connect: globals_1.jest.fn(() => Promise.resolve()),
                close: globals_1.jest.fn(),
                on: globals_1.jest.fn(),
                off: globals_1.jest.fn(),
                emit: globals_1.jest.fn(),
                send: globals_1.jest.fn(),
                isOpen: true
            }))
        };
    });
};
exports.mockWebSocket = mockWebSocket;
