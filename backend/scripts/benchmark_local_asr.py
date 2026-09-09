from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from local_asr import LocalAsrUnavailable, local_asr
from routers.evaluate import score_transcript


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


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark local ASR against the game word list.")
    parser.add_argument(
        "--audio-dir",
        type=Path,
        required=True,
        help="Directory containing recordings named by word id, Hanzi, or pinyin, e.g. ping2guo3.webm or 苹果.webm.",
    )
    args = parser.parse_args()

    try:
        rows = benchmark(args.audio_dir)
    except LocalAsrUnavailable as exc:
        raise SystemExit(f"Local ASR unavailable: {exc}") from exc

    print(json.dumps(rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
