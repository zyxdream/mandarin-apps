# Pinyin Scorer Pairwise Acceptance Report

Generated against the 200 target occurrences (186 unique Hanzi/pinyin targets)
in `frontend/src/data/scriptSessions.generated.ts` using the v1 pinyin-only
policy:

- phrase threshold: `0.82`
- per-syllable floor: `0.60`
- full completeness required
- same-pinyin homophones excluded from this collision list

Seventeen non-identical pronunciation pairs pass in both directions because
the scorer's feature similarities are symmetric.

| Target A | Pinyin A | Target B | Pinyin B | Confidence | Lowest syllable |
| --- | --- | --- | --- | ---: | ---: |
| 敬礼 | `jing4 li3` | 井里 | `jing3 li3` | 0.930000 | 0.860000 |
| 是 | `shi4` | 四 | `si4` | 0.930000 | 0.930000 |
| 游 | `you2` | 有 | `you3` | 0.920000 | 0.920000 |
| 跳 | `tiao4` | 掉 | `diao4` | 0.912500 | 0.912500 |
| 两天 | `liang3 tian1` | 蓝天 | `lan2 tian1` | 0.894750 | 0.789500 |
| 蓝 | `lan2` | 男 | `nan2` | 0.877500 | 0.877500 |
| 八 | `ba1` | 拔 | `ba2` | 0.870000 | 0.870000 |
| 飞 | `fei1` | 风 | `feng1` | 0.865000 | 0.865000 |
| 蓝 | `lan2` | 来 | `lai2` | 0.865000 | 0.865000 |
| 有 | `you3` | 又 | `you4` | 0.860000 | 0.860000 |
| 石子 | `shi2 zi3` | 十四 | `shi2 si4` | 0.842500 | 0.685000 |
| 游 | `you2` | 又 | `you4` | 0.840000 | 0.840000 |
| 是 | `shi4` | 十 | `shi2` | 0.840000 | 0.840000 |
| 水中 | `shui3 zhong1` | 水声 | `shui3 sheng1` | 0.839375 | 0.678750 |
| 字 | `zi4` | 四 | `si4` | 0.825000 | 0.825000 |
| 一边 | `yi1 bian1` | 西边 | `xi1 bian1` | 0.825000 | 0.650000 |
| 春 | `chun1` | 真 | `zhen1` | 0.822500 | 0.822500 |

This report is a calibration aid, not a failing test. These acceptances follow
directly from the selected kid-friendly feature table and averaging rule. If
field testing shows false accepts, tune the similarities or thresholds against
recorded child speech rather than adding Hanzi-dependent scoring.
