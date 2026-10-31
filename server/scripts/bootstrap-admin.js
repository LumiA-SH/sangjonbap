import {createInterface} from 'node:readline/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loadConfig} from '../src/config/env.js';
import {createPool} from '../src/db/pool.js';
import {createAdminRoleRepository,validateBootstrapTarget} from '../src/modules/admin/role-repository.js';

export function parseBootstrapArgs(args) {
    const values={};
    for (let i=0;i<args.length;i+=2) {
        const key={'--user-id':'id','--account-id':'accountId','--instance':'instance'}[args[i]];
        if (!key||!args[i+1]||values[key]) throw new Error('필수 옵션: --user-id ID --account-id 외부ID --instance 인스턴스');
        values[key]=args[i+1];
    }
    validateBootstrapTarget(values);
    return values;
}
export async function confirmFirstAdmin(repository,target,{ask,print}) {
    const preview=await repository.previewFirstAdmin(target);
    print(JSON.stringify(preview,null,2));
    const expected=`PROMOTE ${target.id} ${target.accountId} ${target.instance}`;
    if (await ask(`대상을 확인한 뒤 정확히 입력하세요: ${expected}\n> `)!==expected) throw new Error('확인이 일치하지 않아 변경하지 않았습니다.');
    return repository.bootstrapFirstAdmin(target,randomUUID());
}
export async function requireOAuthVerifiedAccount(pool,id) {
    const verified=await pool.query('select oauth_verified_at from public.auth_user where id=$1',[id]);
    if(!verified.rows[0]?.oauth_verified_at)throw new Error('대상 계정의 실제 OAuth 로그인 확인이 필요합니다.');
}
async function main() {
    const target=parseBootstrapArgs(process.argv.slice(2));
    if (!process.stdin.isTTY||!process.stdout.isTTY) throw new Error('운영자가 직접 실행하는 대화형 터미널이 필요합니다. 자동 실행은 금지합니다.');
    const config=loadConfig();
    if(config.provider!=='mastodon')throw new Error('실제 OAuth로 확인된 계정만 지정할 수 있습니다. AUTH_PROVIDER=mastodon이 필요합니다.');
    if (config.mode!=='supabase') throw new Error('Supabase 모드가 필요합니다.');
    const pool=createPool(config),terminal=createInterface({input:process.stdin,output:process.stdout});
    try {
        await requireOAuthVerifiedAccount(pool,target.id);
        const result=await confirmFirstAdmin(createAdminRoleRepository(pool),target,{ask:q=>terminal.question(q),print:console.log});
        console.log(JSON.stringify(result));
    } finally {terminal.close();await pool.end();}
}
if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
    main().catch(error=>{console.error(error.code||'BOOTSTRAP_FAILED',error.message);process.exitCode=1;});
}
