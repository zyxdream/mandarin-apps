export type RewardFood = 'apple' | 'berry' | 'tree_nut' | 'insect';

export interface RewardFoodOption {
  id: RewardFood;
  label: string;
  shortLabel: string;
  image: string;
}

export const FOOD_UNITS_PER_WORD = 5;

export const REWARD_FOODS: RewardFoodOption[] = [
  {
    id: 'apple',
    label: 'Apple',
    shortLabel: 'Apples',
    image: '/assets/rewards/apple.v2.webp',
  },
  {
    id: 'berry',
    label: 'Berry',
    shortLabel: 'Berries',
    image: '/assets/rewards/berry.v2.webp',
  },
  {
    id: 'tree_nut',
    label: 'Tree Nut',
    shortLabel: 'Nuts',
    image: '/assets/rewards/tree_nut.v2.webp',
  },
  {
    id: 'insect',
    label: 'Insect',
    shortLabel: 'Bugs',
    image: '/assets/rewards/insect.v2.webp',
  },
];

export const DEFAULT_REWARD_FOOD: RewardFood = 'apple';

export function getRewardFoodOption(food: RewardFood): RewardFoodOption {
  return REWARD_FOODS.find(option => option.id === food) ?? REWARD_FOODS[0];
}

export function foodUnitsForCorrectWords(correctWordCount: number): number {
  return correctWordCount * FOOD_UNITS_PER_WORD;
}
