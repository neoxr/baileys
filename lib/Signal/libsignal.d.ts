import type { SignalAuthState } from '../Types';
import type { SignalRepositoryWithLIDStore } from '../Types/Signal';
export declare function makeLibSignalRepository(auth: SignalAuthState, onWhatsAppFunc?: (...jids: string[]) => Promise<{
    jid: string;
    exists: boolean;
    lid: string;
}[] | undefined>): SignalRepositoryWithLIDStore;
