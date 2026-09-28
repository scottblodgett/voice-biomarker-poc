# Voice Biomarker POC

Experimental demo showing three independent AI capabilities analyzing a voice sample:

- **Kintsugi DAM** (acoustic model, Whisper-small backbone): depression + anxiety scores from HOW the voice sounds. Never sees the transcript.
- **Amazon Transcribe**: WHAT was said (speech to text).
- **Amazon Bedrock** (Claude Sonnet): combines both into a structured interpretation, keeping the acoustic and semantic lanes separate.

Not for diagnosis or clinical use. Screening signal only.

## Architecture

Browser -> Next.js (frontend, separate) -> FastAPI `/analyze` on EC2:
- ffmpeg normalizes upload to wav/mono/16k
- Kintsugi + Transcribe run in parallel
- Bedrock reasons over both
- returns scores + transcript + interpretation as JSON

## Backend setup (fresh box)

Ubuntu 24.04+ on AWS, CPU is fine (m7i.xlarge used here). Region us-east-1.

```bash
sudo apt update && sudo apt install -y git curl ffmpeg build-essential git-lfs
curl -LsSf https://astral.sh/uv/install.sh | sh && source ~/.bashrc
uv python install 3.11
git lfs install
mkdir -p ~/voice-biomarker-poc && cd ~/voice-biomarker-poc
git clone https://huggingface.co/KintsugiHealth/dam
# copy app.py into dam/, then:
cd dam
uv venv --python 3.11 && source .venv/bin/activate
uv pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
uv pip install -r ../requirements.txt
```

The instance needs an IAM role with: S3 read/write/**delete** on the bucket, Transcribe, and Bedrock invoke. Delete is required because `run_transcribe()` uploads each recording to S3 (Transcribe needs an S3 source) and deletes it again once the job finishes — without `s3:DeleteObject`, that cleanup call fails with `AccessDenied` and recordings accumulate in the bucket indefinitely. On this instance the role is `voice-biomarker-poc`; delete was added via:

```bash
aws iam put-role-policy \
  --role-name voice-biomarker-poc \
  --policy-name VoiceBiomarkerS3Delete \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      { "Effect": "Allow", "Action": "s3:DeleteObject", "Resource": "arn:aws:s3:::voice-biomarker-poc-<account-id>/audio/*" }
    ]
  }'
```

## Run as a service

```bash
sudo cp vbp.service /etc/systemd/system/vbp.service
sudo systemctl daemon-reload
sudo systemctl enable --now vbp
```

Manage: `sudo systemctl restart vbp` | logs `journalctl -u vbp -f`

## API

Base: `http://<host>:8000`

- `GET /health` -> `{"status":"ok","model_loaded":true}`
- `POST /analyze` -> multipart form, field `file` (audio). Returns:

```json
{
  "depression": {"raw_score": -0.99, "class": 0, "label": "None (PHQ-9 <= 9)"},
  "anxiety":    {"raw_score": -0.82, "class": 0, "label": "None (GAD-7 <= 4)"},
  "transcript": "...",
  "interpretation": {"summary":"...","depression":"...","anxiety":"...","transcript_observations":"...","agreement":"...","divergence":"...","limitations":"..."},
  "processing_seconds": 19.0
}
```

### Class ladders (asymmetric, do not share a UI component)

Depression (PHQ-9): 0 None (<=9), 1 Mild-to-moderate (10-14), 2 Severe (15+)
Anxiety (GAD-7): 0 None (<=4), 1 Mild (5-9), 2 Moderate (10-14), 3 Severe (15+)

## Notes

- Bedrock model: `us.anthropic.claude-sonnet-5` (inference profile; the bare id is not invokable on-demand; do not send the deprecated `temperature` param).
- The model checkpoint (`dam/`) is not in this repo. It re-clones from HuggingFace.
- Recording constraints for the frontend: min 30s, max 180s.
- Kintsugi's `run_on_file()` returns only `{'depression': score, 'anxiety': score}` — confirmed against the `KintsugiHealth/dam` model card. No confidence values, embeddings, or per-segment output exist to surface; `run_kintsugi()` already captures the full output.
- The delete-after-upload cleanup in `run_transcribe()` is wrapped in its own `try/except` (logs a warning on failure rather than raising) — a cleanup failure must never take down the `/analyze` response. An earlier version let it raise, which turned a routine `AccessDenied` into an unhandled 500 that the browser reported as a CORS error (Starlette doesn't attach CORS headers to unhandled-exception responses).
- Deployment: this backend is fronted by a CloudFront distribution for HTTPS (frontend is static-hosted separately on AWS Amplify). See the root `CLAUDE.md`'s Deployment section for the full topology, resource IDs, and the gotchas hit setting it up (CloudFront rejecting a raw-IP origin, a security-group rule quota limit, etc).
