# Anchor Calibration Workflow

Use this workflow before visual mole-hole alignment fixes. Keep the work visual-only: do not change audio, backend, evaluation, scoring, or game-state behavior.

## Prompt Template

Improve visual alignment for `[specific hole / mole / state]`.

Compare these anchors:

- Hole anchors: `left oval edge`, `right oval edge`, `front lip curve`, `rim/contact line`, `hole center`.
- Mole anchors: `body contact point`, `body/sprite bottom`, `board/text center`, `visible sprite bbox`.
- State anchors: `holding`, `on_hit`, `after_hit`, `escaping`.

Expected result:

- Mole body or hands touch, or slightly overlap, the front hole lip.
- Board is not used as the hole contact point.
- Hit and after-hit sprites preserve the same body anchor as holding.
- Shadows and rim overlays appear only for the active mole and only to blend edges.
- Prefer slight overlap over visible gaps.

## Debug View

Open the game with:

```bash
http://localhost:5173/?layoutDebug=1
```

If Vite moved to another port, use that port instead.

Debug colors:

- Cyan oval: hole opening.
- Green line: rim/contact line.
- Orange line: front lip.
- Pink cross: mole body contact anchor.
- Cyan diamond: board/text center.
- Yellow box: visible sprite bbox.
- Yellow lower cross: visible sprite bottom.

## Tuning Order

1. Check whether the hole anchors are wrong.
2. If yes, tune the slot geometry in `frontend/src/engine/moleLayout.ts`.
3. If the hole anchors are right but one character/state jumps, tune sprite metadata in `frontend/src/engine/moleAttachmentMetadata.ts`.
4. If all anchors are right but the edge still looks cut out, tune only active-mole rim/shadow blending in `frontend/src/components/MoleCanvas.tsx`.
5. Recheck holding, hit, miss, and escaping states on second-from-left, second-from-right, and bottom-right holes.

## Validation

Run:

```bash
npm run lint
npm run build
npm run test:layout
```

Manual viewports:

- `1920x1080`
- `1366x768`
- `390x844`
- `844x390`
