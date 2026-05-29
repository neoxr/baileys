/**
 * Example: place a voice call.
 *
 *   npx tsx examples/call.mts <authDir> <phoneNumber> [audioSource]
 *
 *   authDir      Path to a Baileys multi-file auth state (default: ./auth)
 *   phoneNumber  Digits only, e.g. "12345678901" (required)
 *   audioSource  Path to MP3/WAV, or "silence" (default: silence)
 *
 * Environment:
 *   CALL_DURATION_MS  Auto-hangup after N ms (default: 30000)
 *
 * @author ShellTear
 */
import { VoipClient } from "../src/index.mjs";

const [, , authDir = "./auth", phoneNumber, audioSource = "silence"] = process.argv;
const durationMs = Number(process.env.CALL_DURATION_MS) || 30_000;

if (!phoneNumber) {
  console.error("Usage: npx tsx examples/call.mts <authDir> <phoneNumber> [audioSource]");
  process.exit(1);
}

const client = new VoipClient({ authDir });

console.log(`Connecting (auth: ${authDir})`);
await client.connect();
console.log("Connected. Placing call...");

const call = await client.call(phoneNumber, { audioSource, durationMs });

call.on("ringing", () => console.log("Ringing"));
call.on("connected", () => console.log("Call connected"));
call.on("ended", (reason) => console.log(`Call ended: ${reason}`));
call.on("error", (err) => console.error("Call error:", err));

console.log(`Call id=${call.callId}, auto-end in ${durationMs / 1000}s`);
await call.waitForEnd();

client.disconnect();
process.exit(0);
