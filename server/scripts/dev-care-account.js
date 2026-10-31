import {pathToFileURL} from 'node:url';
import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';

const name = '[DEV CARE v1] 치료 부활 대상';
const marker = 'urn:sangjonbap:dev:care-account:v1';

// Caller owns transaction. Never resets resources, changes existing ownership,
// or reactivates an account. Deactivation preserves referenced audit records.
export async function manageDevCareAccount(client, {deactivate = false} = {}) {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [marker]);
    const found = await client.query(
        'select * from public.game_character where name=$1 or profile_image_url=$2 order by id for update', [name, marker]
    );
    if (found.rowCount > 1 || (found.rowCount && found.rows[0].profile_image_url !== marker)) {
        throw new Error('DEV 식별자와 기존 캐릭터가 충돌합니다. 변경하지 않습니다.');
    }
    let character = found.rows[0];
    if (!character && deactivate) return {mode: 'absent'};
    if (!character) {
        character = (await client.query(
            `insert into public.game_character(name,profile_image_url,hunter_grade,atk,def,agi)
             values ($1,$2,'B',10,10,10) returning *`, [name, marker]
        )).rows[0];
        await client.query("insert into public.auth_user(character_id,role) values ($1,'USER')", [character.id]);
    }
    const users = await client.query('select id,role,is_active from public.auth_user where character_id=$1 for update', [character.id]);
    if (users.rowCount !== 1 || users.rows[0].role !== 'USER') throw new Error('DEV 계정 연결이 예상과 다릅니다. 변경하지 않습니다.');
    const user = users.rows[0];
    if (deactivate) {
        await client.query('update public.auth_user set is_active=false where id=$1', [user.id]);
        await client.query('update public.game_character set is_active=false where id=$1', [character.id]);
    }
    return {mode: deactivate ? 'deactivated' : 'ready', characterId: character.id, authUserId: user.id,
        active: !deactivate && character.is_active && user.is_active};
}

async function main() {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--deactivate')) throw new Error('사용법: node server/scripts/dev-care-account.js [--deactivate]');
    const config = loadConfig();
    if (config.nodeEnv !== 'development' || config.mode !== 'supabase' || config.provider !== 'dev') {
        throw new Error('로컬 development / Supabase / DEV 인증에서만 사용하세요.');
    }
    const pool = createPool(config);
    const client = await pool.connect();
    try {
        await client.query('begin');
        const result = await manageDevCareAccount(client, {deactivate: args.includes('--deactivate')});
        await client.query('commit');
        console.log(JSON.stringify(result, null, 2));
    } catch (error) { await client.query('rollback'); throw error; }
    finally { client.release(); await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => { console.error('DEV 계정 작업 실패:', error.message); process.exitCode = 1; });
}
