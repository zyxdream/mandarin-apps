import sys
import tempfile
import threading
import unittest
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from benchmark_local_asr import (
    EXPECTED_GENERATED_WORD_COUNT,
    build_http_cases,
    build_multipart_body,
    benchmark_http,
    latency_summary,
    load_generated_words,
    make_request_row,
    prepare_http_cases,
    sha256,
    summarize_rows,
)


class BenchmarkCorpusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.words = load_generated_words()
        cls.cases = build_http_cases(cls.words)

    def test_generated_corpus_and_wrong_target_cases_are_paired(self) -> None:
        self.assertEqual(len(self.words), EXPECTED_GENERATED_WORD_COUNT)
        self.assertEqual(len(self.cases), EXPECTED_GENERATED_WORD_COUNT + 4)
        self.assertEqual(len({case["case_id"] for case in self.cases}), len(self.cases))
        by_id = {case["case_id"]: case for case in self.cases}
        self.assertEqual(by_id["wm-21-02-jing3li3"]["target_hanzi"], "井里")
        self.assertEqual(by_id["wm-21-05-pa2shu4"]["target_hanzi"], "爬树")
        self.assertEqual(by_id["wm-22-03-shi2si4"]["category"], "number")
        wrong = by_id["wm-22-02-shi2__to__wm-22-01-si4"]
        self.assertEqual((wrong["spoken_hanzi"], wrong["target_hanzi"]), ("十", "四"))
        self.assertFalse(wrong["expected_accept"])
        collision = by_id["wm-02-09-jing4li3__to__wm-21-02-jing3li3"]
        self.assertEqual(collision["category"], "known_scorer_collision")
        self.assertEqual(collision["audio_path"], by_id["wm-02-09-jing4li3"]["audio_path"])

    def test_manifest_hash_tracks_the_exact_audio_payload(self) -> None:
        import benchmark_local_asr
        from unittest.mock import patch

        with patch.object(benchmark_local_asr, "convert_mp3_to_pcm", return_value=b"\x01\x00") as convert:
            manifest, audio_by_source, corpus_hash = prepare_http_cases(self.cases)
        self.assertEqual(convert.call_count, EXPECTED_GENERATED_WORD_COUNT)
        self.assertEqual(len(audio_by_source), EXPECTED_GENERATED_WORD_COUNT)
        self.assertEqual(len(corpus_hash), 64)
        self.assertEqual(manifest[0]["request_pcm_bytes"], 2)
        self.assertEqual(manifest[0]["source_mp3_sha256"], sha256(self.words[0]["audio_path"].read_bytes()))
        self.assertNotIn("audio_path", manifest[0])
        self.assertEqual(
            manifest[-1]["request_pcm_sha256"],
            next(case["request_pcm_sha256"] for case in manifest if case["case_id"] == "wm-02-09-jing4li3"),
        )

    def test_multipart_request_matches_frontend_fields(self) -> None:
        case = self.cases[0]
        pcm = b"\x01\x00\xfe\xff"
        body, content_type = build_multipart_body(case, pcm)
        message = BytesParser(policy=policy.default).parsebytes(
            f"MIME-Version: 1.0\r\nContent-Type: {content_type}\r\n\r\n".encode() + body
        )
        parts = {part.get_param("name", header="content-disposition"): part for part in message.iter_parts()}
        self.assertEqual(parts["audio"].get_payload(decode=True), pcm)
        self.assertEqual(parts["audio"].get_filename(), "recording.pcm")
        self.assertEqual(parts["word_id"].get_payload(decode=True).decode(), case["target_id"])
        self.assertEqual(parts["pinyin_raw"].get_payload(decode=True).decode(), case["target_pinyin_raw"])
        self.assertEqual(parts["hanzi"].get_payload(decode=True).decode(), case["target_hanzi"])
        self.assertEqual(parts["eval_mode"].get_payload(decode=True).decode(), "realtime")
        self.assertEqual(parts["audio_format"].get_payload(decode=True).decode(), "pcm_s16le")
        self.assertEqual(parts["sample_rate"].get_payload(decode=True).decode(), "16000")
        self.assertEqual(parts["channels"].get_payload(decode=True).decode(), "1")


class BenchmarkSummaryTests(unittest.TestCase):
    def test_vad_skips_are_reported_separately_from_asr_decisions(self) -> None:
        positive = {
            "case_id": "positive", "category": "ordinary", "source_id": "positive",
            "spoken_hanzi": "朋友", "target_id": "positive", "target_hanzi": "朋友",
            "target_pinyin_raw": "peng2 you3", "expected_accept": True,
            "request_pcm_sha256": "abc",
        }
        negative = {**positive, "case_id": "negative", "target_hanzi": "爬树", "expected_accept": False}

        def row(case, success, transcript, hint_code, elapsed_ms):
            return make_request_row(case, "measured", 1, {
                "http_status": 200,
                "elapsed_ms": elapsed_ms,
                "response": {"success": success, "transcript": transcript, "hint_code": hint_code},
                "response_text": None,
                "error": None,
            })

        rows = [
            row(positive, True, "朋友", None, 10),
            row(positive, False, "", "too_quiet", 20),
            row(negative, True, "朋友", None, 30),
        ]
        summary = summarize_rows(rows)
        self.assertEqual(summary["vad_skips"], 1)
        self.assertEqual(summary["asr_reached"], 2)
        self.assertEqual(summary["false_rejects"], 1)
        self.assertEqual(summary["false_accepts"], 1)
        self.assertEqual(summary["decision_accuracy_all"], 0.3333)
        self.assertEqual(summary["decision_accuracy_asr_reached"], 0.5)
        self.assertEqual(summary["transcript_exact_rate_asr_reached"], 1.0)
        self.assertEqual(summary["median_ms"], 20)
        self.assertEqual(summary["p95_ms"], 30)

    def test_p95_uses_nearest_rank(self) -> None:
        self.assertEqual(latency_summary(list(range(1, 31))), {"median_ms": 15.5, "p95_ms": 29})
        self.assertEqual(latency_summary([]), {"median_ms": None, "p95_ms": None})


class BenchmarkHttpTests(unittest.TestCase):
    def test_cli_fails_if_measured_http_responses_are_invalid(self) -> None:
        import benchmark_local_asr

        argv = ["benchmark_local_asr.py", "--base-url", "http://127.0.0.1:8765", "--output-dir", "unused"]
        with patch.object(sys, "argv", argv), patch.object(
            benchmark_local_asr, "benchmark_http", return_value={"overall": {"errors": 1}}
        ):
            with self.assertRaisesRegex(SystemExit, "invalid measured HTTP responses"):
                benchmark_local_asr.main()

    def test_five_full_warmups_are_excluded_from_report(self) -> None:
        import benchmark_local_asr

        class FakeBackend(BaseHTTPRequestHandler):
            def do_GET(self):
                self.respond({"ready": True, "elapsed_ms": 1})

            def do_POST(self):
                size = int(self.headers["Content-Length"])
                self.rfile.read(size)
                self.respond({"success": True, "transcript": "朋友", "confidence": 1.0, "hint_code": None})

            def respond(self, value):
                import json

                payload = json.dumps(value).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, format, *args):
                pass

        word = {"id": "friend", "hanzi": "朋友", "pinyin_raw": "peng2 you3"}
        case = {
            "case_id": "friend", "category": "ordinary", "source_id": "friend",
            "spoken_hanzi": "朋友", "target_id": "friend", "target_hanzi": "朋友",
            "target_pinyin_raw": "peng2 you3", "expected_accept": True,
            "request_pcm_sha256": "abc",
        }
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeBackend)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory, \
                    patch.object(benchmark_local_asr, "load_generated_words", return_value=[word]), \
                    patch.object(benchmark_local_asr, "build_http_cases", return_value=[case]), \
                    patch.object(benchmark_local_asr, "prepare_http_cases", return_value=([case], {"friend": b"\x01\x00"}, "corpus-hash")):
                output = Path(directory) / "run"
                summary = benchmark_http(f"http://127.0.0.1:{server.server_port}", 1, output, 5.0)
                self.assertEqual(summary["excluded_full_request_warmups"], 5)
                self.assertIsInstance(summary["first_full_request_ms"], float)
                self.assertEqual(summary["overall"]["requests"], 1)
                self.assertEqual(summary["overall"]["valid_responses"], 1)
                rows = (output / "requests.jsonl").read_text().splitlines()
                self.assertEqual(len(rows), 6)
                self.assertEqual(sum('"phase": "warmup"' in row for row in rows), 5)
                self.assertTrue((output / "manifest.json").is_file())
                self.assertTrue((output / "requests.csv").is_file())
                self.assertTrue((output / "summary.csv").is_file())
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
