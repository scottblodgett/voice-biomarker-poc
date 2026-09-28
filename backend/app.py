import time, tempfile, subprocess, os, uuid, json, asyncio, urllib.request
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
import boto3
from pipeline import Pipeline

REGION, BUCKET = os.environ.get("AWS_REGION", "us-east-1"), os.environ["VBP_BUCKET"]  # bucket name embeds the account id; env-only, same reasoning as ORIGIN_SECRET below
MODEL = "us.anthropic.claude-sonnet-5"
ORIGIN_SECRET = os.environ["ORIGIN_SECRET"]
DEP = {0: "None (PHQ-9 <= 9)", 1: "Mild-to-moderate (PHQ-9 10-14)", 2: "Severe (PHQ-9 15+)"}
ANX = {0: "None (GAD-7 <= 4)", 1: "Mild (GAD-7 5-9)", 2: "Moderate (GAD-7 10-14)", 3: "Severe (GAD-7 15+)"}
ml = {}
s3 = boto3.client("s3", region_name=REGION)
transcribe = boto3.client("transcribe", region_name=REGION)
bedrock = boto3.client("bedrock-runtime", region_name=REGION)

SYSTEM = ("You interpret outputs from an experimental voice-based mental health SCREENING demo. You are given two INDEPENDENT sources:\n"
"1. Kintsugi DAM: an acoustic model that scored depression and anxiety from HOW the voice sounds, not the words. It produced the severity classes and raw scores you receive. You did NOT detect these yourself.\n"
"2. Transcript: WHAT the person said, from a separate speech-to-text system. Semantic content only.\n\n"
"Rules:\n"
"- Keep acoustic evidence (Kintsugi) and semantic evidence (transcript) in separate lanes. Never merge them or imply one produced the other.\n"
"- Kintsugi produced the scores. Do not claim to independently detect depression or anxiety.\n"
"- Explicitly note where the acoustic signal and the words agree, and where they diverge.\n"
"- This is a screening signal, not a diagnosis. Never tell the person what they have.\n"
"- Be concise and plain.\n\n"
"Respond with ONLY a JSON object, no markdown fences, no preamble, with these string keys: summary, depression, anxiety, transcript_observations, agreement, divergence, limitations.")

def scalar(v): return float(v.item()) if hasattr(v, "item") else float(v)

def _unfence(t):
    t = t.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        if t.endswith("```"): t = t[:-3]
    return t.strip()

def run_kintsugi(wav):
    p = ml["pipeline"]
    raw, q = p.run_on_file(wav, quantize=False), p.run_on_file(wav, quantize=True)
    dep_c, anx_c = int(q["depression"]), int(q["anxiety"])
    return {"depression": {"raw_score": round(scalar(raw["depression"]), 4), "class": dep_c, "label": DEP[dep_c]}, "anxiety": {"raw_score": round(scalar(raw["anxiety"]), 4), "class": anx_c, "label": ANX[anx_c]}}

def run_transcribe(wav):
    key = f"audio/{uuid.uuid4().hex}.wav"
    s3.upload_file(wav, BUCKET, key)
    try:
        job = f"vbp-{uuid.uuid4().hex}"
        transcribe.start_transcription_job(TranscriptionJobName=job, Media={"MediaFileUri": f"s3://{BUCKET}/{key}"}, MediaFormat="wav", LanguageCode="en-US")
        deadline = time.time() + 120
        while True:
            r = transcribe.get_transcription_job(TranscriptionJobName=job)["TranscriptionJob"]
            st = r["TranscriptionJobStatus"]
            if st in ("COMPLETED", "FAILED"): break
            if time.time() > deadline: raise TimeoutError("transcribe timed out")
            time.sleep(2)
        if st == "FAILED": raise RuntimeError(r.get("FailureReason", "transcription failed"))
        with urllib.request.urlopen(r["Transcript"]["TranscriptFileUri"]) as resp: data = json.load(resp)
        return data["results"]["transcripts"][0]["transcript"]
    finally:
        try: s3.delete_object(Bucket=BUCKET, Key=key)
        except Exception as e: print(f"warning: failed to delete s3://{BUCKET}/{key}: {e}")

def run_bedrock(scores, transcript):
    payload = json.dumps({"kintsugi_scores": scores, "transcript": transcript})
    r = bedrock.converse(modelId=MODEL, system=[{"text": SYSTEM}], messages=[{"role": "user", "content": [{"text": payload}]}], inferenceConfig={"maxTokens": 1200})
    txt = _unfence(r["output"]["message"]["content"][0]["text"])
    try: return json.loads(txt)
    except Exception: return {"summary": txt}

@asynccontextmanager
async def lifespan(app: FastAPI):
    ml["pipeline"] = Pipeline()
    yield
    ml.clear()

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def verify_origin(x_origin_verify: str = Header(default="")):
    if x_origin_verify != ORIGIN_SECRET: raise HTTPException(403, "Forbidden")

@app.get("/health", dependencies=[Depends(verify_origin)])
def health(): return {"status": "ok", "model_loaded": "pipeline" in ml}

@app.post("/analyze", dependencies=[Depends(verify_origin)])
async def analyze(file: UploadFile = File(...)):
    with tempfile.TemporaryDirectory() as d:
        src, wav = os.path.join(d, file.filename or "in"), os.path.join(d, "norm.wav")
        with open(src, "wb") as f: f.write(await file.read())
        try: subprocess.run(["ffmpeg", "-y", "-i", src, "-ac", "1", "-ar", "16000", wav], check=True, capture_output=True)
        except subprocess.CalledProcessError as e: raise HTTPException(400, f"ffmpeg failed: {e.stderr.decode()[-300:]}")
        t = time.time()
        scores, transcript = await asyncio.gather(asyncio.to_thread(run_kintsugi, wav), asyncio.to_thread(run_transcribe, wav))
        interpretation = await asyncio.to_thread(run_bedrock, scores, transcript)
        dt = round(time.time() - t, 2)
    return {**scores, "transcript": transcript, "interpretation": interpretation, "processing_seconds": dt}
