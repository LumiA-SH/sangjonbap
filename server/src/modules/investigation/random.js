import {randomInt} from 'node:crypto';

export const randomUnit = () => randomInt(0, 2 ** 48 - 1) / (2 ** 48 - 1);

function sample(random) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('Random source must return a number in [0, 1)');
  }
  return value;
}

export function chooseResult(results, random = randomUnit) {
  if (!results.length) return null;
  const weights = results.map(result => Number(result.weight));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!weights.every(weight => Number.isSafeInteger(weight) && weight > 0) || !Number.isSafeInteger(total)) {
    throw new Error('Invalid investigation weights');
  }
  let cursor = sample(random) * total;
  for (let i = 0; i < results.length; i++) {
    cursor -= weights[i];
    if (cursor < 0) return results[i];
  }
  return results[results.length - 1];
}

export function winsReward(probability, random = randomUnit) {
  const percent = Number(probability);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error('Invalid reward probability');
  }
  if (percent === 0) return false;
  if (percent === 100) return true;
  return sample(random) * 100 < percent;
}
