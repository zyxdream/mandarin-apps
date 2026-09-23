# SenseVoice INT8 versus FunASR: local ASR comparison

This branch replaces only the local ASR engine with sherpa-onnx SenseVoice INT8. It keeps the `/evaluate/local` request and response contract, VAD, pronunciation scoring, and the other API routes unchanged. The ONNX recognizer uses Chinese and `use_itn=False`, so spoken numbers remain Hanzi for scoring. This is a **synthetic-clip engineering comparison**, not evidence of accuracy on children's voices.

## What the benchmark replays

`backend/scripts/benchmark_local_asr.py` reads the generated sessions in `frontend/src/data/scriptSessions.generated.ts`. That file has **200** referenced word clips (not 203); all 200 are present. The runner also adds four wrong-target cases, for 204 cases total: 13 number words, 2 hard words (`井里`, `爬树`), 185 other correct-target words, 3 ordinary wrong-target cases, and 1 known scorer collision (`敬礼` spoken with `井里` as target). The latter is reported separately because the unchanged scorer accepts that close pair under either ASR engine.

Each MP3 is converted once, outside request timing, to the game's 16 kHz mono signed-16-bit PCM. The runner hashes both source MP3 and request PCM, builds fixed multipart bodies, and sends the same bytes and form fields to one backend at a time. The corpus manifest SHA-256 for the runs below is `e61a960d8af599ae79ca69877017b2b4ee4186919e8db0e07f01d90290f34428`. The candidate downloader verifies fixed SHA-256 values for both INT8 model files and the shared Silero VAD file.

The runner first calls `/evaluate/local/warmup` and makes five full evaluation requests that are excluded from latency statistics. The first full-request duration is reported separately because it may initialize VAD. It then records every measured HTTP response, transcript, score, decision, VAD skip, and client-observed elapsed time. “Exact transcript” strips punctuation and spaces but requires the remaining characters to match the spoken target; it is not a word-error-rate measure. The reported p95 is the nearest-rank percentile over valid measured responses. Invalid measured responses make the command fail while preserving diagnostic files. The container probe also checks its logs for actual VAD activity and no VAD failures, since the HTTP route can fall back if VAD is unavailable.

## Docker Desktop on this Mac

Docker Desktop runs a Linux virtual machine on macOS. A Docker *image* is the packaged backend and its dependencies; a *container* is one running instance of that image. These commands do not change your normal backend on port 8000. The probe maps Mac `127.0.0.1:8765` to container port 8000 and removes each temporary container after saving evidence.

From the repository root:

```sh
cd /Users/yuxiao/Documents/mandarin-apps
docker desktop start
docker info --format '{{.OSType}} {{.Architecture}} cgroup={{.CgroupVersion}}'
docker run --rm hello-world
python3 backend/scripts/download_sherpa_model.py
```

Docker Desktop may ask macOS permission to install its networking helper when it first starts. The `docker info` line should say `linux`, your VM architecture, and `cgroup=2`; `hello-world` should print a success message and remove its test container. If `docker info` cannot contact the server, open Docker Desktop and wait until it reports that its engine is running. The download script fills the ignored `backend/models/sensevoice-int8` directory and obtains the shared Silero VAD model. The FunASR baseline additionally needs the existing `backend/models/sensevoice-small` model files; the `master` version of `backend/scripts/download_sherpa_model.py` can download those with its `huggingface_hub` dependency. Models stay on the Mac and are mounted read-only into containers, not copied into the images.

Build one image from the clean `master` worktree and one from this branch. `git worktree list` shows whether the baseline worktree already exists; do not add it twice.

```sh
git worktree add ../mandarin-apps-funasr-baseline master
docker build -f "$PWD/backend/Dockerfile.benchmark" -t mandarin-funasr:baseline ../mandarin-apps-funasr-baseline/backend
docker build -f backend/Dockerfile.benchmark -t mandarin-sensevoice:int8 backend
```

`docker build` packages an image but does not start the backend. The Dockerfile-specific ignore file keeps the large local models, virtual environment, tests, and secrets out of the build context. Both images use the same Python 3.13 Linux base, ffmpeg, and single-worker backend command. The baseline image uses the unchanged `master` backend dependencies and ASR code; the candidate uses this branch's adapter and dependencies. `docker image ls --filter 'reference=mandarin-*'` lists the resulting images. Here their displayed sizes were 9.56 GB and 1.55 GB respectively; image size is disk storage, **not** peak RAM. Docker Desktop's Linux VM must have enough total memory for the 6 GiB comparison container plus its own overhead; the 512 MiB test itself does not need that large a VM allocation.

The probe starts fresh containers serially and measures cold time from `docker run` to `/health`. `--memory 512m --memory-swap 512m` means 512 MiB total RAM+swap allowance; the probe also verifies `memory.max=536870912` and `memory.swap.max=0` from Linux cgroup v2. It reads `memory.peak` and `memory.events` after startup and again after the final trial's HTTP requests. If a container dies during startup, Docker's `OOMKilled` and exit code are retained instead. This captures brief spikes that a live `docker stats` glance can miss.

```sh
backend/.venv/bin/python backend/scripts/probe_asr_container.py \
  --image mandarin-sensevoice:int8 --models-dir backend/models \
  --model-subdir sensevoice-int8 --memory 512m --startup-trials 3 \
  --repeats 1 --output-dir benchmark-results/onnx-512m-rerun
```

Use a new output directory for every run; the scripts refuse to overwrite an existing nonempty directory. To compare latency when both backends can actually run, use the same generous cap and replay count for each image, one probe at a time:

```sh
backend/.venv/bin/python backend/scripts/probe_asr_container.py \
  --image mandarin-funasr:baseline --models-dir backend/models \
  --model-subdir sensevoice-small --memory 6g --startup-trials 3 \
  --repeats 10 --output-dir benchmark-results/funasr-6g-rerun
backend/.venv/bin/python backend/scripts/probe_asr_container.py \
  --image mandarin-sensevoice:int8 --models-dir backend/models \
  --model-subdir sensevoice-int8 --memory 6g --startup-trials 3 \
  --repeats 10 --output-dir benchmark-results/onnx-6g-rerun
```

Start with a small repeat count if you only want a smoke test; FunASR takes much longer per clip. The host runner needs `ffmpeg` on your Mac for one-time corpus conversion. Inspect the saved evidence with, for example:

```sh
jq '{status, successful_startups, startup_median_seconds}' benchmark-results/onnx-6g-rerun/summary.json
jq '{memory_peak_bytes, memory_events}' benchmark-results/onnx-6g-rerun/trial-03/cgroup_after_requests.json
jq '.overall | {requests, errors, vad_skips, median_ms, p95_ms, false_rejects, false_accepts}' benchmark-results/onnx-6g-rerun/trial-03/benchmark/summary.json
```

`memory_peak_bytes / 1048576` gives MiB. The `requests.jsonl` file contains every response; `manifest.json` contains the payload hashes. The full backend logs and each trial's Docker state are retained next to the summaries.

## Results

These runs used Docker Desktop 4.38.0 on a Mac with a Linux ARM64 VM (Docker Engine 27.5.1, cgroup v2). The baseline image came from local `master` commit `8ec565d` (image ID `sha256:9870fd731c1e63ba8002386e8f3ef2323744c9f684b7fc18cbc57c084a79ebae`); the candidate came from the `sensevoice-onnx` working tree (image ID `sha256:b3a75d5a15e30b5f1aaea2b737042bfd72743be1222df3419c7b7597174b8346`). The shared VAD model SHA-256 was `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6`. The baseline `model.pt` SHA-256 was `833ca2dcfdf8ec91bd4f31cfac36d6124e0c459074d5e909aec9cabe6204a3ea`; the candidate `model.int8.onnx` SHA-256 was `c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51` and `tokens.txt` SHA-256 was `f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc`.

At **512 MiB with zero swap**, both images were OOM-killed before `/health` in all three startup trials (Docker `OOMKilled=true`, exit 137). No 512 MiB request or latency result exists; claiming success at that cap would be incorrect. At **1 GiB with zero swap**, the default ONNX backend started in all three trials (2.086-second median) and completed 204 measured requests, with `memory.peak` of 828–835 MiB across startup trials and no OOM events. On the final trial, the peak stayed at 831.7 MiB after requests. A sherpa-onnx CPU-arena-off experiment reduced that final peak to 810.7 MiB but still did not approach 512 MiB; it is not the default adapter setting. In a separate live-container diagnostic at 1 GiB, `memory.stat` reported about 588 MiB anonymous memory and 229 MiB file cache; turning off preload would only defer model allocation to the first request.

Both images then ran **one at a time at the same 6 GiB/no-swap cap**, with three fresh-container starts and ten measured replays of each of the 204 cases. Each produced 2,040/2,040 valid HTTP responses, zero VAD skips, and zero OOM events. Each final-trial log contained 2,045 successful VAD activity events (2,040 measured plus five warmups), with no VAD failure or unavailable events. Both had the same corpus SHA-256 above. In both final trials, `memory.peak` after requests was unchanged from the startup peak.

| Measurement | FunASR baseline | sherpa-onnx INT8 |
| --- | ---: | ---: |
| Fresh-container startup median (3 trials) | 7.290 s | 2.120 s |
| First full request, after ASR preload | 577.437 ms | 92.823 ms |
| Warm client response median | 426.582 ms | 80.123 ms |
| Warm client response p95 | 568.690 ms | 102.905 ms |
| Whole-container cgroup peak, final trial | 4.538 GiB | 832.5 MiB |
| Correct-target accepted | 1,905/2,000 | 1,900/2,000 |
| Exact normalized transcript | 85.34% | 82.84% |
| Three clear wrong-target cases rejected | 30/30 | 30/30 |
| Known `敬礼` → `井里` scorer collision accepted | 10/10 | 10/10 |

Thus the candidate was about **5.3× faster at the median and 5.5× at p95** for the complete HTTP evaluation, and about 5.6× lower in measured peak container memory. Synthetic decision accuracy was close: 94.85% for FunASR versus 94.61% for ONNX across all 204 cases including the known scorer collision. All 13 number clips and both hard words were accepted in every repetition by both versions. `井里` was transcribed as `锦鲤` rather than exact Hanzi in both versions, but unchanged phonetic scoring accepted it. `爬树` was transcribed exactly by both.

The small aggregate accuracy difference hides case swaps. ONNX consistently rejected `他`, `亮晶晶`, and `月` where FunASR accepted them; ONNX consistently accepted `不见`, `光明`, and `目` where FunASR rejected them. It also improved `行如风` (4/10 FunASR rejects, 0/10 ONNX) but worsened `风` (1/10 versus 10/10 rejects). These are repeated synthetic clips, not independent human samples, so the percentages should not be read as a statistical estimate of children's speech performance.

The decisive deployment conclusion is that this adapter is **not ready for a 512 MiB/no-swap container**, despite its large speed and memory improvement. A 1 GiB cap worked on this machine with roughly 190 MiB headroom over the observed peak; a production limit needs its own safety margin and testing on the target Linux architecture. Fresh-container timings include ASR preload but do not flush the Linux VM's file cache between trials. No children's recordings were included, as requested.

Evidence: `benchmark-results/funasr-512m/summary.json`, `benchmark-results/onnx-512m-final/summary.json`, `benchmark-results/onnx-1g/summary.json`, `benchmark-results/funasr-6g-10/summary.json`, and `benchmark-results/onnx-6g-10/summary.json`. Each 6 GiB run has its detailed HTTP `trial-03/benchmark/summary.json`, `requests.jsonl`, `manifest.json`, Docker log, and cgroup snapshots. These generated files are git-ignored but remain in this workspace.
