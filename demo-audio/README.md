# Demo clips
One folder per scenario (`groceries`, `family`, `scam`, `gift`), clips played in name order: `01.wav`, `02.m4a`, …
Each clip has a same-name `.txt` transcript. A transcript that starts with `mem_danny:` is spoken by that family member (the verification leg).

- **Speech-to-text:** Muse Voice Transcribe takes 16/24 kHz mono 16-bit WAV. Deepgram handles mp3/m4a when `DEEPGRAM_API_KEY` is set. Otherwise the `.txt` file is used.
- **Replace a clip:** record over it with the same name and update the `.txt`. The clips here are Windows speech-synth placeholders.
- **Run:** `pnpm demo:run <scenario|all>`, or open `/stage` in the web app.
