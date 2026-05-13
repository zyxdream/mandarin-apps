#!/usr/bin/env python3
"""
Convert checkerboard-style light backgrounds to transparency by flood-filling
from image borders.

Typical usage:
  python3 frontend/scripts/transparent_from_border.py \
    frontend/public/assets/objects/cover_word_banner_top.png \
    frontend/public/assets/objects/cover_word_banner_lower.png \
    --in-place --backup
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path
import tempfile
from typing import Iterable

import numpy as np
from PIL import Image


def build_candidate_mask(rgb: np.ndarray, bright_min: int, chroma_max: int) -> np.ndarray:
    maxc = rgb.max(axis=2)
    minc = rgb.min(axis=2)
    chroma = maxc - minc
    return (maxc >= bright_min) & (chroma <= chroma_max)


def border_seed_mask(candidate: np.ndarray) -> np.ndarray:
    h, w = candidate.shape
    seeds = np.zeros((h, w), dtype=bool)
    seeds[0, :] = candidate[0, :]
    seeds[h - 1, :] = candidate[h - 1, :]
    seeds[:, 0] = candidate[:, 0]
    seeds[:, w - 1] = candidate[:, w - 1]
    return seeds


def flood_fill_from_border(candidate: np.ndarray) -> np.ndarray:
    h, w = candidate.shape
    visited = np.zeros((h, w), dtype=bool)
    seeds = border_seed_mask(candidate)

    q: deque[tuple[int, int]] = deque()
    ys, xs = np.where(seeds)
    for y, x in zip(ys.tolist(), xs.tolist()):
        visited[y, x] = True
        q.append((y, x))

    # 8-connectivity captures anti-aliased checkerboard edges better.
    neighbors = [
        (-1, -1), (-1, 0), (-1, 1),
        (0, -1),           (0, 1),
        (1, -1),  (1, 0),  (1, 1),
    ]

    while q:
        y, x = q.popleft()
        for dy, dx in neighbors:
            ny = y + dy
            nx = x + dx
            if ny < 0 or ny >= h or nx < 0 or nx >= w:
                continue
            if visited[ny, nx] or not candidate[ny, nx]:
                continue
            visited[ny, nx] = True
            q.append((ny, nx))

    return visited


def neighbor_mask(mask: np.ndarray) -> np.ndarray:
    h, w = mask.shape
    out = np.zeros_like(mask)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            y0 = max(0, -dy)
            y1 = min(h, h - dy)
            x0 = max(0, -dx)
            x1 = min(w, w - dx)
            out[y0:y1, x0:x1] |= mask[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
    return out


def convert_image(
    in_path: Path,
    out_path: Path,
    bright_min: int,
    chroma_max: int,
    soft_edge_alpha: int,
) -> tuple[int, int]:
    img = Image.open(in_path).convert("RGBA")
    arr = np.array(img, dtype=np.uint8)
    rgb = arr[:, :, :3].astype(np.int16)

    candidate = build_candidate_mask(rgb, bright_min=bright_min, chroma_max=chroma_max)
    background = flood_fill_from_border(candidate)

    alpha = arr[:, :, 3].copy()
    before_opaque = int((alpha > 0).sum())

    alpha[background] = 0

    # Optional edge cleanup to reduce light fringe around subject boundaries.
    if soft_edge_alpha < 255:
        near_bg = neighbor_mask(background) & ~background
        soft_candidates = near_bg & build_candidate_mask(
            rgb,
            bright_min=max(0, bright_min - 16),
            chroma_max=chroma_max + 10,
        )
        alpha[soft_candidates] = np.minimum(alpha[soft_candidates], np.uint8(soft_edge_alpha))

    arr[:, :, 3] = alpha
    out_img = Image.fromarray(arr, mode="RGBA")
    out_img.save(out_path)

    after_opaque = int((alpha > 0).sum())
    return before_opaque, after_opaque


def iter_inputs(paths: list[str], globs: list[str]) -> Iterable[Path]:
    yielded: set[Path] = set()
    for raw in paths:
        p = Path(raw)
        if p.exists() and p.is_file() and p.suffix.lower() == ".png":
            resolved = p.resolve()
            if resolved not in yielded:
                yielded.add(resolved)
                yield p

    for pattern in globs:
        for p in sorted(Path().glob(pattern)):
            if not p.is_file() or p.suffix.lower() != ".png":
                continue
            resolved = p.resolve()
            if resolved in yielded:
                continue
            yielded.add(resolved)
            yield p


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert light checkerboard background to transparent PNG.")
    parser.add_argument("inputs", nargs="*", help="Input PNG file paths")
    parser.add_argument(
        "--glob",
        dest="globs",
        action="append",
        default=[],
        help="Glob pattern(s), e.g. 'frontend/public/assets/objects/cover_word_banner_*.png'",
    )
    parser.add_argument("--in-place", action="store_true", help="Overwrite input files")
    parser.add_argument("--backup", action="store_true", help="Create .bak copy before overwrite")
    parser.add_argument("--suffix", default="_transparent", help="Output suffix when not using --in-place")
    parser.add_argument("--bright-min", type=int, default=175, help="Min brightness treated as background")
    parser.add_argument("--chroma-max", type=int, default=28, help="Max color spread treated as background")
    parser.add_argument(
        "--soft-edge-alpha",
        type=int,
        default=86,
        help="Alpha for light fringe pixels near removed background (0-255, 255 disables)",
    )

    args = parser.parse_args()

    files = list(iter_inputs(args.inputs, args.globs))
    if not files:
        raise SystemExit("No PNG inputs found. Pass files or --glob pattern.")

    print(f"[convert] files={len(files)} bright_min={args.bright_min} chroma_max={args.chroma_max}")

    for in_path in files:
        source_path = in_path
        if args.in_place:
            out_path = in_path
            if args.backup:
                backup_path = in_path.with_suffix(in_path.suffix + ".bak")
                if not backup_path.exists():
                    backup_path.write_bytes(in_path.read_bytes())
                source_path = backup_path
        else:
            out_path = in_path.with_name(f"{in_path.stem}{args.suffix}{in_path.suffix}")

        if args.in_place:
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp_file:
                tmp_path = Path(tmp_file.name)
            try:
                before_opaque, after_opaque = convert_image(
                    source_path,
                    tmp_path,
                    bright_min=args.bright_min,
                    chroma_max=args.chroma_max,
                    soft_edge_alpha=max(0, min(255, args.soft_edge_alpha)),
                )
                tmp_path.replace(out_path)
            finally:
                if tmp_path.exists():
                    tmp_path.unlink()
        else:
            before_opaque, after_opaque = convert_image(
                source_path,
                out_path,
                bright_min=args.bright_min,
                chroma_max=args.chroma_max,
                soft_edge_alpha=max(0, min(255, args.soft_edge_alpha)),
            )
        removed = before_opaque - after_opaque
        print(f"[convert] {in_path} -> {out_path} removed_pixels={removed}")


if __name__ == "__main__":
    main()
