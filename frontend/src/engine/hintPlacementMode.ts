export type HintPlacementMode =
  | 'incorrect_right_lane'
  | 'baozi_linked'
  | 'default_mole_anchor';

export interface ResolveHintPlacementModeInput {
  hasIncorrectPlacement: boolean;
  hasBaoziLinkedPlacement: boolean;
}

export function resolveHintPlacementMode(
  input: ResolveHintPlacementModeInput,
): HintPlacementMode {
  if (input.hasIncorrectPlacement) return 'incorrect_right_lane';
  if (input.hasBaoziLinkedPlacement) return 'baozi_linked';
  return 'default_mole_anchor';
}

export function buildPedagogyHintClassName(mode: HintPlacementMode): string {
  if (mode === 'incorrect_right_lane') {
    return 'hint-overlay hint-overlay--pedagogy hint-overlay--incorrect';
  }
  if (mode === 'baozi_linked') {
    return 'hint-overlay hint-overlay--pedagogy hint-overlay--linked';
  }
  return 'hint-overlay hint-overlay--pedagogy';
}
