import type { SignalKeyStoreWithTransaction } from '../Types';
export declare class LIDMappingStore {
    private readonly keys;
    constructor(keys: SignalKeyStoreWithTransaction);
    /**
     * Store LID-PN mapping - USER LEVEL
     */
    storeLIDPNMapping(lid: string, pn: string): Promise<void>;
    /**
     * Get LID for PN - Returns device-specific LID based on user mapping
     */
    getLIDForPN(pn: string): Promise<string | null>;
    /**
     * Get PN for LID - USER LEVEL with device construction
     */
    getPNForLID(lid: string): Promise<string | null>;
}
