// Generates the demo scam call's audio with ElevenLabs text-to-speech, one MP3 per line, into
// public/demo-call/. The files are committed, so the demo plays offline; re-run after editing
// lib/demo-call.json.
//
//   ELEVENLABS_API_KEY=... npm run demo-audio
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("Set ELEVENLABS_API_KEY (the same key as backend/.env)");

const script = JSON.parse(readFileSync("lib/demo-call.json", "utf8"));
const outDir = "public/demo-call";
mkdirSync(outDir, { recursive: true });

for (const [i, line] of script.lines.entries()) {
  const voice = script.voices[line.speaker];
  if (!voice) throw new Error(`No voice for speaker ${line.speaker}`);
  // Neighbouring lines from the same speaker keep the delivery consistent.
  const prev = script.lines[i - 1];
  const next = script.lines[i + 1];
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text: line.text,
        model_id: "eleven_multilingual_v2",
        previous_text: prev?.speaker === line.speaker ? prev.text : undefined,
        next_text: next?.speaker === line.speaker ? next.text : undefined,
      }),
    },
  );
  if (!res.ok) throw new Error(`Line ${i + 1} failed (${res.status}): ${await res.text()}`);
  const file = `${outDir}/line-${i + 1}.mp3`;
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`${file}  ${line.speaker} (${voice.name}): ${line.text}`);
}
