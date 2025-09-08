"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIDMappingStore = void 0;
const logger_1 = __importDefault(require("../Utils/logger"));
const WABinary_1 = require("../WABinary");
class LIDMappingStore {
    constructor(keys) {
        this.keys = keys;
    }
    /**
     * Store LID-PN mapping - USER LEVEL
     */
    async storeLIDPNMapping(lid, pn) {
        // Validate inputs
        if (!(((0, WABinary_1.isLidUser)(lid) && (0, WABinary_1.isJidUser)(pn)) || ((0, WABinary_1.isJidUser)(lid) && (0, WABinary_1.isLidUser)(pn)))) {
            logger_1.default.warn(`Invalid LID-PN mapping: ${lid}, ${pn}`);
            return;
        }
        const [lidJid, pnJid] = (0, WABinary_1.isLidUser)(lid) ? [lid, pn] : [pn, lid];
        const lidDecoded = (0, WABinary_1.jidDecode)(lidJid);
        const pnDecoded = (0, WABinary_1.jidDecode)(pnJid);
        if (!lidDecoded || !pnDecoded)
            return;
        const pnUser = pnDecoded.user;
        const lidUser = lidDecoded.user;
        logger_1.default.trace(`Storing USER LID mapping: PN ${pnUser} → LID ${lidUser}`);
        await this.keys.transaction(async () => {
            await this.keys.set({
                'lid-mapping': {
                    [pnUser]: lidUser, // "554396160286" -> "102765716062358"
                    [`${lidUser}_reverse`]: pnUser // "102765716062358_reverse" -> "554396160286"
                }
            });
        });
        logger_1.default.trace(`USER LID mapping stored: PN ${pnUser} → LID ${lidUser}`);
    }
    /**
     * Get LID for PN - Returns device-specific LID based on user mapping
     */
    async getLIDForPN(pn) {
        if (!(0, WABinary_1.isJidUser)(pn))
            return null;
        const decoded = (0, WABinary_1.jidDecode)(pn);
        if (!decoded)
            return null;
        // Look up user-level mapping (whatsmeow approach)
        const pnUser = decoded.user;
        const stored = await this.keys.get('lid-mapping', [pnUser]);
        const lidUser = stored[pnUser];
        if (!lidUser) {
            logger_1.default.trace(`No LID mapping found for PN user ${pnUser}`);
            return null;
        }
        if (typeof lidUser !== 'string')
            return null;
        // Push the PN device ID to the LID to maintain device separation
        const pnDevice = decoded.device !== undefined ? decoded.device : 0;
        const deviceSpecificLid = `${lidUser}:${pnDevice}@lid`;
        logger_1.default.trace(`getLIDForPN: ${pn} → ${deviceSpecificLid} (user mapping with device ${pnDevice})`);
        return deviceSpecificLid;
    }
    /**
     * Get PN for LID - USER LEVEL with device construction
     */
    async getPNForLID(lid) {
        if (!(0, WABinary_1.isLidUser)(lid))
            return null;
        const decoded = (0, WABinary_1.jidDecode)(lid);
        if (!decoded)
            return null;
        // Look up reverse user mapping
        const lidUser = decoded.user;
        const stored = await this.keys.get('lid-mapping', [`${lidUser}_reverse`]);
        const pnUser = stored[`${lidUser}_reverse`];
        if (!pnUser || typeof pnUser !== 'string') {
            logger_1.default.trace(`No reverse mapping found for LID user: ${lidUser}`);
            return null;
        }
        // Construct device-specific PN JID
        const lidDevice = decoded.device !== undefined ? decoded.device : 0;
        const pnJid = `${pnUser}:${lidDevice}@s.whatsapp.net`;
        logger_1.default.trace(`Found reverse mapping: ${lid} → ${pnJid}`);
        return pnJid;
    }
}
exports.LIDMappingStore = LIDMappingStore;
