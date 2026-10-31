import {AppError} from './http.js';

// Resource columns are PostgreSQL int4. Costs may be zero; revive targets must
// be positive so a successful revival cannot immediately be dead/near-dead.
export const resourceNumber = {integer: true, min: 0, max: 2147483647};
export const positiveResourceNumber = {...resourceNumber, min: 1};

// One query creates one request-local snapshot. No fallback and no cache.
// pg decodes JSONB; numeric strings, null, objects and arrays are not numbers.
export async function readNumberSettings(client, requirements) {
    const keys = Object.keys(requirements);
    const result = await client.query(
        'select config_key,config_value from public.system_config where config_key=any($1::text[])', [keys]
    );
    const found = new Map(result.rows.map(row => [row.config_key, row.config_value]));
    const settings = {};
    for (const key of keys) {
        if (!found.has(key)) {
            throw new AppError(500, 'SYSTEM_CONFIG_MISSING', `필수 서버 설정이 없습니다: ${key}`);
        }
        const value = found.get(key);
        const {integer = false, min = -Infinity, max = Infinity} = requirements[key];
        if (typeof value !== 'number' || !Number.isFinite(value) ||
            (integer && !Number.isSafeInteger(value)) || value < min || value > max) {
            throw new AppError(500, 'SYSTEM_CONFIG_INVALID', `서버 숫자 설정이 올바르지 않습니다: ${key}`);
        }
        settings[key] = value;
    }
    return settings;
}
