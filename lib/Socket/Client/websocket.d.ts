import WebSocket from 'ws';
import { AbstractSocketClient } from './types.js';
export declare class WebSocketClient extends AbstractSocketClient {
    protected socket: WebSocket | null;
    /**
     * CONNECTION STABILITY: Store references to the event forwarding
     * functions so they can be removed from the native WebSocket when
     * the connection closes. Without this, the native socket holds
     * references to `this.emit` which prevents GC of the client and
     * all objects it references.
     */
    private socketListeners;
    get isOpen(): boolean;
    get isClosed(): boolean;
    get isClosing(): boolean;
    get isConnecting(): boolean;
    connect(): void;
    close(): Promise<void>;
    send(str: string | Uint8Array, cb?: (err?: Error) => void): boolean;
}
//# sourceMappingURL=websocket.d.ts.map