"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAMessageAddressingMode = exports.WAMessageStatus = exports.WAMessageStubType = exports.WAProto = void 0;
const index_js_1 = require("../../WAProto/index.js");
Object.defineProperty(exports, "WAProto", { enumerable: true, get: function () { return index_js_1.proto; } });
exports.WAMessageStubType = index_js_1.proto.WebMessageInfo.StubType;
exports.WAMessageStatus = index_js_1.proto.WebMessageInfo.Status;
var WAMessageAddressingMode;
(function (WAMessageAddressingMode) {
    WAMessageAddressingMode["PN"] = "pn";
    WAMessageAddressingMode["LID"] = "lid";
})(WAMessageAddressingMode || (exports.WAMessageAddressingMode = WAMessageAddressingMode = {}));
