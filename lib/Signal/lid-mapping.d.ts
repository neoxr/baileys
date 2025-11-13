import type { SignalKeyStoreWithTransaction } from '../Types/index.js';
export declare class LIDMappingStore {
    private readonly mappingCache;
    private readonly keys;
    private onWhatsAppFunc?;
    constructor(keys: SignalKeyStoreWithTransaction, onWhatsAppFunc?: (...jids: string[]) => Promise<{
        jid: string;
        exists: boolean;
        lid: string;
    }[] | undefined>);
    /**
     * Store LID-PN mapping - USER LEVEL
     */
    storeLIDPNMappings(pairs: {
        lid: string;
        pn: string;
    }[]): Promise<void>;
    /**
     * Get LID for PN - Returns device-specific LID based on user mapping
     */
    getLIDForPN(pn: string): Promise<string | null>;
    /**
     * Get PN for LID - USER LEVEL with device construction
     */
    getPNForLID(lid: string): Promise<string | null>;
}
//# sourceMappingURL=lid-mapping.d.ts.map