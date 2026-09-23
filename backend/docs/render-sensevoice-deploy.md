# SenseVoice Render trial

Deploy this branch as a **separate** Render web service so the current backend
and Vercel production site remain unchanged while testing.

1. Push `sensevoice-onnx` to the Git repository connected to Render. Create a
   new Render **Web Service** from that branch. Select **Docker**, set **Root
   Directory** to `backend`, and **Dockerfile Path** to `Dockerfile.render`.
   Use the **2 GB (`1c-2g`, formerly Standard)** compute plan for the initial
   trial, and set **Health Check Path** to `/health`. The 512 MB plans failed
   the local no-swap startup test.
2. Set the Render environment variable `CORS_ORIGINS` to the exact Vercel
   preview origin, for example `https://your-branch-preview.vercel.app` (no
   path or trailing slash). Leave `LOCAL_ASR_PRELOAD` enabled. No model disk
   mount is needed: the Docker build downloads the checksum-verified
   `model.int8.onnx`, `tokens.txt`, and `silero_vad.onnx` into the image.
3. Once Render is live, visit `https://<service>.onrender.com/health` and
   `https://<service>.onrender.com/evaluate/local/warmup`. The `/health`
   response alone is not a substitute for a real audio scoring request.
4. In Vercel, set the `sensevoice-onnx` branch's **Preview** variable
   `VITE_API_URL` to `https://<service>.onrender.com` (no trailing slash),
   then redeploy that preview. `VITE_EVALUATE_PATH` can remain unset; its
   default is `/evaluate/local`. Test recording and scoring in the preview
   before changing any Production settings.

For local Docker smoke testing from the repository root:

```sh
docker build -f backend/Dockerfile.render -t mandarin-sensevoice:render backend
docker run --rm -p 10000:10000 --memory 2g --memory-swap 2g mandarin-sensevoice:render
```

The image installs `ffmpeg`, packages the two models at build time, and starts
one Uvicorn worker on Render's `PORT` (default `10000`). The browser sends
audio directly to the new Render HTTPS URL. This trial does not establish
multi-user throughput or children's-speech accuracy; load-test separately.
