"""Measure cold backend startup and cgroup v2 memory in a capped Docker container.

Example:
    python backend/scripts/probe_asr_container.py \
      --image mandarin-asr:onnx --models-dir backend/models \
      --model-subdir sensevoice-int8 --output-dir benchmark-results/onnx \
      --repeats 3

The HTTP corpus benchmark runs on the host against the final startup trial.
Each trial uses a fresh container, with only one container running at a time.
"""

from __future__ import annotations

import argparse
import json
import math
import socket
import statistics
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


BENCHMARK_SCRIPT = Path(__file__).with_name("benchmark_local_asr.py")
CGROUP_FILES = ("memory.max", "memory.swap.max", "memory.peak", "memory.events")
CGROUP_READ_SCRIPT = """
for file in memory.max memory.swap.max memory.peak memory.events; do
    path="/sys/fs/cgroup/$file"
    if [ ! -r "$path" ]; then
        printf 'Missing cgroup v2 file: %s\\n' "$path" >&2
        exit 2
    fi
    printf '>>>%s\\n' "$file"
    while IFS= read -r line || [ -n "$line" ]; do
        printf '%s\\n' "$line"
    done < "$path"
done
"""


class ProbeError(RuntimeError):
    pass


class CgroupError(ProbeError):
    pass


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def command(args: list[str], *, timeout: float | None = None) -> str:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError as exc:
        raise ProbeError(f"Command not found: {args[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise ProbeError(f"Command timed out: {' '.join(args[:3])}") from exc
    if result.returncode:
        detail = (result.stderr or result.stdout).strip()
        raise ProbeError(f"Command failed ({result.returncode}): {' '.join(args[:3])}: {detail}")
    return result.stdout.strip()


def docker(*args: str, timeout: float | None = None) -> str:
    return command(["docker", *args], timeout=timeout)


def preflight(port: int) -> dict[str, str]:
    try:
        server_version = docker("version", "--format", "{{.Server.Version}}", timeout=15)
        cgroup_version = docker("info", "--format", "{{.CgroupVersion}}", timeout=15)
        server_architecture = docker("info", "--format", "{{.Architecture}}", timeout=15)
    except ProbeError as exc:
        raise ProbeError(f"Docker is unavailable. Start Docker Desktop and retry. {exc}") from exc
    if not server_version:
        raise ProbeError("Docker did not report a server version. Start Docker Desktop and retry.")
    if cgroup_version != "2":
        raise CgroupError(f"Docker must use cgroup v2 for memory.peak; reported version {cgroup_version!r}")
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            # A just-removed Docker port mapping can leave connections in
            # TIME_WAIT; that is not an active listener blocking this port.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", port))
    except OSError as exc:
        raise ProbeError(f"Host port {port} is unavailable: {exc}") from exc
    return {
        "docker_server_version": server_version,
        "docker_server_architecture": server_architecture,
        "cgroup_version": cgroup_version,
    }


def inspect_state(name: str) -> dict[str, object]:
    return json.loads(docker("inspect", "--format", "{{json .State}}", name))


def inspect_limits(name: str) -> dict[str, int]:
    host_config = json.loads(docker("inspect", "--format", "{{json .HostConfig}}", name))
    memory = int(host_config["Memory"])
    memory_swap = int(host_config["MemorySwap"])
    if memory <= 0 or memory_swap != memory:
        raise ProbeError(
            f"Container memory limits are not RAM only: Memory={memory}, MemorySwap={memory_swap}"
        )
    return {"memory_bytes": memory, "memory_swap_bytes": memory_swap}


def parse_cgroup_output(raw: str) -> dict[str, object]:
    values: dict[str, str] = {}
    current: str | None = None
    for line in raw.splitlines():
        if line.startswith(">>>"):
            current = line[3:]
            if current not in CGROUP_FILES or current in values:
                raise CgroupError(f"Unexpected cgroup section: {current}")
            values[current] = ""
        elif current is not None:
            values[current] += line + "\n"
    missing = set(CGROUP_FILES) - set(values)
    if missing:
        raise CgroupError(f"Missing cgroup v2 values: {', '.join(sorted(missing))}")
    try:
        memory_max = int(values["memory.max"].strip())
        swap_max = int(values["memory.swap.max"].strip())
        memory_peak = int(values["memory.peak"].strip())
        events = dict(
            (key, int(value))
            for key, value in (line.split() for line in values["memory.events"].splitlines())
        )
    except (ValueError, TypeError) as exc:
        raise CgroupError(f"Invalid cgroup v2 values: {values}") from exc
    if memory_max <= 0 or swap_max != 0:
        raise CgroupError(
            f"Expected a finite RAM cap and no swap; memory.max={memory_max}, memory.swap.max={swap_max}"
        )
    if not {"oom", "oom_kill"}.issubset(events):
        raise CgroupError("memory.events is missing oom or oom_kill counters")
    return {
        "memory_max_bytes": memory_max,
        "memory_swap_max_bytes": swap_max,
        "memory_peak_bytes": memory_peak,
        "memory_events": events,
    }


def read_cgroup(name: str, expected_memory_bytes: int) -> dict[str, object]:
    try:
        raw = docker("exec", name, "sh", "-c", CGROUP_READ_SCRIPT, timeout=15)
    except ProbeError as exc:
        raise CgroupError(str(exc)) from exc
    snapshot = parse_cgroup_output(raw)
    if snapshot["memory_max_bytes"] != expected_memory_bytes:
        raise CgroupError(
            f"memory.max is {snapshot['memory_max_bytes']}, expected {expected_memory_bytes}"
        )
    return snapshot


def has_oom(snapshot: dict[str, object]) -> bool:
    events = snapshot["memory_events"]
    assert isinstance(events, dict)
    return int(events.get("oom", 0)) > 0 or int(events.get("oom_kill", 0)) > 0


def health_ready(url: str) -> bool:
    try:
        with urlopen(url, timeout=0.5) as response:
            return response.status == 200 and json.load(response).get("status") == "ok"
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):
        return False


def wait_for_health(name: str, url: str, started_at: float, timeout: float) -> float:
    next_inspect = started_at + 1.0
    while time.perf_counter() - started_at < timeout:
        if health_ready(url):
            return time.perf_counter() - started_at
        now = time.perf_counter()
        if now >= next_inspect:
            state = inspect_state(name)
            if not state.get("Running"):
                raise ProbeError(
                    "Container exited before /health was ready: "
                    f"OOMKilled={state.get('OOMKilled')}, ExitCode={state.get('ExitCode')}"
                )
            next_inspect = now + 1.0
        time.sleep(0.2)
    state = inspect_state(name)
    raise ProbeError(
        f"/health did not become ready in {timeout:g}s; "
        f"OOMKilled={state.get('OOMKilled')}, ExitCode={state.get('ExitCode')}"
    )


def save_logs(name: str, path: Path) -> None:
    with path.open("w", encoding="utf-8") as logs:
        try:
            result = subprocess.run(
                ["docker", "logs", name], stdout=logs, stderr=subprocess.STDOUT,
                text=True, timeout=60, check=False,
            )
            if result.returncode:
                logs.write(f"\n[docker logs exited {result.returncode}]\n")
        except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
            logs.write(f"\n[could not collect docker logs: {exc}]\n")


def run_benchmark(base_url: str, repeats: int, timeout: float, trial_dir: Path) -> int:
    argv = [
        sys.executable, str(BENCHMARK_SCRIPT),
        "--base-url", base_url,
        "--repeats", str(repeats),
        "--timeout", str(timeout),
        "--output-dir", str(trial_dir / "benchmark"),
    ]
    with (trial_dir / "benchmark.stdout.txt").open("w", encoding="utf-8") as stdout, (
        trial_dir / "benchmark.stderr.txt"
    ).open("w", encoding="utf-8") as stderr:
        try:
            return subprocess.run(argv, stdout=stdout, stderr=stderr, check=False).returncode
        except FileNotFoundError as exc:
            stderr.write(f"Benchmark could not start: {exc}\n")
            return 127


def run_trial(args: argparse.Namespace, trial_number: int, output_dir: Path, models_dir: Path) -> dict[str, object]:
    name = f"mandarin-asr-probe-{trial_number}-{uuid.uuid4().hex[:8]}"
    trial_dir = output_dir / f"trial-{trial_number:02d}"
    trial_dir.mkdir()
    base_url = f"http://127.0.0.1:{args.port}"
    result: dict[str, object] = {
        "trial": trial_number,
        "container_name": name,
        "status": "starting",
        "started_at_utc": datetime.now(timezone.utc).isoformat(),
        "startup_seconds": None,
        "benchmark_repeats": args.repeats if trial_number == args.startup_trials else 0,
    }
    created = False
    try:
        docker_argv = [
            "run", "--detach", "--name", name,
            "--memory", args.memory, "--memory-swap", args.memory,
            "--mount", f"type=bind,src={models_dir},dst=/app/backend/models,readonly",
            "--publish", f"127.0.0.1:{args.port}:8000",
            "--env", "LOCAL_ASR_PRELOAD=true",
            "--env", f"SENSEVOICE_MODEL_DIR=/app/backend/models/{args.model_subdir}",
            "--env", "LOCAL_ASR_VAD_MODEL_PATH=/app/backend/models/silero_vad.onnx",
        ]
        if args.provider_config:
            docker_argv += [
                "--mount", f"type=bind,src={args.provider_config.resolve()},dst=/app/backend/sensevoice_ort_lowmem.config,readonly",
                "--env", "SENSEVOICE_PROVIDER=cpu:/app/backend/sensevoice_ort_lowmem.config",
            ]
        docker_argv.append(args.image)
        result["docker_run_argv"] = ["docker", *docker_argv]
        started_at = time.perf_counter()
        result["container_id"] = docker(*docker_argv, timeout=args.startup_timeout)
        created = True
        result["startup_seconds"] = round(
            wait_for_health(name, f"{base_url}/health", started_at, args.startup_timeout), 3
        )
        result["state_at_startup"] = inspect_state(name)
        limits = inspect_limits(name)
        result["docker_limits"] = limits
        startup_cgroup = read_cgroup(name, limits["memory_bytes"])
        result["cgroup_after_startup"] = startup_cgroup
        write_json(trial_dir / "cgroup_after_startup.json", startup_cgroup)
        if has_oom(startup_cgroup):
            raise ProbeError("OOM event occurred during startup")

        result["status"] = "ok"
        if trial_number == args.startup_trials and args.repeats:
            benchmark_exit = run_benchmark(base_url, args.repeats, args.request_timeout, trial_dir)
            result["benchmark_exit_code"] = benchmark_exit
            state = inspect_state(name)
            result["state_after_requests"] = state
            if state.get("Running"):
                requests_cgroup = read_cgroup(name, limits["memory_bytes"])
                result["cgroup_after_requests"] = requests_cgroup
                write_json(trial_dir / "cgroup_after_requests.json", requests_cgroup)
                if has_oom(requests_cgroup):
                    raise ProbeError("OOM event occurred during requests")
            if benchmark_exit:
                raise ProbeError(
                    f"HTTP benchmark exited {benchmark_exit}; see trial-{trial_number:02d}/benchmark.stderr.txt"
                )
            if not state.get("Running") or state.get("OOMKilled"):
                raise ProbeError("Container exited or was OOM-killed during requests")
    except (ProbeError, CgroupError) as exc:
        result["status"] = "failed"
        result["error"] = str(exc)
        if isinstance(exc, CgroupError):
            result["fatal_cgroup_error"] = True
    finally:
        if created:
            log_path = trial_dir / "docker.log"
            save_logs(name, log_path)
            if result.get("benchmark_exit_code") == 0:
                logs = log_path.read_text(encoding="utf-8")
                vad_ok = logs.count("'stage': 'local_vad_activity'")
                vad_failed = logs.count("'stage': 'local_vad_failed'")
                vad_unavailable = logs.count("'stage': 'local_vad_unavailable'")
                result["vad_log_check"] = {
                    "activity_events": vad_ok,
                    "failed_events": vad_failed,
                    "unavailable_events": vad_unavailable,
                }
                if not vad_ok or vad_failed or vad_unavailable:
                    result["status"] = "failed"
                    result["error"] = "VAD was missing or failed during HTTP replay; see docker.log"
            try:
                result["state_before_cleanup"] = inspect_state(name)
            except ProbeError as exc:
                result["inspect_error"] = str(exc)
            try:
                docker("rm", "--force", name, timeout=30)
                result["container_removed"] = True
            except ProbeError as exc:
                result["container_removed"] = False
                result["cleanup_error"] = str(exc)
                result["status"] = "failed"
        write_json(trial_dir / "trial.json", result)
    return result


def run_probe(args: argparse.Namespace) -> dict[str, object]:
    models_dir = args.models_dir.expanduser().resolve()
    model_subdir = Path(args.model_subdir)
    if model_subdir.name != args.model_subdir or args.model_subdir in {".", ".."}:
        raise ProbeError("--model-subdir must be one directory name")
    if not (models_dir / model_subdir).is_dir():
        raise ProbeError(f"Model directory is missing: {models_dir / model_subdir}")
    if not (models_dir / "silero_vad.onnx").is_file():
        raise ProbeError(f"VAD model is missing: {models_dir / 'silero_vad.onnx'}")
    if args.provider_config and not args.provider_config.is_file():
        raise ProbeError(f"Provider config is missing: {args.provider_config}")
    if args.startup_trials < 1 or args.repeats < 0:
        raise ProbeError("--startup-trials must be at least 1 and --repeats cannot be negative")
    if args.startup_timeout <= 0 or args.request_timeout <= 0:
        raise ProbeError("Timeouts must be positive")
    if not 1 <= args.port <= 65535:
        raise ProbeError("--port must be between 1 and 65535")
    output_dir = args.output_dir.expanduser().resolve()
    if output_dir.exists() and any(output_dir.iterdir()):
        raise ProbeError(f"Output directory is not empty: {output_dir}")
    docker_environment = preflight(args.port)
    image_id = docker("image", "inspect", "--format", "{{.Id}}", args.image, timeout=15)
    image_platform = docker(
        "image", "inspect", "--format", "{{.Os}}/{{.Architecture}}", args.image, timeout=15
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    config = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "image": args.image,
        "image_id": image_id,
        "image_platform": image_platform,
        **docker_environment,
        "models_dir": str(models_dir),
        "model_subdir": args.model_subdir,
        "port": args.port,
        "memory": args.memory,
        "provider_config": str(args.provider_config.resolve()) if args.provider_config else None,
        "startup_trials": args.startup_trials,
        "startup_timeout_seconds": args.startup_timeout,
        "repeats": args.repeats,
        "request_timeout_seconds": args.request_timeout,
    }
    write_json(output_dir / "config.json", config)
    trials = []
    for trial_number in range(1, args.startup_trials + 1):
        print(f"Startup trial {trial_number}/{args.startup_trials}", file=sys.stderr, flush=True)
        trial = run_trial(args, trial_number, output_dir, models_dir)
        trials.append(trial)
        if trial.get("fatal_cgroup_error"):
            break
    startup_times = [
        float(trial["startup_seconds"]) for trial in trials if trial["startup_seconds"] is not None
    ]
    sorted_times = sorted(startup_times)
    summary = {
        "config": config,
        "status": "ok" if len(trials) == args.startup_trials and all(t["status"] == "ok" for t in trials) else "failed",
        "successful_startups": len(startup_times),
        "startup_median_seconds": round(statistics.median(sorted_times), 3) if sorted_times else None,
        "startup_p95_seconds": sorted_times[math.ceil(0.95 * len(sorted_times)) - 1] if sorted_times else None,
        "trials": trials,
    }
    write_json(output_dir / "summary.json", summary)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Built backend image tag.")
    parser.add_argument("--models-dir", required=True, type=Path, help="Host models directory to bind mount read-only.")
    parser.add_argument("--model-subdir", required=True, help="Model directory name within --models-dir.")
    parser.add_argument("--output-dir", required=True, type=Path, help="Empty directory for trial evidence.")
    parser.add_argument("--port", type=int, default=8765, help="Host port mapped to container port 8000.")
    parser.add_argument("--memory", default="512m", help="Docker RAM and total RAM+swap limit (default: 512m).")
    parser.add_argument("--provider-config", type=Path, help="Optional sherpa-onnx CPU provider config to mount and use for a memory experiment.")
    parser.add_argument("--startup-trials", type=int, default=3, help="Number of cold container starts (default: 3).")
    parser.add_argument("--startup-timeout", type=float, default=180, help="Seconds to wait for /health (default: 180).")
    parser.add_argument("--repeats", type=int, default=0, help="HTTP corpus repeats in final trial; 0 skips requests.")
    parser.add_argument("--request-timeout", type=float, default=120, help="Benchmark per-request timeout (default: 120).")
    args = parser.parse_args()
    try:
        summary = run_probe(args)
    except ProbeError as exc:
        parser.exit(2, f"Probe failed: {exc}\n")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if summary["status"] != "ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
