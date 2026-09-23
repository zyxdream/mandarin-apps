import argparse
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import probe_asr_container as probe


CGROUP_OUTPUT = """\
>>>memory.max
536870912
>>>memory.swap.max
0
>>>memory.peak
312475648
>>>memory.events
low 0
high 0
max 0
oom 0
oom_kill 0
"""


class ProbeCgroupTests(unittest.TestCase):
    def test_reads_cgroup_v2_inside_the_container(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=CGROUP_OUTPUT, stderr=""
        )
        with patch.object(probe.subprocess, "run", return_value=completed) as run:
            snapshot = probe.read_cgroup("candidate", 536870912)

        self.assertEqual(run.call_args.args[0][:4], ["docker", "exec", "candidate", "sh"])
        self.assertEqual(snapshot["memory_max_bytes"], 536870912)
        self.assertEqual(snapshot["memory_swap_max_bytes"], 0)
        self.assertEqual(snapshot["memory_peak_bytes"], 312475648)
        self.assertEqual(snapshot["memory_events"]["oom_kill"], 0)

    def test_missing_cgroup_v2_file_fails_clearly(self) -> None:
        completed = subprocess.CompletedProcess(
            args=[], returncode=2, stdout="",
            stderr="Missing cgroup v2 file: /sys/fs/cgroup/memory.peak",
        )
        with patch.object(probe.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(probe.CgroupError, "memory.peak"):
                probe.read_cgroup("candidate", 536870912)

    def test_docker_unavailable_fails_before_starting_a_trial(self) -> None:
        with patch.object(probe.subprocess, "run", side_effect=FileNotFoundError):
            with self.assertRaisesRegex(probe.ProbeError, "Start Docker Desktop"):
                probe.preflight(8765)


class ProbeTrialTests(unittest.TestCase):
    def test_final_trial_limits_memory_and_runs_http_benchmark(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir)
            models_dir = output_dir / "models"
            models_dir.mkdir()
            args = argparse.Namespace(
                image="candidate:latest", model_subdir="sensevoice-int8",
                port=8765, memory="512m", startup_trials=1, startup_timeout=30.0,
                repeats=2, request_timeout=15.0, provider_config=None,
            )
            calls = []

            def fake_docker(*argv, timeout=None):
                calls.append(argv)
                if argv[0] == "run":
                    return "container-id"
                if argv[0] == "exec":
                    return CGROUP_OUTPUT
                if argv[0] == "inspect" and argv[2] == "{{json .State}}":
                    return json.dumps({"Running": True, "OOMKilled": False, "ExitCode": 0})
                if argv[0] == "inspect" and argv[2] == "{{json .HostConfig}}":
                    return json.dumps({"Memory": 536870912, "MemorySwap": 536870912})
                if argv[:2] == ("rm", "--force"):
                    return "container-id"
                raise AssertionError(f"Unexpected Docker command: {argv}")

            def fake_logs(_name, path):
                path.write_text("[evaluate][debug] {'stage': 'local_vad_activity'}\n", encoding="utf-8")

            with patch.object(probe, "docker", side_effect=fake_docker), (
                patch.object(probe, "health_ready", return_value=True)
            ), patch.object(probe, "save_logs", side_effect=fake_logs), patch.object(
                probe, "run_benchmark", return_value=0
            ) as benchmark:
                result = probe.run_trial(args, 1, output_dir, models_dir)

            run_args = next(call for call in calls if call[0] == "run")
            self.assertEqual(result["status"], "ok")
            self.assertTrue(result["container_removed"])
            self.assertEqual(result["vad_log_check"]["activity_events"], 1)
            self.assertIn("--memory", run_args)
            self.assertEqual(run_args[run_args.index("--memory") + 1], "512m")
            self.assertEqual(run_args[run_args.index("--memory-swap") + 1], "512m")
            self.assertIn(
                f"type=bind,src={models_dir},dst=/app/backend/models,readonly",
                run_args,
            )
            self.assertIn("LOCAL_ASR_PRELOAD=true", run_args)
            benchmark.assert_called_once()
            self.assertTrue((output_dir / "trial-01" / "cgroup_after_startup.json").is_file())
            self.assertTrue((output_dir / "trial-01" / "cgroup_after_requests.json").is_file())
            self.assertTrue((output_dir / "trial-01" / "trial.json").is_file())


if __name__ == "__main__":
    unittest.main()
