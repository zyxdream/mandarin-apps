#!/usr/bin/env python3
"""
Generate baseline mole attachment metadata from alpha bounds.

Usage:
  python3 frontend/scripts/generate_mole_attachment_metadata.py \
    --glob 'frontend/public/assets/characters/moles/*_holding.png' \
    --glob 'frontend/public/assets/characters/moles/*_after_hit.png'
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

from PIL import Image


def iter_paths(globs: list[str]) -> Iterable[Path]:
    seen: set[Path] = set()
    for pattern in globs:
        for path in sorted(Path().glob(pattern)):
            if not path.is_file() or path.suffix.lower() != '.png':
                continue
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            yield path


def row_width(alpha, y: int) -> tuple[int, int, int]:
    width = alpha.width
    xs = [x for x in range(width) if alpha.getpixel((x, y)) > 0]
    if not xs:
        return 0, -1, -1
    return max(xs) - min(xs) + 1, min(xs), max(xs)


def summarize(path: Path) -> dict[str, object]:
    image = Image.open(path).convert('RGBA')
    alpha = image.getchannel('A')
    bbox = alpha.getbbox()
    if bbox is None:
        raise ValueError(f'No alpha pixels found in {path}')

    left, top, right, bottom_exclusive = bbox
    bottom = bottom_exclusive - 1
    width = right - left
    height = bottom_exclusive - top

    lower_band_top = int(image.height * 0.68)
    ys = []
    xs = []
    for y in range(lower_band_top, image.height):
        for x in range(image.width):
            if alpha.getpixel((x, y)) > 0:
                ys.append(y)
                xs.append(x)

    if xs:
        lower_centroid_x = sum(xs) / len(xs)
    else:
        lower_centroid_x = image.width / 2

    default_rim_y = min(image.height - 1, max(top, int(image.height * 0.75)))
    fit_width, fit_min_x, fit_max_x = row_width(alpha, default_rim_y)

    return {
        'texture': '/' + str(path).replace('frontend/public/', '').replace('\\', '/'),
        'canvasWidth': image.width,
        'canvasHeight': image.height,
        'visibleBBox': {
            'left': left,
            'top': top,
            'right': right,
            'bottom': bottom_exclusive,
            'width': width,
            'height': height,
        },
        'suggestedRimContactX': round(lower_centroid_x, 1),
        'suggestedRimContactY': default_rim_y,
        'suggestedFitWidthPx': fit_width,
        'suggestedFitRowRange': {
            'minX': fit_min_x,
            'maxX': fit_max_x,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description='Generate baseline attachment metadata from alpha bounds.')
    parser.add_argument('--glob', action='append', default=[], help='Input glob pattern(s) for PNG files')
    args = parser.parse_args()

    if not args.glob:
        raise SystemExit('Pass at least one --glob pattern')

    payload = [summarize(path) for path in iter_paths(args.glob)]
    print(json.dumps(payload, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
