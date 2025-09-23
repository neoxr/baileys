"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeMessagesSocket = void 0;
const node_cache_1 = __importDefault(require("@cacheable/node-cache"));
const boom_1 = require("@hapi/boom");
const index_js_1 = require("../../WAProto/index.js");
const Defaults_1 = require("../Defaults");
const Types_1 = require("../Types");
const Utils_1 = require("../Utils");
const link_preview_1 = require("../Utils/link-preview");
const make_mutex_1 = require("../Utils/make-mutex");
const WABinary_1 = require("../WABinary");
const WAUSync_1 = require("../WAUSync");
const newsletter_1 = require("./newsletter");
const makeMessagesSocket = (config) => {
    const { logger, linkPreviewImageThumbnailWidth, generateHighQualityLinkPreview, options: axiosOptions, patchMessageBeforeSending, cachedGroupMetadata, enableRecentMessageCache, maxMsgRetryCount } = config;
    const sock = (0, newsletter_1.makeNewsletterSocket)(config);
    const { ev, authState, processingMutex, signalRepository, upsertMessage, query, fetchPrivacySettings, sendNode, groupMetadata, groupToggleEphemeral } = sock;
    const userDevicesCache = config.userDevicesCache ||
        new node_cache_1.default({
            stdTTL: Defaults_1.DEFAULT_CACHE_TTLS.USER_DEVICES, // 5 minutes
            useClones: false
        });
    // Initialize message retry manager if enabled
    const messageRetryManager = enableRecentMessageCache ? new Utils_1.MessageRetryManager(logger, maxMsgRetryCount) : null;
    // Prevent race conditions in Signal session encryption by user
    const encryptionMutex = (0, make_mutex_1.makeKeyedMutex)();
    let mediaConn;
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn;
        if (!media || forceGet || new Date().getTime() - media.fetchDate.getTime() > media.ttl * 1000) {
            mediaConn = (async () => {
                const result = await query({
                    tag: 'iq',
                    attrs: {
                        type: 'set',
                        xmlns: 'w:m',
                        to: WABinary_1.S_WHATSAPP_NET
                    },
                    content: [{ tag: 'media_conn', attrs: {} }]
                });
                const mediaConnNode = (0, WABinary_1.getBinaryNodeChild)(result, 'media_conn');
                const node = {
                    hosts: (0, WABinary_1.getBinaryNodeChildren)(mediaConnNode, 'host').map(({ attrs }) => ({
                        hostname: attrs.hostname,
                        maxContentLengthBytes: +attrs.maxContentLengthBytes
                    })),
                    auth: mediaConnNode.attrs.auth,
                    ttl: +mediaConnNode.attrs.ttl,
                    fetchDate: new Date()
                };
                logger.debug('fetched media conn');
                return node;
            })();
        }
        return mediaConn;
    };
    /**
     * generic send receipt function
     * used for receipts of phone call, read, delivery etc.
     * */
    const sendReceipt = async (jid, participant, messageIds, type) => {
        if (!messageIds || messageIds.length === 0) {
            throw new boom_1.Boom('missing ids in receipt');
        }
        const node = {
            tag: 'receipt',
            attrs: {
                id: messageIds[0]
            }
        };
        const isReadReceipt = type === 'read' || type === 'read-self';
        if (isReadReceipt) {
            node.attrs.t = (0, Utils_1.unixTimestampSeconds)().toString();
        }
        if (type === 'sender' && (0, WABinary_1.isPnUser)(jid)) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        }
        else {
            node.attrs.to = jid;
            if (participant) {
                node.attrs.participant = participant;
            }
        }
        if (type) {
            node.attrs.type = type;
        }
        const remainingMessageIds = messageIds.slice(1);
        if (remainingMessageIds.length) {
            node.content = [
                {
                    tag: 'list',
                    attrs: {},
                    content: remainingMessageIds.map(id => ({
                        tag: 'item',
                        attrs: { id }
                    }))
                }
            ];
        }
        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages');
        await sendNode(node);
    };
    /** Correctly bulk send receipts to multiple chats, participants */
    const sendReceipts = async (keys, type) => {
        const recps = (0, Utils_1.aggregateMessageKeysNotFromMe)(keys);
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };
    /** Bulk read messages. Keys can be from different chats & participants */
    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings();
        // based on privacy settings, we have to change the read type
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self';
        await sendReceipts(keys, readType);
    };
    /**
     * Deduplicate JIDs when both LID and PN versions exist for same user
     * Prefers LID over PN to maintain single encryption layer
     */
    const deduplicateLidPnJids = (jids) => {
        var _a, _b;
        const lidUsers = new Set();
        const filteredJids = [];
        // Collect all LID users
        for (const jid of jids) {
            if (jid.includes('@lid')) {
                const user = (_a = (0, WABinary_1.jidDecode)(jid)) === null || _a === void 0 ? void 0 : _a.user;
                if (user)
                    lidUsers.add(user);
            }
        }
        // Filter out PN versions when LID exists
        for (const jid of jids) {
            if (jid.includes('@s.whatsapp.net')) {
                const user = (_b = (0, WABinary_1.jidDecode)(jid)) === null || _b === void 0 ? void 0 : _b.user;
                if (user && lidUsers.has(user)) {
                    logger.debug({ jid }, 'Skipping PN - LID version exists');
                    continue;
                }
            }
            filteredJids.push(jid);
        }
        return filteredJids;
    };
    /** Fetch all the devices we've to send a message to */
    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        var _a, _b;
        const deviceResults = [];
        if (!useCache) {
            logger.debug('not using cache for devices');
        }
        const toFetch = [];
        jids = deduplicateLidPnJids(Array.from(new Set(jids)));
        const jidsWithUser = jids
            .map(jid => {
            const decoded = (0, WABinary_1.jidDecode)(jid);
            const user = decoded === null || decoded === void 0 ? void 0 : decoded.user;
            const device = decoded === null || decoded === void 0 ? void 0 : decoded.device;
            const isExplicitDevice = typeof device === 'number' && device >= 0;
            if (isExplicitDevice && user) {
                deviceResults.push({
                    user,
                    device,
                    wireJid: jid // again this makes no sense
                });
                return null;
            }
            jid = (0, WABinary_1.jidNormalizedUser)(jid);
            return { jid, user };
        })
            .filter(jid => jid !== null);
        let mgetDevices;
        if (useCache && userDevicesCache.mget) {
            const usersToFetch = jidsWithUser.map(j => j === null || j === void 0 ? void 0 : j.user).filter(Boolean);
            mgetDevices = await userDevicesCache.mget(usersToFetch);
        }
        for (const { jid, user } of jidsWithUser) {
            if (useCache) {
                const devices = (mgetDevices === null || mgetDevices === void 0 ? void 0 : mgetDevices[user]) ||
                    (userDevicesCache.mget ? undefined : (await userDevicesCache.get(user)));
                if (devices) {
                    const isLidJid = jid.includes('@lid');
                    const devicesWithWire = devices.map(d => ({
                        ...d,
                        wireJid: isLidJid ? (0, WABinary_1.jidEncode)(d.user, 'lid', d.device) : (0, WABinary_1.jidEncode)(d.user, 's.whatsapp.net', d.device)
                    }));
                    deviceResults.push(...devicesWithWire);
                    logger.trace({ user }, 'using cache for devices');
                }
                else {
                    toFetch.push(jid);
                }
            }
            else {
                toFetch.push(jid);
            }
        }
        if (!toFetch.length) {
            return deviceResults;
        }
        const requestedLidUsers = new Set();
        for (const jid of toFetch) {
            if (jid.includes('@lid')) {
                const user = (_a = (0, WABinary_1.jidDecode)(jid)) === null || _a === void 0 ? void 0 : _a.user;
                if (user)
                    requestedLidUsers.add(user);
            }
        }
        const query = new WAUSync_1.USyncQuery().withContext('message').withDeviceProtocol();
        for (const jid of toFetch) {
            query.withUser(new WAUSync_1.USyncUser().withId(jid)); // todo: investigate - the idea here is that <user> should have an inline lid field with the lid being the pn equivalent
        }
        const result = await sock.executeUSyncQuery(query);
        if (result) {
            const extracted = (0, Utils_1.extractDeviceJids)(result === null || result === void 0 ? void 0 : result.list, authState.creds.me.id, ignoreZeroDevices);
            const deviceMap = {};
            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || [];
                (_b = deviceMap[item.user]) === null || _b === void 0 ? void 0 : _b.push(item);
            }
            // Process each user's devices as a group for bulk LID migration
            for (const [user, userDevices] of Object.entries(deviceMap)) {
                const isLidUser = requestedLidUsers.has(user);
                // Process all devices for this user
                for (const item of userDevices) {
                    const finalWireJid = isLidUser
                        ? (0, WABinary_1.jidEncode)(user, 'lid', item.device)
                        : (0, WABinary_1.jidEncode)(item.user, 's.whatsapp.net', item.device);
                    deviceResults.push({
                        ...item,
                        wireJid: finalWireJid
                    });
                    logger.debug({
                        user: item.user,
                        device: item.device,
                        finalWireJid,
                        usedLid: isLidUser
                    }, 'Processed device with LID priority');
                }
            }
            if (userDevicesCache.mset) {
                // if the cache supports mset, we can set all devices in one go
                await userDevicesCache.mset(Object.entries(deviceMap).map(([key, value]) => ({ key, value })));
            }
            else {
                for (const key in deviceMap) {
                    if (deviceMap[key])
                        await userDevicesCache.set(key, deviceMap[key]);
                }
            }
        }
        return deviceResults;
    };
    const assertSessions = async (jids, force) => {
        var _a;
        let didFetchNewSession = false;
        const jidsRequiringFetch = [];
        // Apply same deduplication as in getUSyncDevices
        jids = deduplicateLidPnJids(jids);
        if (force) {
            // Check which sessions are missing (with LID migration check)
            const addrs = jids.map(jid => signalRepository.jidToSignalProtocolAddress(jid));
            const sessions = await authState.keys.get('session', addrs);
            // Simplified: Check session existence directly
            const checkJidSession = (jid) => {
                const signalId = signalRepository.jidToSignalProtocolAddress(jid);
                const hasSession = !!sessions[signalId];
                // Add to fetch list if no session exists
                // Session type selection (LID vs PN) is handled in encryptMessage
                if (!hasSession) {
                    if (jid.includes('@lid')) {
                        logger.debug({ jid }, 'No LID session found, will create new LID session');
                    }
                    jidsRequiringFetch.push(jid);
                }
            };
            // Process all JIDs
            for (const jid of jids) {
                checkJidSession(jid);
            }
        }
        else {
            const addrs = jids.map(jid => signalRepository.jidToSignalProtocolAddress(jid));
            const sessions = await authState.keys.get('session', addrs);
            // Group JIDs by user for bulk migration
            const userGroups = new Map();
            for (const jid of jids) {
                const user = (0, WABinary_1.jidNormalizedUser)(jid);
                if (!userGroups.has(user)) {
                    userGroups.set(user, []);
                }
                userGroups.get(user).push(jid);
            }
            // Helper to check LID mapping for a user
            const checkUserLidMapping = async (user, userJids) => {
                if (!userJids.some(jid => jid.includes('@s.whatsapp.net'))) {
                    return { shouldMigrate: false, lidForPN: undefined };
                }
                try {
                    // Convert user to proper PN JID format for getLIDForPN
                    const pnJid = `${user}@s.whatsapp.net`;
                    const mapping = await signalRepository.lidMapping.getLIDForPN(pnJid);
                    if (mapping === null || mapping === void 0 ? void 0 : mapping.includes('@lid')) {
                        logger.debug({ user, lidForPN: mapping, deviceCount: userJids.length }, 'User has LID mapping - preparing bulk migration');
                        return { shouldMigrate: true, lidForPN: mapping };
                    }
                }
                catch (error) {
                    logger.debug({ user, error }, 'Failed to check LID mapping for user');
                }
                return { shouldMigrate: false, lidForPN: undefined };
            };
            // Process each user group for potential bulk LID migration
            for (const [user, userJids] of userGroups) {
                const mappingResult = await checkUserLidMapping(user, userJids);
                const shouldMigrateUser = mappingResult.shouldMigrate;
                const lidForPN = mappingResult.lidForPN;
                // Migrate all devices for this user if LID mapping exists
                if (shouldMigrateUser && lidForPN) {
                    // Bulk migrate all user devices in single transaction
                    const migrationResult = await signalRepository.migrateSession(userJids, lidForPN);
                    if (migrationResult.migrated > 0) {
                        logger.info({
                            user,
                            lidMapping: lidForPN,
                            migrated: migrationResult.migrated,
                            skipped: migrationResult.skipped,
                            total: migrationResult.total
                        }, 'Completed bulk migration for user devices');
                    }
                    else {
                        logger.debug({
                            user,
                            lidMapping: lidForPN,
                            skipped: migrationResult.skipped,
                            total: migrationResult.total
                        }, 'All user device sessions already migrated');
                    }
                }
                // Direct bulk session check with LID single source of truth
                const addMissingSessionsToFetchList = (jid) => {
                    const signalId = signalRepository.jidToSignalProtocolAddress(jid);
                    if (sessions[signalId])
                        return;
                    // Determine correct JID to fetch (LID if mapping exists, otherwise original)
                    if (jid.includes('@s.whatsapp.net') && shouldMigrateUser && lidForPN) {
                        const decoded = (0, WABinary_1.jidDecode)(jid);
                        const lidDeviceJid = decoded.device !== undefined ? `${(0, WABinary_1.jidDecode)(lidForPN).user}:${decoded.device}@lid` : lidForPN;
                        jidsRequiringFetch.push(lidDeviceJid);
                        logger.debug({ pnJid: jid, lidJid: lidDeviceJid }, 'Adding LID JID to fetch list (conversion)');
                    }
                    else {
                        jidsRequiringFetch.push(jid);
                        logger.debug({ jid }, 'Adding JID to fetch list');
                    }
                };
                userJids.forEach(addMissingSessionsToFetchList);
            }
        }
        if (jidsRequiringFetch.length) {
            logger.debug({ jidsRequiringFetch }, 'fetching sessions');
            // DEBUG: Check if there are PN versions of LID users being fetched
            const lidUsersBeingFetched = new Set();
            const pnUsersBeingFetched = new Set();
            for (const jid of jidsRequiringFetch) {
                const user = (_a = (0, WABinary_1.jidDecode)(jid)) === null || _a === void 0 ? void 0 : _a.user;
                if (user) {
                    if (jid.includes('@lid')) {
                        lidUsersBeingFetched.add(user);
                    }
                    else if (jid.includes('@s.whatsapp.net')) {
                        pnUsersBeingFetched.add(user);
                    }
                }
            }
            // Find overlaps
            const overlapping = Array.from(pnUsersBeingFetched).filter(user => lidUsersBeingFetched.has(user));
            if (overlapping.length > 0) {
                logger.warn({
                    overlapping,
                    lidUsersBeingFetched: Array.from(lidUsersBeingFetched),
                    pnUsersBeingFetched: Array.from(pnUsersBeingFetched)
                }, 'Fetching both LID and PN sessions for same users');
            }
            const result = await query({
                tag: 'iq',
                attrs: {
                    xmlns: 'encrypt',
                    type: 'get',
                    to: WABinary_1.S_WHATSAPP_NET
                },
                content: [
                    {
                        tag: 'key',
                        attrs: {},
                        content: jidsRequiringFetch.map(jid => ({
                            tag: 'user',
                            attrs: { jid }
                        }))
                    }
                ]
            });
            await (0, Utils_1.parseAndInjectE2ESessions)(result, signalRepository);
            didFetchNewSession = true;
        }
        return didFetchNewSession;
    };
    const sendPeerDataOperationMessage = async (pdoMessage) => {
        var _a;
        //TODO: for later, abstract the logic to send a Peer Message instead of just PDO - useful for App State Key Resync with phone
        if (!((_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.id)) {
            throw new boom_1.Boom('Not authenticated');
        }
        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: index_js_1.proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        };
        const meJid = (0, WABinary_1.jidNormalizedUser)(authState.creds.me.id);
        const msgId = await relayMessage(meJid, protocolMessage, {
            additionalAttributes: {
                category: 'peer',
                push_priority: 'high_force'
            }
        });
        return msgId;
    };
    const createParticipantNodes = async (jids, message, extraAttrs, dsmMessage) => {
        var _a, _b;
        let patched = await patchMessageBeforeSending(message, jids);
        if (!Array.isArray(patched)) {
            patched = jids ? jids.map(jid => ({ recipientJid: jid, ...patched })) : [patched];
        }
        let shouldIncludeDeviceIdentity = false;
        const meId = authState.creds.me.id;
        const meLid = (_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.lid;
        const meLidUser = meLid ? (_b = (0, WABinary_1.jidDecode)(meLid)) === null || _b === void 0 ? void 0 : _b.user : null;
        const devicesByUser = new Map();
        for (const patchedMessageWithJid of patched) {
            const { recipientJid: wireJid, ...patchedMessage } = patchedMessageWithJid;
            if (!wireJid)
                continue;
            // Extract user from JID for grouping
            const decoded = (0, WABinary_1.jidDecode)(wireJid);
            const user = decoded === null || decoded === void 0 ? void 0 : decoded.user;
            if (!user)
                continue;
            if (!devicesByUser.has(user)) {
                devicesByUser.set(user, []);
            }
            devicesByUser.get(user).push({ recipientJid: wireJid, patchedMessage });
        }
        // Process each user's devices sequentially, but different users in parallel
        const userEncryptionPromises = Array.from(devicesByUser.entries()).map(([user, userDevices]) => encryptionMutex.mutex(user, async () => {
            var _a;
            logger.debug({ user, deviceCount: userDevices.length }, 'Acquiring encryption lock for user devices');
            const userNodes = [];
            // Helper to get encryption JID with LID migration
            const getEncryptionJid = async (wireJid) => {
                if (!wireJid.includes('@s.whatsapp.net'))
                    return wireJid;
                try {
                    const lidForPN = await signalRepository.lidMapping.getLIDForPN(wireJid);
                    if (!(lidForPN === null || lidForPN === void 0 ? void 0 : lidForPN.includes('@lid')))
                        return wireJid;
                    // Preserve device ID from original wire JID
                    const wireDecoded = (0, WABinary_1.jidDecode)(wireJid);
                    const deviceId = (wireDecoded === null || wireDecoded === void 0 ? void 0 : wireDecoded.device) || 0;
                    const lidDecoded = (0, WABinary_1.jidDecode)(lidForPN);
                    const lidWithDevice = (0, WABinary_1.jidEncode)(lidDecoded === null || lidDecoded === void 0 ? void 0 : lidDecoded.user, 'lid', deviceId);
                    // Migrate session to LID for unified encryption layer
                    try {
                        const migrationResult = await signalRepository.migrateSession([wireJid], lidWithDevice);
                        const recipientUser = (0, WABinary_1.jidNormalizedUser)(wireJid);
                        const ownPnUser = (0, WABinary_1.jidNormalizedUser)(meId);
                        const isOwnDevice = recipientUser === ownPnUser;
                        logger.info({ wireJid, lidWithDevice, isOwnDevice }, 'Migrated to LID encryption');
                        // Delete PN session after successful migration
                        try {
                            if (migrationResult.migrated) {
                                await signalRepository.deleteSession([wireJid]);
                                logger.debug({ deletedPNSession: wireJid }, 'Deleted PN session');
                            }
                        }
                        catch (deleteError) {
                            logger.warn({ wireJid, error: deleteError }, 'Failed to delete PN session');
                        }
                        return lidWithDevice;
                    }
                    catch (migrationError) {
                        logger.warn({ wireJid, error: migrationError }, 'Failed to migrate session');
                        return wireJid;
                    }
                }
                catch (error) {
                    logger.debug({ wireJid, error }, 'Failed to check LID mapping');
                    return wireJid;
                }
            };
            // Encrypt to this user's devices sequentially to prevent session corruption
            for (const { recipientJid: wireJid, patchedMessage } of userDevices) {
                // DSM logic: Use DSM for own other devices (following whatsmeow implementation)
                let messageToEncrypt = patchedMessage;
                if (dsmMessage) {
                    const { user: targetUser } = (0, WABinary_1.jidDecode)(wireJid);
                    const { user: ownPnUser } = (0, WABinary_1.jidDecode)(meId);
                    const ownLidUser = meLidUser;
                    // Check if this is our device (same user, different device)
                    const isOwnUser = targetUser === ownPnUser || (ownLidUser && targetUser === ownLidUser);
                    // Exclude exact sender device (whatsmeow: if jid == ownJID || jid == ownLID { continue })
                    const isExactSenderDevice = wireJid === meId || (((_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.lid) && wireJid === authState.creds.me.lid);
                    if (isOwnUser && !isExactSenderDevice) {
                        messageToEncrypt = dsmMessage;
                        logger.debug({ wireJid, targetUser }, 'Using DSM for own device');
                    }
                }
                const bytes = (0, Utils_1.encodeWAMessage)(messageToEncrypt);
                // Get encryption JID with LID migration
                const encryptionJid = await getEncryptionJid(wireJid);
                // ENCRYPT: Use the determined encryption identity (prefers migrated LID)
                const { type, ciphertext } = await signalRepository.encryptMessage({
                    jid: encryptionJid, // Unified encryption layer (LID when available)
                    data: bytes
                });
                if (type === 'pkmsg') {
                    shouldIncludeDeviceIdentity = true;
                }
                const node = {
                    tag: 'to',
                    attrs: { jid: wireJid }, // Always use original wire identity in envelope
                    content: [
                        {
                            tag: 'enc',
                            attrs: {
                                v: '2',
                                type,
                                ...(extraAttrs || {})
                            },
                            content: ciphertext
                        }
                    ]
                };
                userNodes.push(node);
            }
            logger.debug({ user, nodesCreated: userNodes.length }, 'Releasing encryption lock for user devices');
            return userNodes;
        }));
        // Wait for all users to complete (users are processed in parallel)
        const userNodesArrays = await Promise.all(userEncryptionPromises);
        const nodes = userNodesArrays.flat();
        return { nodes, shouldIncludeDeviceIdentity };
    };
    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, useCachedGroupMetadata, statusJidList }) => {
        var _a, _b;
        const meId = authState.creds.me.id;
        const meLid = (_a = authState.creds.me) === null || _a === void 0 ? void 0 : _a.lid;
        // ADDRESSING CONSISTENCY: Keep envelope addressing as user provided, handle LID migration in encryption
        let shouldIncludeDeviceIdentity = false;
        const { user, server } = (0, WABinary_1.jidDecode)(jid);
        const statusJid = 'status@broadcast';
        const isGroup = server === 'g.us';
        const isStatus = jid === statusJid;
        const isLid = server === 'lid';
        const isNewsletter = server === 'newsletter';
        // Keep user's original JID choice for envelope addressing
        const finalJid = jid;
        // ADDRESSING CONSISTENCY: Match own identity to conversation context
        // TODO: investigate if this is true
        let ownId = meId;
        if (isLid && meLid) {
            ownId = meLid;
            logger.debug({ to: jid, ownId }, 'Using LID identity for @lid conversation');
        }
        else {
            logger.debug({ to: jid, ownId }, 'Using PN identity for @s.whatsapp.net conversation');
        }
        msgId = msgId || (0, Utils_1.generateMessageIDV2)((_b = sock.user) === null || _b === void 0 ? void 0 : _b.id);
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus;
        const participants = [];
        const destinationJid = !isStatus ? finalJid : statusJid;
        const binaryNodeContent = [];
        const devices = [];
        const meMsg = {
            deviceSentMessage: {
                destinationJid,
                message
            },
            messageContextInfo: message.messageContextInfo
        };
        const extraAttrs = {};
        if (participant) {
            // when the retry request is not for a group
            // only send to the specific device that asked for a retry
            // otherwise the message is sent out to every device that should be a recipient
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, device_fanout: 'false' };
            }
            const { user, device } = (0, WABinary_1.jidDecode)(participant.jid); // rajeh: how does this even make sense TODO check out
            devices.push({
                user,
                device,
                wireJid: participant.jid // Use the participant JID as wire JID
            });
        }
        await authState.keys.transaction(async () => {
            var _a, _b, _c, _d, _e;
            const mediaType = getMediaType(message);
            if (mediaType) {
                extraAttrs['mediatype'] = mediaType;
            }
            if (isNewsletter) {
                // Patch message if needed, then encode as plaintext
                const patched = patchMessageBeforeSending ? await patchMessageBeforeSending(message, []) : message;
                const bytes = (0, Utils_1.encodeNewsletterMessage)(patched);
                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: {},
                    content: bytes
                });
                const stanza = {
                    tag: 'message',
                    attrs: {
                        to: jid,
                        id: msgId,
                        type: getMessageType(message),
                        ...(additionalAttributes || {})
                    },
                    content: binaryNodeContent
                };
                logger.debug({ msgId }, `sending newsletter message to ${jid}`);
                await sendNode(stanza);
                return;
            }
            if ((_a = (0, Utils_1.normalizeMessageContent)(message)) === null || _a === void 0 ? void 0 : _a.pinInChatMessage) {
                extraAttrs['decrypt-fail'] = 'hide'; // todo: expand for reactions and other types
            }
            if (isGroup || isStatus) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined; // todo: should we rely on the cache specially if the cache is outdated and the metadata has new fields?
                        if (groupData && Array.isArray(groupData === null || groupData === void 0 ? void 0 : groupData.participants)) {
                            logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata');
                        }
                        else if (!isStatus) {
                            groupData = await groupMetadata(jid);
                        }
                        return groupData;
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid]); // TODO: check out what if the sender key memory doesn't include the LID stuff now?
                            return result[jid] || {};
                        }
                        return {};
                    })()
                ]);
                if (!participant) {
                    const participantsList = groupData && !isStatus ? groupData.participants.map(p => p.id) : [];
                    if (isStatus && statusJidList) {
                        participantsList.push(...statusJidList);
                    }
                    if (!isStatus) {
                        const groupAddressingMode = (groupData === null || groupData === void 0 ? void 0 : groupData.addressingMode) || (isLid ? Types_1.WAMessageAddressingMode.LID : Types_1.WAMessageAddressingMode.PN);
                        additionalAttributes = {
                            ...additionalAttributes,
                            addressing_mode: groupAddressingMode
                        };
                    }
                    const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false);
                    devices.push(...additionalDevices);
                }
                const patched = await patchMessageBeforeSending(message);
                if (Array.isArray(patched)) {
                    throw new boom_1.Boom('Per-jid patching is not supported in groups');
                }
                const bytes = (0, Utils_1.encodeWAMessage)(patched);
                // This should match the group's addressing mode and conversation context
                const groupAddressingMode = (groupData === null || groupData === void 0 ? void 0 : groupData.addressingMode) || (isLid ? 'lid' : 'pn');
                const groupSenderIdentity = groupAddressingMode === 'lid' && meLid ? meLid : meId;
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId: groupSenderIdentity
                });
                const senderKeyJids = [];
                // ensure a connection is established with every device
                for (const device of devices) {
                    // This preserves the LID migration results from getUSyncDevices
                    const deviceJid = device.wireJid;
                    const hasKey = !!senderKeyMap[deviceJid];
                    if (!hasKey || !!participant) {
                        senderKeyJids.push(deviceJid);
                        // store that this person has had the sender keys sent to them
                        senderKeyMap[deviceJid] = true;
                    }
                }
                // if there are some participants with whom the session has not been established
                // if there are, we re-send the senderkey
                if (senderKeyJids.length) {
                    logger.debug({ senderKeyJids }, 'sending new sender key');
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    };
                    await assertSessions(senderKeyJids, false);
                    const result = await createParticipantNodes(senderKeyJids, senderKeyMsg, extraAttrs);
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                }
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: { v: '2', type: 'skmsg' },
                    content: ciphertext
                });
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            }
            else {
                const { user: ownUser } = (0, WABinary_1.jidDecode)(ownId);
                if (!participant) {
                    const targetUserServer = isLid ? 'lid' : 's.whatsapp.net';
                    devices.push({
                        user,
                        device: 0,
                        wireJid: (0, WABinary_1.jidEncode)(user, targetUserServer, 0)
                    });
                    // Own user matches conversation addressing mode
                    if (user !== ownUser) {
                        const ownUserServer = isLid ? 'lid' : 's.whatsapp.net';
                        const ownUserForAddressing = isLid && meLid ? (0, WABinary_1.jidDecode)(meLid).user : (0, WABinary_1.jidDecode)(meId).user;
                        devices.push({
                            user: ownUserForAddressing,
                            device: 0,
                            wireJid: (0, WABinary_1.jidEncode)(ownUserForAddressing, ownUserServer, 0)
                        });
                    }
                    if ((additionalAttributes === null || additionalAttributes === void 0 ? void 0 : additionalAttributes['category']) !== 'peer') {
                        // Clear placeholders and enumerate actual devices
                        devices.length = 0;
                        // Use conversation-appropriate sender identity
                        const senderIdentity = isLid && meLid
                            ? (0, WABinary_1.jidEncode)((_b = (0, WABinary_1.jidDecode)(meLid)) === null || _b === void 0 ? void 0 : _b.user, 'lid', undefined)
                            : (0, WABinary_1.jidEncode)((_c = (0, WABinary_1.jidDecode)(meId)) === null || _c === void 0 ? void 0 : _c.user, 's.whatsapp.net', undefined);
                        // Enumerate devices for sender and target with consistent addressing
                        const sessionDevices = await getUSyncDevices([senderIdentity, jid], false, false);
                        devices.push(...sessionDevices);
                        logger.debug({
                            deviceCount: devices.length,
                            devices: devices.map(d => { var _a; return `${d.user}:${d.device}@${(_a = (0, WABinary_1.jidDecode)(d.wireJid)) === null || _a === void 0 ? void 0 : _a.server}`; })
                        }, 'Device enumeration complete with unified addressing');
                    }
                }
                const allJids = [];
                const meJids = [];
                const otherJids = [];
                const { user: mePnUser } = (0, WABinary_1.jidDecode)(meId);
                const { user: meLidUser } = meLid ? (0, WABinary_1.jidDecode)(meLid) : { user: null };
                for (const { user, wireJid } of devices) {
                    const isExactSenderDevice = wireJid === meId || (meLid && wireJid === meLid);
                    if (isExactSenderDevice) {
                        logger.debug({ wireJid, meId, meLid }, 'Skipping exact sender device (whatsmeow pattern)');
                        continue;
                    }
                    // Check if this is our device (could match either PN or LID user)
                    const isMe = user === mePnUser || (meLidUser && user === meLidUser);
                    const jid = wireJid;
                    if (isMe) {
                        meJids.push(jid);
                    }
                    else {
                        otherJids.push(jid);
                    }
                    allJids.push(jid);
                }
                await assertSessions([...otherJids, ...meJids], false);
                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    // For own devices: use DSM if available (1:1 chats only)
                    createParticipantNodes(meJids, meMsg || message, extraAttrs),
                    createParticipantNodes(otherJids, message, extraAttrs, meMsg)
                ]);
                participants.push(...meNodes);
                participants.push(...otherNodes);
                if (meJids.length > 0 || otherJids.length > 0) {
                    extraAttrs['phash'] = (0, Utils_1.generateParticipantHashV2)([...meJids, ...otherJids]);
                }
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            if (participants.length) {
                if ((additionalAttributes === null || additionalAttributes === void 0 ? void 0 : additionalAttributes['category']) === 'peer') {
                    const peerNode = (_e = (_d = participants[0]) === null || _d === void 0 ? void 0 : _d.content) === null || _e === void 0 ? void 0 : _e[0];
                    if (peerNode) {
                        binaryNodeContent.push(peerNode); // push only enc
                    }
                }
                else {
                    binaryNodeContent.push({
                        tag: 'participants',
                        attrs: {},
                        content: participants
                    });
                }
            }
            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    to: destinationJid,
                    type: getMessageType(message),
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            };
            // if the participant to send to is explicitly specified (generally retry recp)
            // ensure the message is only sent to that person
            // if a retry receipt is sent to everyone -- it'll fail decryption for everyone else who received the msg
            if (participant) {
                if ((0, WABinary_1.isJidGroup)(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                }
                else if ((0, WABinary_1.areJidsSameUser)(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                }
                else {
                    stanza.attrs.to = participant.jid;
                }
            }
            else {
                stanza.attrs.to = destinationJid;
            }
            if (shouldIncludeDeviceIdentity) {
                ;
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: (0, Utils_1.encodeSignedDeviceIdentity)(authState.creds.account, true)
                });
                logger.debug({ jid }, 'adding device identity');
            }
            if (additionalNodes && additionalNodes.length > 0) {
                ;
                stanza.content.push(...additionalNodes);
            }
            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
            // Add message to retry cache if enabled
            if (messageRetryManager && !participant) {
                messageRetryManager.addRecentMessage(destinationJid, msgId, message);
            }
        }, meId);
        return msgId;
    };
    const getMessageType = (message) => {
        if (message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3) {
            return 'poll';
        }
        if (message.eventMessage) {
            return 'event';
        }
        return 'text';
    };
    const getMediaType = (message) => {
        if (message.imageMessage) {
            return 'image';
        }
        else if (message.videoMessage) {
            return message.videoMessage.gifPlayback ? 'gif' : 'video';
        }
        else if (message.audioMessage) {
            return message.audioMessage.ptt ? 'ptt' : 'audio';
        }
        else if (message.contactMessage) {
            return 'vcard';
        }
        else if (message.documentMessage) {
            return 'document';
        }
        else if (message.contactsArrayMessage) {
            return 'contact_array';
        }
        else if (message.liveLocationMessage) {
            return 'livelocation';
        }
        else if (message.stickerMessage) {
            return 'sticker';
        }
        else if (message.listMessage) {
            return 'list';
        }
        else if (message.listResponseMessage) {
            return 'list_response';
        }
        else if (message.buttonsResponseMessage) {
            return 'buttons_response';
        }
        else if (message.orderMessage) {
            return 'order';
        }
        else if (message.productMessage) {
            return 'product';
        }
        else if (message.interactiveResponseMessage) {
            return 'native_flow_response';
        }
        else if (message.groupInviteMessage) {
            return 'url';
        }
    };
    const getPrivacyTokens = async (jids) => {
        const t = (0, Utils_1.unixTimestampSeconds)().toString();
        const result = await query({
            tag: 'iq',
            attrs: {
                to: WABinary_1.S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: jids.map(jid => ({
                        tag: 'token',
                        attrs: {
                            jid: (0, WABinary_1.jidNormalizedUser)(jid),
                            t,
                            type: 'trusted_contact'
                        }
                    }))
                }
            ]
        });
        return result;
    };
    const waUploadToServer = (0, Utils_1.getWAUploadToServer)(config, refreshMediaConn);
    const waitForMsgMediaUpdate = (0, Utils_1.bindWaitForEvent)(ev, 'messages.media-update');
    return {
        ...sock,
        getPrivacyTokens,
        assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        readMessages,
        refreshMediaConn,
        waUploadToServer,
        fetchPrivacySettings,
        sendPeerDataOperationMessage,
        createParticipantNodes,
        getUSyncDevices,
        messageRetryManager,
        updateMediaMessage: async (message) => {
            const content = (0, Utils_1.assertMediaContent)(message.message);
            const mediaKey = content.mediaKey;
            const meId = authState.creds.me.id;
            const node = await (0, Utils_1.encryptMediaRetryRequest)(message.key, mediaKey, meId);
            let error = undefined;
            await Promise.all([
                sendNode(node),
                waitForMsgMediaUpdate(async (update) => {
                    const result = update.find(c => c.key.id === message.key.id);
                    if (result) {
                        if (result.error) {
                            error = result.error;
                        }
                        else {
                            try {
                                const media = await (0, Utils_1.decryptMediaRetryData)(result.media, mediaKey, result.key.id);
                                if (media.result !== index_js_1.proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    const resultStr = index_js_1.proto.MediaRetryNotification.ResultType[media.result];
                                    throw new boom_1.Boom(`Media re-upload failed by device (${resultStr})`, {
                                        data: media,
                                        statusCode: (0, Utils_1.getStatusCodeForMediaRetry)(media.result) || 404
                                    });
                                }
                                content.directPath = media.directPath;
                                content.url = (0, Utils_1.getUrlFromDirectPath)(content.directPath);
                                logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful');
                            }
                            catch (err) {
                                error = err;
                            }
                        }
                        return true;
                    }
                })
            ]);
            if (error) {
                throw error;
            }
            ev.emit('messages.update', [{ key: message.key, update: { message: message.message } }]);
            return message;
        },
        sendMessage: async (jid, content, options = {}) => {
            var _a, _b, _c;
            const userJid = authState.creds.me.id;
            if (typeof content === 'object' &&
                'disappearingMessagesInChat' in content &&
                typeof content['disappearingMessagesInChat'] !== 'undefined' &&
                (0, WABinary_1.isJidGroup)(jid)) {
                const { disappearingMessagesInChat } = content;
                const value = typeof disappearingMessagesInChat === 'boolean'
                    ? disappearingMessagesInChat
                        ? Defaults_1.WA_DEFAULT_EPHEMERAL
                        : 0
                    : disappearingMessagesInChat;
                await groupToggleEphemeral(jid, value);
            }
            else {
                const fullMsg = await (0, Utils_1.generateWAMessage)(jid, content, {
                    logger,
                    userJid,
                    getUrlInfo: text => (0, link_preview_1.getUrlInfo)(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: {
                            timeout: 3000,
                            ...(axiosOptions || {})
                        },
                        logger,
                        uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                    }),
                    //TODO: CACHE
                    getProfilePicUrl: sock.profilePictureUrl,
                    getCallLink: sock.createCallLink,
                    upload: waUploadToServer,
                    mediaCache: config.mediaCache,
                    options: config.options,
                    messageId: (0, Utils_1.generateMessageIDV2)((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id),
                    ...options
                });
                const isEventMsg = 'event' in content && !!content.event;
                const isDeleteMsg = 'delete' in content && !!content.delete;
                const isEditMsg = 'edit' in content && !!content.edit;
                const isPinMsg = 'pin' in content && !!content.pin;
                const isPollMessage = 'poll' in content && !!content.poll;
                const additionalAttributes = {};
                const additionalNodes = [];
                // required for delete
                if (isDeleteMsg) {
                    // if the chat is a group, and I am not the author, then delete the message as an admin
                    if ((0, WABinary_1.isJidGroup)((_b = content.delete) === null || _b === void 0 ? void 0 : _b.remoteJid) && !((_c = content.delete) === null || _c === void 0 ? void 0 : _c.fromMe)) {
                        additionalAttributes.edit = '8';
                    }
                    else {
                        additionalAttributes.edit = '7';
                    }
                }
                else if (isEditMsg) {
                    additionalAttributes.edit = '1';
                }
                else if (isPinMsg) {
                    additionalAttributes.edit = '2';
                }
                else if (isPollMessage) {
                    additionalNodes.push({
                        tag: 'meta',
                        attrs: {
                            polltype: 'creation'
                        }
                    });
                }
                else if (isEventMsg) {
                    additionalNodes.push({
                        tag: 'meta',
                        attrs: {
                            event_type: 'creation'
                        }
                    });
                }
                if ('cachedGroupMetadata' in options) {
                    console.warn('cachedGroupMetadata in sendMessage are deprecated, now cachedGroupMetadata is part of the socket config.');
                }
                await relayMessage(jid, fullMsg.message, {
                    messageId: fullMsg.key.id,
                    useCachedGroupMetadata: options.useCachedGroupMetadata,
                    additionalAttributes,
                    statusJidList: options.statusJidList,
                    additionalNodes
                });
                if (config.emitOwnEvents) {
                    process.nextTick(() => {
                        processingMutex.mutex(() => upsertMessage(fullMsg, 'append'));
                    });
                }
                return fullMsg;
            }
        }
    };
};
exports.makeMessagesSocket = makeMessagesSocket;
