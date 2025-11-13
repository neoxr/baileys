/**
 * Creates a temporary, isolated authentication state for tests.
 * This prevents tests from interfering with each other or with a real session.
 * @returns An object with the authentication state and a cleanup function.
 */
export declare const makeSession: () => Promise<{
    state: import("../../index.js").AuthenticationState;
    saveCreds: () => Promise<void>;
    /**
     * Cleans up the temporary session files.
     * Call this at the end of your test.
     */
    clear: () => Promise<void>;
}>;
export declare const mockWebSocket: () => void;
