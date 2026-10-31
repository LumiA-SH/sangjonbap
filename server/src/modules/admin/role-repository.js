import {writeActionLog} from '../../shared/game.js';
import {validId} from './service.js';
import {requestKey,invalid} from './master-service.js';
import {adminTransaction,checkDuplicate,fail} from './transaction.js';

// Shared by bootstrap and every role change. Acquired BEFORE auth_user row locks.
async function lockRoles(c) {await c.query("select pg_advisory_xact_lock(hashtextextended('sangjonbap:admin-roles',0))");}
const publicUser = row => ({id:row.id,character_id:row.character_id,role:row.role,is_active:row.is_active});
export function validateRoleInput(body) {
    if (!body||Array.isArray(body)||Object.keys(body).some(k=>!['role','requestKey'].includes(k))||!['USER','ADMIN'].includes(body.role)) invalid('role은 USER 또는 ADMIN입니다.');
    return {role:body.role,requestKey:requestKey(body)};
}
export function validateBootstrapTarget(target) {
    if (!validId(target?.id) || !['accountId','instance'].every(k=>typeof target[k]==='string'&&target[k].trim()&&target[k].length<=255)) invalid('내부 ID, 외부 account ID, instance를 모두 지정하세요.');
}
function matchTarget(row,target) {
    if (!row) fail('USER_NOT_FOUND','계정이 없습니다.',404);
    if (!row.is_active || row.mastodon_account_id!==target.accountId || row.mastodon_instance!==target.instance) fail('BOOTSTRAP_TARGET_MISMATCH','활성 여부 및 외부 인증 식별자가 일치하지 않습니다.');
}
async function audit(c,actor,before,after,key,bootstrap=false) {
    await writeActionLog(c,{adminUserId:actor,category:'ADMIN',actionType:bootstrap?'ADMIN_BOOTSTRAP':'USER_ROLE_CHANGE',targetType:'AUTH_USER',targetId:after.id,
        description:bootstrap?'운영자 CLI 최초 관리자 지정':'관리자 권한 변경',requestKey:key,
        detail:{actor:bootstrap?{type:'OPERATOR_CLI'}:{type:'ADMIN',id:actor},targetUserId:after.id,before:publicUser(before),after:publicUser(after)}});
}
export function createAdminRoleRepository(pool) {
    return {
        async searchAdminUsers(q,after='0') {
            // Literal substring search; no tokens or external account identifiers in the response.
            return (await pool.query(`select u.id,u.character_id,u.role,u.is_active,c.name as character_name from public.auth_user u
                left join public.game_character c on c.id=u.character_id where u.id>$2 and
                (strpos(lower(coalesce(c.name,'')),lower($1))>0 or u.id::text=$1) order by u.id limit 100`,[q,after])).rows;
        },
        async changeAdminRole(actorId,targetId,role,key) {
            const input=validateRoleInput({role,requestKey:key});
            if (!validId(targetId)||!validId(actorId)) invalid('올바른 계정 ID가 필요합니다.');
            return adminTransaction(pool,async c=>{
                await lockRoles(c);
                const rows=(await c.query('select * from public.auth_user where id=any($1::bigint[]) order by id for update',[[actorId,targetId]])).rows;
                const actor=rows.find(r=>r.id===actorId),before=rows.find(r=>r.id===targetId);
                if (!actor?.is_active||actor.role!=='ADMIN') fail('ADMIN_REQUIRED','관리자 권한이 필요합니다.',403);
                if (!before) fail('USER_NOT_FOUND','계정이 없습니다.',404);
                await checkDuplicate(c,input.requestKey);
                if (role==='USER' && before.role==='ADMIN' && before.is_active) {
                    const count=Number((await c.query("select count(*) from public.auth_user where is_active and role='ADMIN'")).rows[0].count);
                    if (count<=1) fail('LAST_ADMIN','마지막 활성 관리자의 권한은 회수할 수 없습니다.');
                }
                if (actorId===targetId && role==='USER') fail('SELF_REVOKE_FORBIDDEN','자신의 관리자 권한은 회수할 수 없습니다.');
                const after=(await c.query('update public.auth_user set role=$1 where id=$2 returning *',[role,targetId])).rows[0];
                await audit(c,actorId,before,after,input.requestKey);
                return publicUser(after);
            });
        },
        async previewFirstAdmin(target) {
            validateBootstrapTarget(target);
            if ((await pool.query("select id from public.auth_user where is_active and role='ADMIN' limit 1")).rowCount) fail('ADMIN_ALREADY_EXISTS','활성 관리자가 이미 존재합니다.');
            const row=(await pool.query('select * from public.auth_user where id=$1',[target.id])).rows[0];
            matchTarget(row,target);
            return {...publicUser(row),accountId:row.mastodon_account_id,instance:row.mastodon_instance};
        },
        async bootstrapFirstAdmin(target,key) {
            validateBootstrapTarget(target);requestKey({requestKey:key});
            return adminTransaction(pool,async c=>{
                await lockRoles(c);
                if ((await c.query("select id from public.auth_user where is_active and role='ADMIN' limit 1")).rowCount) fail('ADMIN_ALREADY_EXISTS','활성 관리자가 이미 존재합니다.');
                const before=(await c.query('select * from public.auth_user where id=$1 for update',[target.id])).rows[0];
                matchTarget(before,target);
                await checkDuplicate(c,key);
                const after=(await c.query("update public.auth_user set role='ADMIN' where id=$1 returning *",[target.id])).rows[0];
                await audit(c,null,before,after,key,true);
                return publicUser(after);
            });
        }
    };
}
