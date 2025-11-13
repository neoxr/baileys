import type { SignalAuthState } from '../Types/index.js';
import type { SignalRepositoryWithLIDStore } from '../Types/Signal.js';
export declare function makeLibSignalRepository(auth: SignalAuthState, onWhatsAppFunc?: (...jids: string[]) => Promise<{
    jid: string;
    exists: boolean;
    lid: string;
}[] | undefined>): SignalRepositoryWithLIDStore;
//# sourceMappingURL=libsignal.d.ts.map