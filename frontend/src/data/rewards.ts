export type RewardFood =
  | 'apple'
  | 'berry'
  | 'tree_nut'
  | 'strawberry'
  | 'baozi'
  | 'mooncake';

export interface RewardFoodOption {
  id: RewardFood;
  label: string;
  shortLabel: string;
  baseImage: string;
  stackPopupImage: string;
}

export const FOOD_UNITS_PER_WORD = 5;

export const REWARD_FOODS: RewardFoodOption[] = [
  {
    id: 'apple',
    label: 'Apple',
    shortLabel: 'Apples',
    baseImage: '/assets/rewards/apple.v2.webp',
    stackPopupImage: '/assets/rewards/apple_x10.v2.webp',
  },
  {
    id: 'berry',
    label: 'Berry',
    shortLabel: 'Berries',
    baseImage: '/assets/rewards/grapes.v2.webp',
    stackPopupImage: '/assets/rewards/grapes_x10.v2.webp',
  },
  {
    id: 'tree_nut',
    label: 'Tree Nut',
    shortLabel: 'Nuts',
    baseImage: '/assets/rewards/tree_nut.v2.webp',
    stackPopupImage: '/assets/rewards/tree_nut_x10.v2.webp',
  },
  {
    id: 'strawberry',
    label: 'Strawberry',
    shortLabel: 'Strawberries',
    baseImage: '/assets/rewards/strawberry.v2.webp',
    stackPopupImage: '/assets/rewards/strawberry_x10.v2.webp',
  },
  {
    id: 'baozi',
    label: 'Baozi',
    shortLabel: 'Baozi',
    baseImage: '/assets/rewards/baozi.v2.webp',
    stackPopupImage: '/assets/rewards/baozi_x5.v2.webp',
  },
  {
    id: 'mooncake',
    label: 'Mooncake',
    shortLabel: 'Mooncakes',
    baseImage: '/assets/rewards/mooncake.v2.webp',
    stackPopupImage: '/assets/rewards/mooncake_x10.v2.webp',
  },
];

export const DEFAULT_REWARD_FOOD: RewardFood = 'apple';

export function getRewardFoodOption(food: RewardFood): RewardFoodOption {
  return REWARD_FOODS.find(option => option.id === food) ?? REWARD_FOODS[0];
}

export function foodUnitsForCorrectWords(correctWordCount: number): number {
  return correctWordCount * FOOD_UNITS_PER_WORD;
}
