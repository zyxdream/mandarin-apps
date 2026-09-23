from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent
GENERATED_SESSIONS = REPO_ROOT / "frontend" / "src" / "data" / "scriptSessions.generated.ts"
PUBLIC_ROOT = REPO_ROOT / "frontend" / "public"
EXPECTED_GENERATED_WORD_COUNT = 200
FULL_REQUEST_WARMUPS = 5
NUMBER_HANZI = frozenset("零一二三四五六七八九十百千万两")
WRONG_TARGET_PAIRS = (
    ("wm-22-02-shi2", "wm-22-01-si4", "wrong_word"),
    ("wm-22-01-si4", "wm-22-02-shi2", "wrong_word"),
    ("wm-02-05-peng2you3", "wm-21-05-pa2shu4", "wrong_word"),
    ("wm-02-09-jing4li3", "wm-21-02-jing3li3", "known_scorer_collision"),
)


WORDS = [
    {"id": "ping2guo3", "hanzi": "苹果", "pinyin_raw": "ping2 guo3"},
    {"id": "yi1fu2", "hanzi": "衣服", "pinyin_raw": "yi1 fu2"},
    {"id": "cao3di4", "hanzi": "草地", "pinyin_raw": "cao3 di4"},
    {"id": "xiao3niao3", "hanzi": "小鸟", "pinyin_raw": "xiao3 niao3"},
    {"id": "hua1duo3", "hanzi": "花朵", "pinyin_raw": "hua1 duo3"},
    {"id": "liu3zhi1", "hanzi": "柳枝", "pinyin_raw": "liu3 zhi1"},
    {"id": "xue2xiao4", "hanzi": "学校", "pinyin_raw": "xue2 xiao4"},
    {"id": "lao3shi1", "hanzi": "老师", "pinyin_raw": "lao3 shi1"},
    {"id": "peng2you3", "hanzi": "朋友", "pinyin_raw": "peng2 you3"},
    {"id": "tian1qi4", "hanzi": "天气", "pinyin_raw": "tian1 qi4"},
    {"id": "shan1shui3", "hanzi": "山水", "pinyin_raw": "shan1 shui3"},
    {"id": "cheng2shi4", "hanzi": "城市", "pinyin_raw": "cheng2 shi4"},
    {"id": "chuang1hu4", "hanzi": "窗户", "pinyin_raw": "chuang1 hu4"},
    {"id": "huo3che1", "hanzi": "火车", "pinyin_raw": "huo3 che1"},
    {"id": "fei1ji1", "hanzi": "飞机", "pinyin_raw": "fei1 ji1"},
    {"id": "dian4nao3", "hanzi": "电脑", "pinyin_raw": "dian4 nao3"},
    {"id": "tu2shu1", "hanzi": "图书", "pinyin_raw": "tu2 shu1"},
    {"id": "lan2tian1", "hanzi": "蓝天", "pinyin_raw": "lan2 tian1"},
]


def find_audio(audio_dir: Path, word: dict[str, str]) -> Path | None:
    candidates = [
        word["id"],
        word["id"].replace(" ", ""),
        word["hanzi"],
        word["pinyin_raw"].replace(" ", ""),
        word["pinyin_raw"].replace(" ", "_"),
    ]
    for stem in candidates:
        for suffix in (".webm", ".wav", ".m4a", ".mp3"):
            path = audio_dir / f"{stem}{suffix}"
            if path.exists():
                return path
    return None


def benchmark(audio_dir: Path) -> list[dict[str, object]]:
    sys.path.append(str(BACKEND_ROOT))
    from local_asr import local_asr
    from routers.evaluate import score_transcript

    rows: list[dict[str, object]] = []
    for word in WORDS:
        audio_path = find_audio(audio_dir, word)
        if audio_path is None:
            rows.append({
                "word": word["hanzi"],
                "id": word["id"],
                "status": "missing_audio",
            })
            continue

        audio_bytes = audio_path.read_bytes()
        started_at = time.perf_counter()
        transcript = local_asr.transcribe_webm(audio_bytes, audio_path.name)
        asr_ms = int((time.perf_counter() - started_at) * 1000)
        success, confidence, transcript_pinyin, scores, diagnostics, hint_code, _ = score_transcript(
            transcript,
            word["hanzi"],
            word["pinyin_raw"],
            {"tone_contour": None},
            None,
            eval_mode="realtime",
        )
        rows.append({
            "word": word["hanzi"],
            "id": word["id"],
            "audio": str(audio_path),
            "transcript": transcript,
            "transcript_pinyin": transcript_pinyin,
            "success": success,
            "confidence": confidence,
            "scores": scores,
            "hint_code": hint_code,
            "asr_ms": asr_ms,
            "diagnostics": diagnostics,
        })
    return rows


def load_generated_words(
    sessions_path: Path = GENERATED_SESSIONS,
    public_root: Path = PUBLIC_ROOT,
    expected_count: int = EXPECTED_GENERATED_WORD_COUNT,
) -> list[dict[str, str | Path]]:
    """Read the JSON literal in the generated TS file without requiring Node."""
    source = sessions_path.read_text(encoding="utf-8")
    match = re.search(r"export const SCRIPT_SESSIONS:\s*ScriptSession\[\]\s*=\s*", source)
    if match is None:
        raise ValueError(f"Cannot find SCRIPT_SESSIONS in {sessions_path}")
    sessions, end = json.JSONDecoder().raw_decode(source[match.end():])
    if source[match.end() + end:].strip() != ";" or not isinstance(sessions, list):
        raise ValueError(f"Unexpected generated session format in {sessions_path}")

    words: list[dict[str, str | Path]] = []
    ids: set[str] = set()
    for session in sessions:
        for raw_word in session["words"]:
            word_id = raw_word["id"]
            audio_url = raw_word["audioUrl"]
            if word_id in ids:
                raise ValueError(f"Duplicate generated word id: {word_id}")
            if not audio_url.startswith("/audio/script_content/generated/words/"):
                raise ValueError(f"Unexpected generated audio URL: {audio_url}")
            audio_path = (public_root / audio_url.lstrip("/")).resolve()
            if not audio_path.is_relative_to(public_root.resolve()) or not audio_path.is_file():
                raise FileNotFoundError(f"Missing generated word clip: {audio_path}")
            ids.add(word_id)
            words.append({
                "id": word_id,
                "hanzi": raw_word["hanzi"],
                "pinyin_raw": raw_word["pinyinRaw"],
                "audio_url": audio_url,
                "audio_path": audio_path,
            })
    if len(words) != expected_count:
        raise ValueError(f"Expected {expected_count} generated words; found {len(words)}")
    return words


def build_http_cases(words: list[dict[str, str | Path]]) -> list[dict[str, str | Path | bool]]:
    by_id = {str(word["id"]): word for word in words}
    cases: list[dict[str, str | Path | bool]] = []
    for word in words:
        hanzi = str(word["hanzi"])
        if hanzi in {"井里", "爬树"}:
            category = "hard_word"
        elif hanzi and all(character in NUMBER_HANZI for character in hanzi):
            category = "number"
        else:
            category = "ordinary"
        cases.append({
            "case_id": str(word["id"]),
            "category": category,
            "spoken_hanzi": hanzi,
            "source_id": str(word["id"]),
            "audio_url": str(word["audio_url"]),
            "audio_path": word["audio_path"],
            "target_id": str(word["id"]),
            "target_hanzi": hanzi,
            "target_pinyin_raw": str(word["pinyin_raw"]),
            "expected_accept": True,
        })
    for source_id, target_id, category in WRONG_TARGET_PAIRS:
        if source_id not in by_id or target_id not in by_id:
            raise ValueError(f"Wrong-target pair missing from generated words: {source_id} -> {target_id}")
        source = by_id[source_id]
        target = by_id[target_id]
        cases.append({
            "case_id": f"{source_id}__to__{target_id}",
            "category": category,
            "spoken_hanzi": str(source["hanzi"]),
            "source_id": source_id,
            "audio_url": str(source["audio_url"]),
            "audio_path": source["audio_path"],
            "target_id": target_id,
            "target_hanzi": str(target["hanzi"]),
            "target_pinyin_raw": str(target["pinyin_raw"]),
            "expected_accept": False,
        })
    return cases


def convert_mp3_to_pcm(audio_path: Path) -> bytes:
    command = [
        "ffmpeg", "-nostdin", "-v", "error", "-i", str(audio_path),
        "-f", "s16le", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", "pipe:1",
    ]
    try:
        result = subprocess.run(command, check=True, capture_output=True)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg is required to convert generated MP3 clips to game-format PCM") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"ffmpeg failed for {audio_path}: {exc.stderr.decode(errors='replace')}") from exc
    if not result.stdout or len(result.stdout) % 2:
        raise RuntimeError(f"ffmpeg produced invalid 16-bit PCM for {audio_path}")
    return result.stdout


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def prepare_http_cases(cases: list[dict[str, str | Path | bool]]) -> tuple[list[dict[str, object]], dict[str, bytes], str]:
    audio_by_source: dict[str, bytes] = {}
    source_hashes: dict[str, str] = {}
    pcm_hashes: dict[str, str] = {}
    manifest: list[dict[str, object]] = []
    for case in cases:
        source_id = str(case["source_id"])
        audio_path = case["audio_path"]
        assert isinstance(audio_path, Path)
        if source_id not in audio_by_source:
            source_bytes = audio_path.read_bytes()
            audio_by_source[source_id] = convert_mp3_to_pcm(audio_path)
            source_hashes[source_id] = sha256(source_bytes)
            pcm_hashes[source_id] = sha256(audio_by_source[source_id])
        manifest.append({
            key: value for key, value in case.items() if key != "audio_path"
        } | {
            "source_mp3_sha256": source_hashes[source_id],
            "request_pcm_sha256": pcm_hashes[source_id],
            "request_pcm_bytes": len(audio_by_source[source_id]),
        })
    manifest_hash = sha256(json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode("utf-8"))
    return manifest, audio_by_source, manifest_hash


def build_multipart_body(case: dict[str, object], pcm: bytes) -> tuple[bytes, str]:
    boundary = f"----mandarin-asr-benchmark-{sha256(str(case['case_id']).encode())[:16]}"
    fields = {
        "word_id": str(case["target_id"]),
        "pinyin_raw": str(case["target_pinyin_raw"]),
        "hanzi": str(case["target_hanzi"]),
        "eval_mode": "realtime",
        "audio_format": "pcm_s16le",
        "sample_rate": "16000",
        "channels": "1",
    }
    chunks = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"recording.pcm\"\r\nContent-Type: application/octet-stream\r\n\r\n".encode("ascii"),
        pcm,
        b"\r\n",
    ]
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode("utf-8"))
    chunks.append(f"--{boundary}--\r\n".encode("ascii"))
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def request_json(url: str, timeout: float, body: bytes | None = None, content_type: str | None = None) -> dict[str, object]:
    headers = {"Accept": "application/json"}
    if content_type:
        headers["Content-Type"] = content_type
    request = Request(url, data=body, headers=headers, method="POST" if body is not None else "GET")
    started_at = time.perf_counter()
    status: int | None = None
    response_bytes = b""
    error: str | None = None
    try:
        with urlopen(request, timeout=timeout) as response:
            status = response.status
            response_bytes = response.read()
    except HTTPError as exc:
        status = exc.code
        response_bytes = exc.read()
        error = str(exc)
    except (URLError, TimeoutError, OSError) as exc:
        error = str(exc)
    try:
        response_json = json.loads(response_bytes) if response_bytes else None
    except json.JSONDecodeError:
        response_json = None
        error = error or "Response was not valid JSON"
    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 3)
    return {
        "http_status": status,
        "elapsed_ms": elapsed_ms,
        "response": response_json,
        "response_text": response_bytes.decode("utf-8", errors="replace") if response_json is None else None,
        "error": error,
    }


def normalized_transcript(text: str) -> str:
    return "".join(character for character in text if "\u3400" <= character <= "\u9fff" or character.isascii() and character.isalnum())


def make_request_row(case: dict[str, object], phase: str, iteration: int, result: dict[str, object]) -> dict[str, object]:
    response = result["response"] if isinstance(result["response"], dict) else {}
    success = response.get("success") if isinstance(response.get("success"), bool) else None
    transcript = response.get("transcript") if isinstance(response.get("transcript"), str) else ""
    hint_code = response.get("hint_code")
    valid = result["http_status"] == 200 and success is not None
    vad_skipped = valid and hint_code == "too_quiet"
    return {
        "phase": phase,
        "iteration": iteration,
        "case_id": case["case_id"],
        "category": case["category"],
        "source_id": case["source_id"],
        "spoken_hanzi": case["spoken_hanzi"],
        "target_id": case["target_id"],
        "target_hanzi": case["target_hanzi"],
        "target_pinyin_raw": case["target_pinyin_raw"],
        "expected_accept": case["expected_accept"],
        "request_pcm_sha256": case["request_pcm_sha256"],
        "http_status": result["http_status"],
        "elapsed_ms": result["elapsed_ms"],
        "valid_response": valid,
        "vad_skipped": vad_skipped,
        "success": success,
        "decision_correct": success == case["expected_accept"] if valid else None,
        "transcript": transcript,
        "transcript_exact": normalized_transcript(transcript) == normalized_transcript(str(case["spoken_hanzi"])) if valid and not vad_skipped else None,
        "confidence": response.get("confidence"),
        "hint_code": hint_code,
        "response": result["response"],
        "response_text": result["response_text"],
        "error": result["error"] or ("Missing success field" if result["http_status"] == 200 and success is None else None),
    }


def latency_summary(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"median_ms": None, "p95_ms": None}
    sorted_values = sorted(values)
    return {
        "median_ms": round(statistics.median(sorted_values), 3),
        "p95_ms": round(sorted_values[math.ceil(0.95 * len(sorted_values)) - 1], 3),
    }


def summarize_rows(rows: list[dict[str, object]]) -> dict[str, object]:
    valid = [row for row in rows if row["valid_response"]]
    asr_reached = [row for row in valid if not row["vad_skipped"]]
    exact = [row for row in asr_reached if row["transcript_exact"]]
    correct = [row for row in valid if row["decision_correct"]]
    correct_asr = [row for row in asr_reached if row["decision_correct"]]
    result: dict[str, object] = {
        "requests": len(rows),
        "valid_responses": len(valid),
        "errors": len(rows) - len(valid),
        "vad_skips": len(valid) - len(asr_reached),
        "asr_reached": len(asr_reached),
        "accepted": sum(row["success"] is True for row in valid),
        "false_rejects": sum(row["expected_accept"] is True and row["success"] is False for row in valid),
        "false_accepts": sum(row["expected_accept"] is False and row["success"] is True for row in valid),
        "decision_accuracy_all": round(len(correct) / len(valid), 4) if valid else None,
        "decision_accuracy_asr_reached": round(len(correct_asr) / len(asr_reached), 4) if asr_reached else None,
        "transcript_exact_rate_asr_reached": round(len(exact) / len(asr_reached), 4) if asr_reached else None,
    }
    result.update(latency_summary([float(row["elapsed_ms"]) for row in valid]))
    return result


RAW_CSV_FIELDS = (
    "phase", "iteration", "case_id", "category", "source_id", "spoken_hanzi", "target_id",
    "target_hanzi", "target_pinyin_raw", "expected_accept", "request_pcm_sha256", "http_status",
    "elapsed_ms", "valid_response", "vad_skipped", "success", "decision_correct", "transcript",
    "transcript_exact", "confidence", "hint_code", "response_json", "response_text", "error",
)


def write_request_row(jsonl_file, csv_writer: csv.DictWriter, row: dict[str, object]) -> None:
    jsonl_file.write(json.dumps(row, ensure_ascii=False) + "\n")
    jsonl_file.flush()
    flat = {key: value for key, value in row.items() if key != "response"}
    flat["response_json"] = json.dumps(row["response"], ensure_ascii=False) if row["response"] is not None else ""
    csv_writer.writerow(flat)


def benchmark_http(base_url: str, repeats: int, output_dir: Path, timeout: float = 120.0) -> dict[str, object]:
    if output_dir.exists() and any(output_dir.iterdir()):
        raise FileExistsError(f"Benchmark output directory is not empty: {output_dir}")
    words = load_generated_words()
    cases = build_http_cases(words)
    manifest, pcm_by_source, corpus_sha256 = prepare_http_cases(cases)
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "manifest.json").write_text(json.dumps({
        "corpus_sha256": corpus_sha256,
        "generated_word_cases": len(words),
        "wrong_target_cases": len(cases) - len(words),
        "cases": manifest,
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    origin = base_url.rstrip("/")
    warmup = request_json(f"{origin}/evaluate/local/warmup", max(timeout, 300.0))
    (output_dir / "warmup.json").write_text(json.dumps(warmup, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if warmup["http_status"] != 200 or not isinstance(warmup["response"], dict) or not warmup["response"].get("ready"):
        raise RuntimeError(f"ASR warmup failed; see {output_dir / 'warmup.json'}")

    payloads = {
        str(case["case_id"]): build_multipart_body(case, pcm_by_source[str(case["source_id"])])
        for case in manifest
    }
    measured_rows: list[dict[str, object]] = []
    warmup_rows: list[dict[str, object]] = []
    with (output_dir / "requests.jsonl").open("w", encoding="utf-8") as jsonl_file, (output_dir / "requests.csv").open("w", encoding="utf-8", newline="") as csv_file:
        csv_writer = csv.DictWriter(csv_file, fieldnames=RAW_CSV_FIELDS)
        csv_writer.writeheader()

        first_case = manifest[0]
        warmup_body, warmup_type = payloads[str(first_case["case_id"])]
        for warmup_index in range(1, FULL_REQUEST_WARMUPS + 1):
            warmup_result = request_json(f"{origin}/evaluate/local", timeout, warmup_body, warmup_type)
            warmup_row = make_request_row(first_case, "warmup", warmup_index, warmup_result)
            write_request_row(jsonl_file, csv_writer, warmup_row)
            warmup_rows.append(warmup_row)
            if not warmup_row["valid_response"]:
                raise RuntimeError(f"Full evaluation warmup {warmup_index} failed; see {output_dir / 'requests.jsonl'}")

        for iteration in range(1, repeats + 1):
            for case in manifest:
                body, content_type = payloads[str(case["case_id"])]
                result = request_json(f"{origin}/evaluate/local", timeout, body, content_type)
                row = make_request_row(case, "measured", iteration, result)
                write_request_row(jsonl_file, csv_writer, row)
                measured_rows.append(row)
            print(f"Completed pass {iteration}/{repeats}", file=sys.stderr, flush=True)

    case_summaries = []
    for case in manifest:
        case_rows = [row for row in measured_rows if row["case_id"] == case["case_id"]]
        case_summaries.append({
            "scope": "case",
            "id": case["case_id"],
            "category": case["category"],
            "spoken_hanzi": case["spoken_hanzi"],
            "target_hanzi": case["target_hanzi"],
            "expected_accept": case["expected_accept"],
            **summarize_rows(case_rows),
        })
    category_summaries = []
    for category in sorted({str(case["category"]) for case in manifest}):
        category_rows = [row for row in measured_rows if row["category"] == category]
        category_summaries.append({"scope": "category", "id": category, "category": category, **summarize_rows(category_rows)})
    overall = {"scope": "overall", "id": "all", "category": "all", **summarize_rows(measured_rows)}
    summary = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "base_url": origin,
        "corpus_sha256": corpus_sha256,
        "generated_word_cases": len(words),
        "wrong_target_cases": len(cases) - len(words),
        "repeats": repeats,
        "excluded_full_request_warmups": FULL_REQUEST_WARMUPS,
        "first_full_request_ms": warmup_rows[0]["elapsed_ms"],
        "percentile_method": "nearest_rank",
        "latency_scope": "client request through complete JSON response, valid HTTP evaluations only",
        "overall": overall,
        "categories": category_summaries,
        "cases": case_summaries,
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary_rows = [overall, *category_summaries, *case_summaries]
    with (output_dir / "summary.csv").open("w", encoding="utf-8", newline="") as csv_file:
        fieldnames = list(dict.fromkeys(key for row in summary_rows for key in row))
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(summary_rows)
    return {key: value for key, value in summary.items() if key != "cases"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark local ASR directly or replay the generated game corpus over HTTP.")
    parser.add_argument(
        "--audio-dir",
        type=Path,
        help="Directory containing recordings named by word id, Hanzi, or pinyin, e.g. ping2guo3.webm or 苹果.webm.",
    )
    parser.add_argument("--base-url", help="Backend origin for paired HTTP replay, e.g. http://127.0.0.1:8000")
    parser.add_argument("--repeats", type=int, default=30, help="Measured requests per case in HTTP mode (default: 30).")
    parser.add_argument("--output-dir", type=Path, help="Directory for HTTP manifest, raw responses, and summaries.")
    parser.add_argument("--timeout", type=float, default=120.0, help="Per-request timeout in seconds (default: 120).")
    args = parser.parse_args()

    if args.base_url:
        if args.audio_dir:
            parser.error("--audio-dir and --base-url are separate modes")
        if not args.output_dir:
            parser.error("--output-dir is required with --base-url")
        if args.repeats < 1:
            parser.error("--repeats must be at least 1")
        if args.timeout <= 0:
            parser.error("--timeout must be positive")
        summary = benchmark_http(args.base_url, args.repeats, args.output_dir, args.timeout)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if summary["overall"]["errors"]:
            raise SystemExit("Benchmark had invalid measured HTTP responses; see requests.jsonl and summary.json")
        return

    if not args.audio_dir:
        parser.error("choose --audio-dir for direct mode or --base-url and --output-dir for HTTP mode")
    sys.path.append(str(BACKEND_ROOT))
    from local_asr import LocalAsrUnavailable

    try:
        rows = benchmark(args.audio_dir)
    except LocalAsrUnavailable as exc:
        raise SystemExit(f"Local ASR unavailable: {exc}") from exc
    print(json.dumps(rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
