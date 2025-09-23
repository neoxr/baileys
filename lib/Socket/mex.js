"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeWMexQuery = void 0;
const boom_1 = require("@hapi/boom");
const WABinary_1 = require("../WABinary");
const wMexQuery = (variables, queryId, query, generateMessageTag) => {
    return query({
        tag: 'iq',
        attrs: {
            id: generateMessageTag(),
            type: 'get',
            to: WABinary_1.S_WHATSAPP_NET,
            xmlns: 'w:mex'
        },
        content: [
            {
                tag: 'query',
                attrs: { query_id: queryId },
                content: Buffer.from(JSON.stringify({ variables }), 'utf-8')
            }
        ]
    });
};
const executeWMexQuery = async (variables, queryId, dataPath, query, generateMessageTag) => {
    var _a, _b;
    const result = await wMexQuery(variables, queryId, query, generateMessageTag);
    const child = (0, WABinary_1.getBinaryNodeChild)(result, 'result');
    if (child === null || child === void 0 ? void 0 : child.content) {
        const data = JSON.parse(child.content.toString());
        if (data.errors && data.errors.length > 0) {
            const errorMessages = data.errors.map((err) => err.message || 'Unknown error').join(', ');
            const firstError = data.errors[0];
            const errorCode = ((_a = firstError.extensions) === null || _a === void 0 ? void 0 : _a.error_code) || 400;
            throw new boom_1.Boom(`GraphQL server error: ${errorMessages}`, { statusCode: errorCode, data: firstError });
        }
        const response = dataPath ? (_b = data === null || data === void 0 ? void 0 : data.data) === null || _b === void 0 ? void 0 : _b[dataPath] : data === null || data === void 0 ? void 0 : data.data;
        if (typeof response !== 'undefined') {
            return response;
        }
    }
    const action = (dataPath || '').startsWith('xwa2_')
        ? dataPath.substring(5).replace(/_/g, ' ')
        : dataPath === null || dataPath === void 0 ? void 0 : dataPath.replace(/_/g, ' ');
    throw new boom_1.Boom(`Failed to ${action}, unexpected response structure.`, { statusCode: 400, data: result });
};
exports.executeWMexQuery = executeWMexQuery;
