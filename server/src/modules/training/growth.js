import {readNumberSettings, resourceNumber} from '../../shared/settings.js';

const stats = ['atk', 'def', 'agi'];

// No growth amount, probability, stat selection distribution or action eligibility
// is assumed. The future training service supplies the confirmed choice/amount.
export async function loadTrainingGrowthContext(client, character) {
    const {permanent_stat_cap: configuredCap} = await readNumberSettings(client, {permanent_stat_cap: resourceNumber});
    const cap = Math.min(40, configuredCap);
    const candidates = stats.filter(stat => {
        if (!Number.isSafeInteger(character[stat]) || character[stat] < 0) throw new Error('Invalid character stat');
        return character[stat] < cap;
    });
    return {cap, candidates};
}

export function calculateTrainingGrowth(character, context, stat, amount) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Confirmed growth amount required');
    if (!context.candidates.length) return null;
    if (!stats.includes(stat) || !context.candidates.includes(stat)) throw new Error('Stat is not a growth candidate');
    const before = character[stat];
    const after = before + Math.min(amount, context.cap - before);
    return {stat, before, after, growth: after - before};
}
