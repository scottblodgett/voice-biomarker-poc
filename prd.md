# Voice Biomarker POC - Backend Handoff / Frontend Build Brief

The AWS backend is built, proven, and running as a durable service. This doc is
everything a new session (Claude Code) needs to build the Next.js frontend against it.

## Current state

- Three AI legs work end to end in one API call: Kintsugi (acoustic scores),
  Amazon Transcribe (transcript), Amazon Bedrock (combined interpretation).
- Proven from an external client with real audio files. Scores vary by input.
- Backend runs as a systemd service (`vbp`) on EC2, survives logout/reboot/crash.
- No frontend yet. That is the job.

## What to build

A Next.js (App Router, TypeScript) app that:
- Records from the browser mic (MediaRecorder API) AND accepts a file upload from disk.
- Enforces min 30s / max 180s recording length (Kintsugi needs 30s+ to be meaningful).
- Lets the user replay before submitting.
- POSTs the audio to the backend `/analyze` endpoint.
- Shows a progress/loading state (a full run takes ~15-20s, Transcribe is the slow part).
- Renders a polished results page: biomarker cards, transcript, AI interpretation.
- Prominently states results are experimental and NOT a medical diagnosis.

## Backend API contract

Base URL: `http://<ec2-public-ip>:8000`

### GET /health
Returns: `{"status": "ok", "model_loaded": true}`

### POST /analyze
- Content-Type: `multipart/form-data`
- Field: `file` (audio blob). WebM straight from MediaRecorder is fine; backend runs
  ffmpeg to normalize to wav/mono/16k, so no client-side conversion needed.
- Returns JSON:

```json
{
  "depression": { "raw_score": -0.9941, "class": 0, "label": "None (PHQ-9 <= 9)" },
  "anxiety":    { "raw_score": -0.8178, "class": 0, "label": "None (GAD-7 <= 4)" },
  "transcript": "full speech-to-text string ...",
  "interpretation": {
    "summary": "...",
    "depression": "...",
    "anxiety": "...",
    "transcript_observations": "...",
    "agreement": "...",
    "divergence": "...",
    "limitations": "..."
  },
  "processing_seconds": 19.04
}
```

## Class ladders (IMPORTANT: they are asymmetric)

Depression and anxiety do NOT have the same number of bands. Do not build one shared
component that assumes a common scale, or you will invent bands that do not exist.

Depression (mapped to PHQ-9), 3 bands:
- 0 = None (PHQ-9 <= 9)
- 1 = Mild-to-moderate (PHQ-9 10-14)
- 2 = Severe (PHQ-9 15+)

Anxiety (mapped to GAD-7), 4 bands:
- 0 = None (GAD-7 <= 4)
- 1 = Mild (GAD-7 5-9)
- 2 = Moderate (GAD-7 10-14)
- 3 = Severe (GAD-7 15+)

Each card should show the class label AND the raw score. Raw scores are on an arbitrary
scale that moves monotonically with the clinical scale, so raw and band never contradict.

## Conceptual model (for the UI copy / explainer)

- Kintsugi = HOW they sound (acoustic only, never sees the transcript)
- Transcribe = WHAT they said (semantic only)
- Bedrock = what the two may mean TOGETHER (keeps the two lanes separate, notes where
  they agree and diverge, stays in "screening signal, not diagnosis" territory)

## Gotchas the frontend session MUST handle

1. CORS is NOT configured on the backend yet. A browser calling the box from a different
   origin (e.g. Next on localhost:3000) will be blocked. Fix by adding this to the backend
   `app.py` and restarting the service:

   ```python
   from fastapi.middleware.cors import CORSMiddleware
   app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
   ```
   Then on the box: `sudo systemctl restart vbp`

2. Browser mic access requires HTTPS on any origin except localhost. Local dev on
   localhost works over http. A deployed frontend needs https.

3. The backend is plain HTTP. If the Next page is served over https, calling an http
   endpoint is mixed content and the browser blocks it. Either serve Next over http for
   dev, or put the backend behind https (reverse proxy) for a real demo.

4. `<ec2-public-ip>` is a normal public IP, not an Elastic IP. If the instance stops/starts,
   it changes. Attach an EIP before relying on the URL for a live demo.

5. Port 8000 on the box is currently open only to a single laptop IP (<your-ip>/32).
   Whatever machine calls the backend from a browser needs its IP allowed on SG
   `<sg-app>`, or open 8000 wider for the demo.

## Unresolved architecture decision

Same-origin (Next on the box, reverse-proxied behind one https domain, cleanest for a
demo, mic works) vs split (Next runs anywhere, calls the box http endpoint, faster to
stand up but needs CORS + the https/mic handling above). Recommendation was same-origin
for anything shown to people. Not yet decided.

## AWS / infra reference (only if the backend needs touching)

- Region: us-east-1
- Account: <account-id>
- EC2: instance <instance-id>, m7i.xlarge, Ubuntu 26.04 Resolute LTS, 50 GiB gp3
- Public IP: <ec2-public-ip> (private <private-ip>)
- Security group: <sg-app> (22 from your IP + EC2 Instance Connect; 80/443 open; 8000 from laptop IP)
- Key pair: voice-biomarker-poc (private key voice-biomarker-poc.pem, saved in CloudShell)
- IAM role + instance profile: voice-biomarker-poc (S3 scoped to the bucket, AmazonTranscribeFullAccess, Bedrock invoke)
- S3 bucket: voice-biomarker-poc-<account-id>
- Bedrock model: us.anthropic.claude-sonnet-5 (inference profile; the bare
  anthropic.claude-sonnet-5 id is NOT invokable on-demand; temperature param is
  deprecated on this model, do not send it)

### Backend on the box
- App dir: /home/ubuntu/voice-biomarker-poc/dam
- App: app.py (FastAPI), model loads once at startup
- Env: uv-managed .venv, Python 3.11
- Key deps: torch 2.6.0 (CPU), torchaudio 2.6.0, soundfile 0.13.1, transformers 4.52.3,
  peft 0.15.2, fastapi, uvicorn[standard], python-multipart, boto3
- Kintsugi model: KintsugiHealth/dam (Whisper-small.en backbone), checkpoint dam3.1.ckpt
- Test file on box: sample.wav (in the app dir)
- Service: systemd unit /etc/systemd/system/vbp.service
  - restart: `sudo systemctl restart vbp`
  - logs: `journalctl -u vbp -f`
  - status: `systemctl status vbp`

## URLs

- Kintsugi model: https://huggingface.co/KintsugiHealth/dam
- Kintsugi threshold-tuning dataset: https://huggingface.co/datasets/KintsugiHealth/dam-dataset
- Backend health: http://<ec2-public-ip>:8000/health
- Backend analyze: http://<ec2-public-ip>:8000/analyze