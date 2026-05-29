/**
 * Worker-thread bootstrap for the WhatsApp WASM VoIP engine.
 *
 * Mirrors the browser Web-Worker environment (self/postMessage/babelHelpers/
 * MessagePort) the WASM loader expects, then runs that loader inside a Node
 * `worker_threads` Worker. Function-keyword shims are intentional — the
 * loader inspects `.prototype` and `instanceof` on these.
 *
 * @author ShellTear
 */
"use strict";

import { parentPort, workerData } from "worker_threads";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as vm from "vm";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const _require = createRequire(import.meta.url);

interface WorkerData {
  wasmPath?: string;
  wasmBinary?: Uint8Array;
  workerModulesCode?: string;
  loaderCode?: string;
  loaderModuleName?: string;
  resourcesPath?: string;
  enableLogs?: boolean;
}

interface WasmCallbackPayload {
  type: string;
  __name?: string;
  [key: string]: unknown;
}

const typedWorkerData = workerData as WorkerData | undefined;

declare const global: typeof globalThis & { [key: string]: any };

if (typeof process === "undefined") {
  (global as any).process = {
    cwd: () => __dirname || ".",
    env: {},
    platform: "linux",
    version: "v18.0.0",
    versions: {},
    nextTick: (fn: Function, ...args: unknown[]) => setImmediate(fn as any, ...args),
    exit: (code: number) => {
      throw new Error(`Process exit: ${code}`);
    },
    on: () => {},
    off: () => {},
    once: () => {},
    emit: () => {},
  };
} else if (!(process as any).cwd) {
  (process as any).cwd = () => __dirname || ".";
}

(global as any).babelHelpers = {
  extends: function (target: any) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      if (source != null) {
        for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) {
            target[key] = source[key];
          }
        }
      }
    }
    return target;
  },

  inheritsLoose: function (subClass: any, superClass: any) {
    subClass.prototype = Object.create(superClass.prototype);
    subClass.prototype.constructor = subClass;
    subClass.__proto__ = superClass;
  },

  taggedTemplateLiteralLoose: function (strings: any, raw?: any) {
    if (!raw) raw = strings.slice(0);
    strings.raw = raw;
    return strings;
  },

  asyncToGenerator: function (fn: Function) {
    return function (this: any) {
      var self = this;
      var args = arguments;
      return new Promise(function (resolve, reject) {
        var gen = fn.apply(self, args);
        function step(key: string, arg?: any) {
          try {
            var info = gen[key](arg);
            var value = info.value;
          } catch (error) {
            reject(error);
            return;
          }
          if (info.done) {
            resolve(value);
          } else {
            Promise.resolve(value).then(
              function (val: any) { step("next", val); },
              function (err: any) { step("throw", err); }
            );
          }
        }
        step("next");
      });
    };
  },

  createClass: function (Constructor: any, protoProps?: any[], staticProps?: any[]) {
    if (protoProps) {
      for (var i = 0; i < protoProps.length; i++) {
        var descriptor: any = protoProps[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(Constructor.prototype, descriptor.key, descriptor);
      }
    }
    if (staticProps) {
      for (var j = 0; j < staticProps.length; j++) {
        var staticDescriptor: any = staticProps[j];
        staticDescriptor.enumerable = staticDescriptor.enumerable || false;
        staticDescriptor.configurable = true;
        if ("value" in staticDescriptor) staticDescriptor.writable = true;
        Object.defineProperty(Constructor, staticDescriptor.key, staticDescriptor);
      }
    }
    return Constructor;
  },

  classCallCheck: function (instance: any, Constructor: any) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  },

  defineProperty: function (obj: any, key: string, value: any) {
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value: value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } else {
      obj[key] = value;
    }
    return obj;
  },

  objectSpread: function (target: any) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i] != null ? arguments[i] : {};
      var ownKeys = Object.keys(source);
      if (typeof Object.getOwnPropertySymbols === "function") {
        ownKeys = ownKeys.concat(
          Object.getOwnPropertySymbols(source).filter(function (sym) {
            return Object.getOwnPropertyDescriptor(source, sym)!.enumerable;
          }) as any
        );
      }
      ownKeys.forEach(function (key: any) {
        target[key] = source[key];
      });
    }
    return target;
  },

  objectSpread2: function (target: any) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i] != null ? arguments[i] : {};
      if (i % 2) {
        Object.keys(source).forEach(function (key) {
          target[key] = source[key];
        });
      } else if (Object.getOwnPropertyDescriptors) {
        Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
      } else {
        Object.keys(source).forEach(function (key) {
          Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key)!);
        });
      }
    }
    return target;
  },

  wrapNativeSuper: function (Class: any) {
    var _cache: Map<any, any> | undefined = typeof Map === "function" ? new Map() : undefined;

    function Wrapper(this: any) {
      return _construct(Class, arguments, _getPrototypeOf(this).constructor);
    }

    function _construct(Parent: any, args: any, Class: any) {
      if (typeof Reflect !== "undefined" && Reflect.construct) {
        return Reflect.construct(Parent, args, Class);
      }
      var a: any[] = [null];
      a.push.apply(a, args as any);
      var instance = new (Function.bind.apply(Parent, a as [any, ...any[]]) as any)();
      if (Class) Object.setPrototypeOf(instance, Class.prototype);
      return instance;
    }

    function _getPrototypeOf(o: any) {
      return Object.getPrototypeOf || function (o: any) { return o.__proto__; };
    }

    if (typeof Class !== "function") return Class;

    if (_cache) {
      if (_cache.has(Class)) return _cache.get(Class);
      _cache.set(Class, Wrapper);
    }

    Wrapper.prototype = Object.create(Class.prototype, {
      constructor: { value: Wrapper, enumerable: false, writable: true, configurable: true },
    });

    return Object.setPrototypeOf(Wrapper, Class);
  },

  isNativeFunction: function (fn: Function) {
    return Function.toString.call(fn).indexOf("[native code]") !== -1;
  },

  getPrototypeOf: function (o: any) {
    return Object.getPrototypeOf ? Object.getPrototypeOf(o) : o.__proto__;
  },

  setPrototypeOf: function (o: any, p: any) {
    return Object.setPrototypeOf ? Object.setPrototypeOf(o, p) : ((o.__proto__ = p), o);
  },

  assertThisInitialized: function (self: any) {
    if (self === void 0) {
      throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }
    return self;
  },

  possibleConstructorReturn: function (self: any, call: any) {
    if (call && (typeof call === "object" || typeof call === "function")) return call;
    return (global as any).babelHelpers.assertThisInitialized(self);
  },

  inherits: function (subClass: any, superClass: any) {
    if (typeof superClass !== "function" && superClass !== null) {
      throw new TypeError("Super expression must either be null or a function");
    }
    subClass.prototype = Object.create(superClass && superClass.prototype, {
      constructor: { value: subClass, writable: true, configurable: true },
    });
    if (superClass) Object.setPrototypeOf(subClass, superClass);
  },

  construct: function (Parent: any, args: any, Class: any) {
    if (typeof Reflect !== "undefined" && Reflect.construct) {
      return Reflect.construct(Parent, args, Class);
    }
    var a: any[] = [null];
    a.push.apply(a, args as any);
    var Constructor = Function.bind.apply(Parent, a as [any, ...any[]]) as any;
    var instance = new Constructor();
    if (Class) Object.setPrototypeOf(instance, Class.prototype);
    return instance;
  },

  isNativeReflectConstruct: function () {
    if (typeof Reflect === "undefined" || !Reflect.construct) return false;
    try {
      Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function () {}));
      return true;
    } catch (e) {
      return false;
    }
  },
} as Record<string, unknown>;

if (typeof global.require === "undefined") {
  global.require = _require;
}

const _originalProcess = global.process;
const _originalRequire = global.require;

const hideNodeEnv = (): void => {
  try { delete (global as any).process; } catch (e) { global.process = undefined as any; }
  try { delete (global as any).require; } catch (e) { global.require = undefined as any; }
};

const restoreNodeEnv = (): void => {
  global.process = _originalProcess;
  global.require = _originalRequire;
};

const __modules: Record<string, { exports: any }> = {};
const __moduleFactories: Record<string, { factory: Function; deps: string[]; flags?: any }> = {};

global.__d = function (name: string, deps: any, factory?: any, flags?: any): void {
  if (typeof deps === "function") {
    factory = deps;
    deps = [];
  }
  __moduleFactories[name] = { factory, deps, flags };
};

const importDefaultModule = (name: string): any => {
  const value = global.__r(name);
  return value && value.__esModule ? value.default : value;
};

const importAllModule = (name: string): any => {
  const value = global.__r(name);
  if (value == null) {
    return { default: value };
  }
  if (value.__esModule) {
    return value;
  }
  if (typeof value !== "object" && typeof value !== "function") {
    return { default: value };
  }
  const namespace: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    namespace[key] = value[key];
  }
  namespace.default = value;
  return namespace;
};

global.__r = function (name: string): any {
  if (__modules[name]) return __modules[name].exports;

  const moduleFactory = __moduleFactories[name];
  if (!moduleFactory) throw new Error(`Module "${name}" not found`);

  const module = { exports: {} as any };
  __modules[name] = module;

  try {
    moduleFactory.factory(
      global,
      global.__r,
      importDefaultModule,
      importAllModule,
      null,
      module,
      module.exports
    );
  } catch (e) {
    delete __modules[name];
    throw e;
  }

  return module.exports;
};

__modules["Promise"] = { exports: Promise };

const bxFunc = function (id: any) { return id; } as any;
bxFunc.getURL = function (_id: any, _opts?: any) { return ""; };
__modules["bx"] = { exports: bxFunc };
__modules["WorkerBundleResource"] = {
  exports: { createDedicatedWebWorker: function () { return null; } },
};
__modules["WorkerClient"] = { exports: { init: function () {} } };
__modules["WorkerMessagePort"] = {
  exports: { WorkerSyncedMessagePort: function () {} },
};
__modules["WAWebVoipWebWasmWorkerResource"] = { exports: {} };

if (typeof self === "undefined") (global as any).self = global;
(global as any).self = global;
if (typeof (global as any).window === "undefined") (global as any).window = global;

global.importScripts = function (...urls: string[]): void {
  for (const url of urls) {
    try {
      const code = fs.readFileSync(url, "utf8");
      eval(code);
    } catch (e) {}
  }
};

if (typeof (global as any).location === "undefined") {
  (global as any).location = {
    href: __filename,
    origin: "file://",
    protocol: "file:",
    host: "",
    hostname: "",
    port: "",
    pathname: __filename,
    search: "",
    hash: "",
  };
}

global.postMessage = function (data: any, transfer?: any): void {
  if (parentPort) parentPort.postMessage(data, transfer);
};

const messageListeners: Array<(event: { data: any }) => void> = [];
global.addEventListener = function (type: string, handler: any): void {
  if (type === "message") {
    messageListeners.push(handler);
    if (parentPort)
      parentPort.on("message", (data: any) => {
        handler({ data });
      });
  }
};

class SimpleHook<T = unknown> {
  private listeners: Array<(data: T) => void> = [];
  add = (fn: (data: T) => void): (data: T) => void => { this.listeners.push(fn); return fn; };
  remove = (fn: (data: T) => void): boolean => { const idx = this.listeners.indexOf(fn); if (idx >= 0) { this.listeners.splice(idx, 1); return true; } return false; };
  clear = (): void => { this.listeners = []; };
  call = (data: T): void => { for (const fn of this.listeners) { try { fn(data); } catch {} } };
}

class WorkerSyncedMessagePort {
  private $1: Record<string, SimpleHook<any>> = {};
  public onUnhandledMessage = new SimpleHook<any>();
  public onMessage = new SimpleHook<any>();
  public onPostMessage = new SimpleHook<any>();
  public onError = new SimpleHook<any>();
  private $2: any;
  public name: string;

  constructor(port: any, name: string) {
    this.$2 = port;
    this.name = name;

    if (parentPort) {
      parentPort.on("message", (data: any) => {
        this.onMessageHandler(data);
      });
    }
  }

  onMessageHandler(data: any): void {
    try {
      this.onMessage.call(data);
      let handled = false;
      const dispatch = (key?: string): void => {
        if (!key) return;
        const hook = this.$1[key];
        if (hook) {
          handled = true;
          hook.call(data);
        }
      };
      dispatch(data.type);
      if (data.cmd !== data.type) dispatch(data.cmd);
      if (!handled) this.onUnhandledMessage.call(data);
    } catch (e) {
      this.onError.call(e);
    }
  }

  postMessage(data: any, transfer?: any): void {
    this.onPostMessage.call(data);
    if (parentPort) {
      if (transfer) parentPort.postMessage(data, transfer);
      else parentPort.postMessage(data);
    }
  }

  addMessageListener(type: string, fn: (data: any) => void): (data: any) => void {
    let hook = this.$1[type];
    if (!hook) {
      hook = new SimpleHook<any>();
      this.$1[type] = hook;
    }
    return hook.add(fn);
  }

  removeMessageListener(type: string, fn: (data: any) => void): boolean {
    const hook = this.$1[type];
    return !!hook && hook.remove(fn);
  }

  removeAllMessageListeners(type: string): void {
    const hook = this.$1[type];
    if (hook) hook.clear();
  }
}

let WABinary = {
  Binary: {
    build: function (data: any) {
      return {
        readByteArrayView: function (): Uint8Array {
          if (data instanceof Uint8Array) return data;
          if (typeof data === "string") return new TextEncoder().encode(data);
          if (Array.isArray(data)) return new Uint8Array(data);
          if (Buffer.isBuffer(data)) return new Uint8Array(data);
          if (data instanceof ArrayBuffer) return new Uint8Array(data);
          if (ArrayBuffer.isView(data)) {
            return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
          }
          if (typeof data === "object" && data !== null && typeof data.length === "number") {
            const arr = new Uint8Array(data.length);
            for (let i = 0; i < data.length; i++) arr[i] = data[i] || 0;
            return arr;
          }
          return new Uint8Array(0);
        },
      };
    },
  },
};

let WACryptoHkdfSync = {
  hkdf: function (key: Uint8Array, salt: Buffer | undefined, info: Uint8Array | Buffer | undefined, length: number): Uint8Array {
    const prk = crypto
      .createHmac("sha256", salt || Buffer.alloc(32))
      .update(key)
      .digest();
    const n = Math.ceil(length / 32);
    const okm = Buffer.alloc(n * 32);
    let prev = Buffer.alloc(0);
    for (let i = 0; i < n; i++) {
      prev = crypto
        .createHmac("sha256", prk)
        .update(Buffer.concat([prev, (info as Buffer) || Buffer.alloc(0), Buffer.from([i + 1])]))
        .digest();
      prev.copy(okm, i * 32);
    }
    return new Uint8Array(okm.slice(0, length));
  },
};

class Sha256HMacBuilder {
  private hmac: crypto.Hmac;

  constructor(key: Uint8Array | Buffer) {
    this.hmac = crypto.createHmac("sha256", key);
  }

  update(data: Uint8Array | Buffer): this {
    this.hmac.update(data);
    return this;
  }

  finish(): Uint8Array {
    return new Uint8Array(this.hmac.digest());
  }
}

const WACryptoSha256HmacBuilder = { Sha256HMacBuilder };

const WAWebVoipPersistentFS = {
  getVoipPersistentDirectoryPath: function (): string {
    return "/tmp/voip";
  },
  initPersistentFS: async function (_module?: any): Promise<void> {
    return Promise.resolve();
  },
};

let WAWebVoipJsWorkerMessageHandler: { handleJsWorkerMessage: Function } = {
  handleJsWorkerMessage: function () {},
};

const getPreferredLoaderModuleNames = (): string[] => {
  return [
    typedWorkerData?.loaderModuleName,
    "WAWebVoipWebWasmLoader",
    "WAWebVoipWebWasmLoader.worker",
    "WAWebVoipWebWasmLoader_ProdLab_internal.worker",
    "WAWebVoipWebWasmLoader_ProdLabvideo_internal.worker",
  ].filter((value, index, array) => !!value && array.indexOf(value) === index) as string[];
};

const resolveLoaderModule = (): Function | null => {
  for (const moduleName of getPreferredLoaderModuleNames()) {
    try {
      const loaderModule = global.__r(moduleName);
      const resolved = loaderModule?.default ?? loaderModule;
      if (typeof resolved === "function") {
        return resolved;
      }
    } catch (e) {}
  }
  return null;
};

const nullthrows = <T,>(value: T | null | undefined): T => {
  if (value == null) throw new Error("Got unexpected null or undefined");
  return value;
};

const asyncToGeneratorRuntime = {
  asyncToGenerator: function (fn: Function) {
    return function (this: any, ...args: any[]) {
      const gen = fn.apply(this, args);
      return new Promise((resolve, reject) => {
        function step(key: string, arg?: any) {
          try {
            const info = gen[key](arg);
            const value = info.value;
            if (info.done) resolve(value);
            else
              Promise.resolve(value).then(
                (val: any) => step("next", val),
                (err: any) => step("throw", err)
              );
          } catch (e) {
            reject(e);
          }
        }
        step("next", undefined);
      });
    };
  },
};

const e = new WorkerSyncedMessagePort((global as any).self, "VoipWebWasmWorker");

type WhatsAppVoipWasmWorkerCompatibleCallbacks = Record<string, (...args: any[]) => unknown>;

(global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks = {
  onSignalingXmpp: function (n: any) {
    e.postMessage({
      type: "waWasmWorkerCompatibleCallback",
      __name: "onSignalingXmpp",
      peerJid: n.peerJid,
      callId: n.callId,
      xmlPayload: n.xmlPayload,
    });
  },

  onCallEvent: function (n: any) {
    e.postMessage({
      type: "waWasmWorkerCompatibleCallback",
      __name: "onCallEvent",
      eventType: n.eventType,
      userData: n.userData,
      eventDataJson: n.eventDataJson,
    });
  },

  sendDataToRelay: function (n: any) {
    const t = n.data;
    const r = n.len;
    const o = n.ip;
    const a = n.port;

    e.postMessage({
      type: "waWasmWorkerCompatibleCallback",
      __name: "sendDataToRelay",
      data: t,
      len: r,
      ip: o,
      port: a,
    });

    return r || (t ? t.length || t.byteLength || 0 : 0);
  },

  loggingCallback: function (n: any) {
    try {
      e.postMessage(
        Object.assign(
          { type: "waWasmWorkerCompatibleCallback", __name: "loggingCallback" },
          n
        )
      );
    } catch (err) {}
  },

  initCaptureDriverJS: function (n: any) {
    e.postMessage(
      Object.assign(
        { type: "waWasmWorkerCompatibleCallback", __name: "initCaptureDriverJS" },
        n
      )
    );
    return 0;
  },

  startCaptureJS: function () {
    e.postMessage({
      type: "waWasmWorkerCompatibleCallback",
      __name: "startCaptureJS",
    });
    return 0;
  },

  stopCaptureJS: function () {
    e.postMessage({
      type: "waWasmWorkerCompatibleCallback",
      __name: "stopCaptureJS",
    });
    return 0;
  },

  initPlaybackDriverJS: function (n: any) {
    e.postMessage(
      Object.assign(
        { type: "waWasmWorkerCompatibleCallback", __name: "initPlaybackDriverJS" },
        n
      )
    );
    return 0;
  },

  startPlaybackJS: function () {
    e.postMessage({
      type: "waWasmWorkerCompatibleCallback",
      __name: "startPlaybackJS",
    });
    return 0;
  },

  stopPlaybackJS: function () {
    e.postMessage({
      type: "waWasmWorkerCompatibleCallback",
      __name: "stopPlaybackJS",
    });
    return 0;
  },

  startVideoCaptureJS: function (n: any) {
    e.postMessage(
      Object.assign(
        { type: "waWasmWorkerCompatibleCallback", __name: "startVideoCaptureJS" },
        n
      )
    );
    return 0;
  },

  stopVideoCaptureJS: function () {
    e.postMessage({
      type: "waWasmWorkerCompatibleCallback",
      __name: "stopVideoCaptureJS",
    });
    return 0;
  },

  onVideoFrameWasmToJs: function (n: any) {
    e.postMessage(
      {
        type: "waWasmWorkerCompatibleCallback",
        __name: "onVideoFrameWasmToJs",
        userJid: n.userJid,
        frameBuffer: n.frameBuffer,
        width: n.width,
        height: n.height,
        orientation: n.orientation,
        format: n.format,
        timestamp: n.timestamp,
        isKeyFrame: n.isKeyFrame,
      },
      [n.frameBuffer]
    );
  },

  startDesktopCaptureJS: function (n: any) {
    e.postMessage(
      Object.assign(
        { type: "waWasmWorkerCompatibleCallback", __name: "startDesktopCaptureJS" },
        n
      )
    );
    return 0;
  },

  stopDesktopCaptureJS: function () {
    e.postMessage({
      type: "waWasmWorkerCompatibleCallback",
      __name: "stopDesktopCaptureJS",
    });
    return 0;
  },

  cryptoHkdfExtractWithSaltAndExpand: function (t: any) {
    const i = new Uint8Array(t.key_);
    const l = t.salt_ ? new Uint8Array(t.salt_) : undefined;
    const s = WABinary.Binary.build(t.info_).readByteArrayView();
    return WACryptoHkdfSync.hkdf(i, l as any, s, t.length);
  },

  hmacSha256KeyGenerator: function (t: any) {
    const r = new Uint8Array(t.data_);
    const a = new Uint8Array(t.key_);
    return new Sha256HMacBuilder(a).update(r).finish();
  },

  isParticipantKnownContact: function (_t: any) {
    return false;
  },

  getPersistentDirectoryPath: function () {
    return WAWebVoipPersistentFS.getVoipPersistentDirectoryPath();
  },

  getBrowserAudioProcessingStatus: function () {
    return 7;
  },

  getBweModelPath: function () {
    return null;
  },

  videoFrameConsumed: function () {},

  dataChannelStateCallback: function () {},
} as WhatsAppVoipWasmWorkerCompatibleCallbacks;

let wasmLoader: Function | null = null;

if (typedWorkerData && (typedWorkerData.loaderCode || typedWorkerData.workerModulesCode)) {
  try {
    const modulePrelude = "var __d = global.__d, __r = global.__r;\n";
    const savedCallbacks = (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks;

    if (typedWorkerData.workerModulesCode) {
      const workerScript = new vm.Script(modulePrelude + typedWorkerData.workerModulesCode, {
        filename: "workerModulesCode-SEM22icu2S7.js",
      });
      workerScript.runInThisContext();
    }

    if (typedWorkerData.loaderCode) {
      const loaderScript = new vm.Script(modulePrelude + typedWorkerData.loaderCode, {
        filename: "loaderCode-1eFv_3F3hOU.js",
      });
      loaderScript.runInThisContext();
    }

    if (!(global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks?.loggingCallback) {
      (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks = savedCallbacks;
      if ((global as any).self !== (global as any).self) {
        (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks = savedCallbacks;
      }
    }

    if (global.self !== (global as any).self) {
      if ((global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks) {
        (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks =
          (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks;
      } else if ((global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks) {
        (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks =
          (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks;
      }
      (global as any).self = (global as any).self;
    }

    wasmLoader = resolveLoaderModule();

    try {
      const jsWorkerModule = global.__r("WAWebVoipJsWorkerMessageHandler");
      if (jsWorkerModule) {
        WAWebVoipJsWorkerMessageHandler = jsWorkerModule.default ?? jsWorkerModule;
      }
    } catch (e) {}
  } catch (e) {}
}

if (!wasmLoader) {
  const resourcesPath =
    typedWorkerData?.resourcesPath || path.join(__dirname, "wasm-resources");
  const rsrcPath = path.join(resourcesPath, "loader.js");
  if (fs.existsSync(rsrcPath)) {
    try {
      const loaderCode = fs.readFileSync(rsrcPath, "utf8");
      const savedCallbacks = (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks;

      const script = new vm.Script(loaderCode, { filename: rsrcPath });
      script.runInThisContext();

      if (!(global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks?.loggingCallback) {
        (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks = savedCallbacks;
      }

      wasmLoader = resolveLoaderModule();
    } catch (e) {}
  }
}

let s: any = {};
let u = false;
let _: any = null;
let jsWorkerRawVideoFramePtr = 0;
let jsWorkerRawVideoFrameSize = 0;

const c = (condition: boolean, msg: string): void => {
  if (!condition) throw "Assertion failed: " + msg;
};

const d = (..._args: any[]): void => {};

const m = (...args: any[]): void => {
  const text = args.join(" ");
  (global as any).postMessage({
    cmd: "alert",
    text: text,
    threadId: s._pthread_self ? s._pthread_self() : undefined,
  });
};

const p = d;
(global as any).self.alert = m;

s.instantiateWasm = function (imports: any, successCallback: (instance: WebAssembly.Instance) => any) {
  const wasmModule = nullthrows(s.wasmModule);
  s.wasmModule = null;
  const instance = new WebAssembly.Instance(wasmModule, imports);
  return successCallback(instance);
};

(global as any).self.onunhandledrejection = function (event: any) {
  throw event.reason ?? event;
};

const getActiveWasmModule = (): any => {
  return _ || (global as any).self.__waModule || s;
};

const releaseJsWorkerRawVideoFrameBuffer = (moduleRef: any): void => {
  if (jsWorkerRawVideoFramePtr && moduleRef && typeof moduleRef._free === "function") {
    try { moduleRef._free(jsWorkerRawVideoFramePtr); } catch {}
  }
  jsWorkerRawVideoFramePtr = 0;
  jsWorkerRawVideoFrameSize = 0;
};

const handleRawVideoFrameOnJsWorker = (msg: any): void => {
  const moduleRef = getActiveWasmModule();
  const sendFrameFn = msg?.useDesktopCapture
    ? moduleRef?.onDesktopCaptureDataFromJs
    : moduleRef?.onVideoDataFromJs;
  const frameBuffer = msg?.frameBuffer;
  const width = Math.max(0, Math.trunc(Number(msg?.width || 0)));
  const height = Math.max(0, Math.trunc(Number(msg?.height || 0)));
  const fps = Math.max(1, Math.trunc(Number(msg?.fps || 0)) || 1);
  const orientation = Math.trunc(Number(msg?.orientation || 0));
  const format = Math.trunc(Number(msg?.format || 0));
  const timestamp = Math.trunc(Number(msg?.timestamp || 0));

  if (
    !moduleRef ||
    typeof moduleRef._malloc !== "function" ||
    typeof moduleRef._free !== "function" ||
    typeof sendFrameFn !== "function" ||
    !(frameBuffer instanceof ArrayBuffer || ArrayBuffer.isView(frameBuffer))
  ) {
    return;
  }

  const bytes = ArrayBuffer.isView(frameBuffer)
    ? new Uint8Array(
        (frameBuffer as ArrayBufferView).buffer as ArrayBuffer,
        (frameBuffer as ArrayBufferView).byteOffset,
        (frameBuffer as ArrayBufferView).byteLength
      )
    : new Uint8Array(frameBuffer as ArrayBuffer);
  if (bytes.byteLength === 0 || width <= 0 || height <= 0) {
    return;
  }

  if (!jsWorkerRawVideoFramePtr || jsWorkerRawVideoFrameSize < bytes.byteLength) {
    releaseJsWorkerRawVideoFrameBuffer(moduleRef);
    jsWorkerRawVideoFramePtr = Number(moduleRef._malloc(bytes.byteLength)) || 0;
    jsWorkerRawVideoFrameSize = jsWorkerRawVideoFramePtr ? bytes.byteLength : 0;
  }

  if (!jsWorkerRawVideoFramePtr || jsWorkerRawVideoFrameSize < bytes.byteLength) {
    return;
  }

  moduleRef.GROWABLE_HEAP_U8().set(bytes, jsWorkerRawVideoFramePtr);

  try {
    sendFrameFn.call(
      moduleRef,
      jsWorkerRawVideoFramePtr,
      bytes.byteLength,
      width,
      height,
      fps,
      format,
      orientation
    );
  } catch (error: any) {
    if (error?.name !== "BindingError") {
      throw error;
    }
    try {
      sendFrameFn.call(
        moduleRef,
        jsWorkerRawVideoFramePtr,
        bytes.byteLength,
        width,
        height,
        fps,
        format
      );
    } catch (legacyError: any) {
      if (legacyError?.name !== "BindingError") {
        throw legacyError;
      }
      sendFrameFn.call(
        moduleRef,
        jsWorkerRawVideoFramePtr,
        bytes.byteLength,
        width,
        height,
        orientation,
        format,
        timestamp
      );
    }
  }
};

function f(t: any): void {
  try {
    if (t.cmd === "load") {
      const wasmModule = t.wasmModule;
      const wasmMemory = t.wasmMemory;
      const workerID = t.workerID;
      const handlers = t.handlers;
      const pendingMessages: any[] = [];

      function g(msg: any): void {
        pendingMessages.push(msg);
      }

      e.removeMessageListener("cmd", f);
      e.addMessageListener("cmd", g);

      (global as any).self.startWorker = function (module: any): void {
        (global as any).self.__waModule = module;
        (global as any).__waModule = module;
        s = module;
        e.postMessage({ type: "cmd", cmd: "loaded" });
        for (const msg of pendingMessages) f(msg);
        e.removeMessageListener("cmd", g);
        e.addMessageListener("cmd", f);
      };

      s.wasmModule = wasmModule;

      function h(name: string): void {
        s[name] = function () {
          const args = Array.from(arguments);
          e.postMessage({
            type: "cmd",
            cmd: "callHandler",
            callHandler: { handler: name, args: args },
          });
        };
      }

      for (const handler of handlers) h(handler);

      s.wasmMemory = wasmMemory;
      s.buffer = s.wasmMemory.buffer;
      s.workerID = workerID;
      s.ENVIRONMENT_IS_PTHREAD = true;

      if (!s.WhatsAppVoipWasmWorkerCompatibleCallbacks) {
        s.WhatsAppVoipWasmWorkerCompatibleCallbacks =
          (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks;
      }

      if (wasmLoader) {
        hideNodeEnv();
        (wasmLoader as Function)(s).then(
          asyncToGeneratorRuntime.asyncToGenerator(function* (module: any) {
            if (!module.WhatsAppVoipWasmWorkerCompatibleCallbacks) {
              module.WhatsAppVoipWasmWorkerCompatibleCallbacks =
                (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks;
            }

            if (!s.WhatsAppVoipWasmWorkerCompatibleCallbacks?.loggingCallback) {
              s.WhatsAppVoipWasmWorkerCompatibleCallbacks =
                (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks;
            }

            _ = module;
            try {
              yield WAWebVoipPersistentFS.initPersistentFS(_);
            } catch (err) {}
          })
        );
      } else {
        e.postMessage({ type: "cmd", cmd: "loaded" });
      }
    } else if (t.cmd === "run") {
      const pthread_ptr = t.pthread_ptr;

      if (s.__emscripten_thread_init)
        s.__emscripten_thread_init(pthread_ptr, 0, 0, 1);
      if (s.__emscripten_thread_mailbox_await)
        s.__emscripten_thread_mailbox_await(pthread_ptr);

      c(!!pthread_ptr, "pthread_ptr is required in event " + t.cmd);

      if (s.establishStackSpace) s.establishStackSpace();
      if (s.PThread) s.PThread.receiveObjectTransfer(t);
      if (s.PThread) s.PThread.threadInitTLS();

      if (!u) {
        if (s.__embind_initialize_bindings) s.__embind_initialize_bindings();
        u = true;
      }

      try {
        if (s.invokeEntryPoint) s.invokeEntryPoint(t.start_routine, t.arg);
      } catch (err: any) {
        if (err !== "unwind") throw err;
      }
    } else if (t.cmd === "cancel") {
      if (s._pthread_self && s._pthread_self()) {
        if (s.__emscripten_thread_exit) s.__emscripten_thread_exit(-1);
      }
    } else if (t.target !== "setimmediate") {
      if (t.cmd === "checkMailbox") {
        if (u && s.checkMailbox) s.checkMailbox();
      } else if (t.cmd === "jsWorkerCmd") {
        return;
      } else if (t.cmd) {
        p("worker.js received unknown command " + t.cmd);
        p(t);
      }
    }
  } catch (err: any) {
    p("worker.js onmessage() captured an uncaught exception: " + err);
    if (err?.stack) p(err.stack);
    if (s.__emscripten_thread_crashed) s.__emscripten_thread_crashed();
    throw err;
  }
}

e.addMessageListener("cmd", f);

e.addMessageListener("jsWorkerCmd", function (msg: any): void {
  try {
    if (msg?.jsWorkerCmd === "pushRawVideoFrame") {
      return handleRawVideoFrameOnJsWorker(msg);
    }
    if (msg?.jsWorkerCmd === "releaseRawVideoFrameBuffer") {
      return releaseJsWorkerRawVideoFrameBuffer(getActiveWasmModule());
    }
    return WAWebVoipJsWorkerMessageHandler.handleJsWorkerMessage(_, msg) as any;
  } catch (err) {
    throw err;
  }
});

e.addMessageListener("waWasmWorkerCompatibleCallback", function (msg: any): void {
  const callbackName = msg.__name;
  if (!callbackName) return;

  if (!(global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks) return;
  if (
    typeof (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks[callbackName] !== "function"
  ) return;

  try {
    if (
      ["startCaptureJS", "startPlaybackJS", "stopCaptureJS", "stopPlaybackJS"].includes(callbackName)
    ) {
      (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks[callbackName]();
    } else {
      const args: Record<string, unknown> = {};
      for (const key in msg) {
        if (key !== "type" && key !== "__name" && !key.startsWith("__"))
          args[key] = msg[key];
      }
      (global as any).self.WhatsAppVoipWasmWorkerCompatibleCallbacks[callbackName](args);
    }
  } catch (err) {}
});

if (parentPort) {
  parentPort.postMessage({ type: "worker_ready" });
}
