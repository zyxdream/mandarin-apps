import type { Word } from '../types/word';

export const WORDS: Word[] = [
  // Easy — everyday nouns
  { id: 'ping2guo3', hanzi: '苹果', pinyin: 'píng guǒ', pinyinRaw: 'ping2 guo3', tone: 2, difficulty: 'easy', creatureName: 'Apple Mole', scoreValue: 10 },
  { id: 'yi1fu2', hanzi: '衣服', pinyin: 'yī fú', pinyinRaw: 'yi1 fu2', tone: 1, difficulty: 'easy', creatureName: 'Jacket Mole', scoreValue: 10 },
  { id: 'cao3di4', hanzi: '草地', pinyin: 'cǎo dì', pinyinRaw: 'cao3 di4', tone: 3, difficulty: 'easy', creatureName: 'Grass Mole', scoreValue: 10 },
  { id: 'xiao3niao3', hanzi: '小鸟', pinyin: 'xiǎo niǎo', pinyinRaw: 'xiao3 niao3', tone: 3, difficulty: 'easy', creatureName: 'Bird Mole', scoreValue: 10 },
  { id: 'hua1duo3', hanzi: '花朵', pinyin: 'huā duǒ', pinyinRaw: 'hua1 duo3', tone: 1, difficulty: 'easy', creatureName: 'Flower Mole', scoreValue: 10 },
  { id: 'liu3zhi1', hanzi: '柳枝', pinyin: 'liǔ zhī', pinyinRaw: 'liu3 zhi1', tone: 3, difficulty: 'easy', creatureName: 'Willow Mole', scoreValue: 10 },

  // Medium — classroom and nature words
  { id: 'xue2xiao4', hanzi: '学校', pinyin: 'xué xiào', pinyinRaw: 'xue2 xiao4', tone: 2, difficulty: 'medium', creatureName: 'School Mole', scoreValue: 15 },
  { id: 'lao3shi1', hanzi: '老师', pinyin: 'lǎo shī', pinyinRaw: 'lao3 shi1', tone: 3, difficulty: 'medium', creatureName: 'Teacher Mole', scoreValue: 15 },
  { id: 'peng2you3', hanzi: '朋友', pinyin: 'péng yǒu', pinyinRaw: 'peng2 you3', tone: 2, difficulty: 'medium', creatureName: 'Buddy Mole', scoreValue: 15 },
  { id: 'tian1qi4', hanzi: '天气', pinyin: 'tiān qì', pinyinRaw: 'tian1 qi4', tone: 1, difficulty: 'medium', creatureName: 'Weather Mole', scoreValue: 15 },
  { id: 'shan1shui3', hanzi: '山水', pinyin: 'shān shuǐ', pinyinRaw: 'shan1 shui3', tone: 1, difficulty: 'medium', creatureName: 'Mountain Mole', scoreValue: 15 },
  { id: 'cheng2shi4', hanzi: '城市', pinyin: 'chéng shì', pinyinRaw: 'cheng2 shi4', tone: 2, difficulty: 'medium', creatureName: 'City Mole', scoreValue: 15 },

  // Hard — longer sounds and mixed tones
  { id: 'chuang1hu4', hanzi: '窗户', pinyin: 'chuāng hù', pinyinRaw: 'chuang1 hu4', tone: 1, difficulty: 'hard', creatureName: 'Window Mole', scoreValue: 20 },
  { id: 'huo3che1', hanzi: '火车', pinyin: 'huǒ chē', pinyinRaw: 'huo3 che1', tone: 3, difficulty: 'hard', creatureName: 'Train Mole', scoreValue: 20 },
  { id: 'fei1ji1', hanzi: '飞机', pinyin: 'fēi jī', pinyinRaw: 'fei1 ji1', tone: 1, difficulty: 'hard', creatureName: 'Plane Mole', scoreValue: 20 },
  { id: 'dian4nao3', hanzi: '电脑', pinyin: 'diàn nǎo', pinyinRaw: 'dian4 nao3', tone: 4, difficulty: 'hard', creatureName: 'Computer Mole', scoreValue: 20 },
  { id: 'tu2shu1', hanzi: '图书', pinyin: 'tú shū', pinyinRaw: 'tu2 shu1', tone: 2, difficulty: 'hard', creatureName: 'Book Mole', scoreValue: 20 },
  { id: 'lan2tian1', hanzi: '蓝天', pinyin: 'lán tiān', pinyinRaw: 'lan2 tian1', tone: 2, difficulty: 'hard', creatureName: 'Sky Mole', scoreValue: 20 },
];

export function shuffleWords(words: Word[]): Word[] {
  return [...words].sort(() => Math.random() - 0.5);
}
