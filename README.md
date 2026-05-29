# baileys-caller

Place WhatsApp voice calls from Node.js.

Wraps WhatsApp Web's official VoIP WASM stack and uses [Baileys](https://github.com/WhiskeySockets/Baileys) for authentication and signaling. Audio (MP3, WAV, or `Float32Array`) is encoded with Opus and sent over the live RTP session.

> **Author:** ShellTear

## Status

- ✅ Outbound 1:1 voice calls
- ✅ Stream audio from MP3/WAV files
- ✅ Receive remote audio as `Float32Array`
- ✅ Mute / unmute / hang up
- ❌ Group calls
- ❌ Video
- ❌ Inbound calls

## Requirements

- Node.js ≥ 20
- `ffmpeg` on `PATH` (used to decode/resample audio sources)
- A linked WhatsApp account (you'll scan a QR on first run)

## Install

This package isn't published on npm. Pull it in directly from git:

```bash
git clone https://github.com/SheIITear/baileys-caller
cd baileys-caller
npm install
npm run build
```

You can also depend on it from another project via a git URL in `package.json`:

```json
{
  "dependencies": {
    "baileys-caller": "git+https://github.com/SheIITear/baileys-caller.git",
    "@whiskeysockets/baileys": "^7.0.0-rc11"
  }
}
```

`@whiskeysockets/baileys` is a peer dependency — install it in your project alongside this one.

## Quick Start

```ts
import { VoipClient } from "baileys-caller";

const client = new VoipClient({ authDir: "./auth" });

await client.connect(); // first run prints a QR for WhatsApp > Linked Devices

const call = await client.call("12345678901", {
  audioSource: "./hello.mp3",
});

call.on("ringing",   () => console.log("ringing"));
call.on("connected", () => console.log("connected"));
call.on("audio",     (pcm) => { /* 16 kHz mono Float32Array from the peer */ });
call.on("ended",     (reason) => console.log("ended:", reason));

await call.waitForEnd();
client.disconnect();
```

Run the bundled example from a clone:

```bash
npx tsx examples/call.mts ./auth 12345678901 ./hello.mp3
```

## API

### `new VoipClient(options)`

| Option    | Type     | Description                                |
|-----------|----------|--------------------------------------------|
| `authDir` | `string` | Baileys multi-file auth state directory    |

### `client.connect(): Promise<void>`

Connects to WhatsApp. On first run a QR code is printed; scan it from `WhatsApp > Settings > Linked Devices`. Subsequent runs reuse `authDir`.

### `client.call(phoneNumber, opts?): Promise<ActiveCall>`

Places an outbound call. `phoneNumber` is digits only (e.g. `"12345678901"`).

| Option        | Type                  | Description                                              |
|---------------|-----------------------|----------------------------------------------------------|
| `audioSource` | `string \| "silence"` | Path to MP3/WAV, or `"silence"` for an empty stream      |
| `durationMs`  | `number?`             | Auto-hangup after N ms                                   |

### `client.disconnect(): void`

Closes the WhatsApp socket and releases resources.

### `ActiveCall`

Returned by `client.call()`. Extends `EventEmitter`.

#### Events

| Event       | Payload         | When                                          |
|-------------|-----------------|-----------------------------------------------|
| `ringing`   | —               | Remote device is ringing                      |
| `connected` | —               | Call answered, media flowing                  |
| `audio`     | `Float32Array`  | 16 kHz mono PCM frame from the remote peer    |
| `ended`     | `string`        | Call ended (`hangup`, `timeout`, `rejected`)  |
| `error`     | `Error`         | Fatal error                                   |

#### Methods

- `call.end(): void` — hang up
- `call.mute(muted: boolean): void` — toggle outgoing mute
- `call.waitForEnd(): Promise<string>` — resolves with end reason

#### Properties

- `call.callId: string`

## How it works

1. Baileys handles WhatsApp authentication, encryption, and signaling stanzas.
2. The WhatsApp Web VoIP WASM stack runs in-process to negotiate the call, encode/decode Opus, and manage the RTP/SRTP session.
3. A pthread pool of `worker_threads` mirrors the browser's Web Worker pool the WASM expects.
4. Outbound audio is decoded with `ffmpeg`, resampled to 16 kHz mono, fed into the WASM, and delivered to the relay.
5. Inbound audio is exposed as `Float32Array` chunks via the `audio` event.

## Auth state

`authDir` stores Baileys session keys after the first QR scan. Treat it like a credential — anyone with that directory can act as your linked device.

## WASM resources

The WASM binary and its loader (`whatsapp.wasm`, `loader.js`, `worker-modules.js`) live under `assets/wasm/`. To refresh them from a current WhatsApp Web session:

```bash
npm run fetch-wasm
```

## License

MIT © ShellTear
