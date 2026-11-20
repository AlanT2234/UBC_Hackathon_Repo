// Generates Dorothy's spoken lines for the demo video with ElevenLabs text-to-speech, in the
// "SafeNSound Dorothy" voice (designed with ElevenLabs Voice Design). They are played into the
// microphone during recording, so the voice agent hears her. Re-run after editing
// lib/dorothy-lines.json; files land in media/dorothy/ (committed, not served by the site).
//
//   ELEVENLABS_API_KEY=... npm run dorothy-lines
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY (the same key as backend/.env)");

const { voice, lines } = JSON.parse(readFileSync("lib/dorothy-lines.json", "utf8"));
const outDir = "media/dorothy";
mkdirSync(outDir, { recursive: true });

for (const line of lines) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({ text: line.text, model_id: "eleven_multilingual_v2" }),
    },
  );
  if (!res.ok) throw new Error(`${line.file} failed (${res.status}): ${await res.text()}`);
  writeFileSync(`${outDir}/${line.file}`, Buffer.from(await res.arrayBuffer()));
  console.log(`${outDir}/${line.file}  (scene ${line.scene}) ${line.text}`);
}
