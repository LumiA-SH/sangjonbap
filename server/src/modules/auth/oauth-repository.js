import {sessionLifetimeSeconds} from './oauth-session.js';
import {AppError} from '../../shared/http.js';

export function createOAuthRepository(pool) {
    return {
        async saveOAuthState(stateHash,browserHash) {
            await pool.query('delete from public.oauth_login_state where expires_at<=clock_timestamp()');
            await pool.query(`insert into public.oauth_login_state(state_hash,browser_hash,expires_at)
                values($1,$2,clock_timestamp()+interval '5 minutes')`,[stateHash,browserHash]);
        },
        async consumeOAuthState(stateHash,browserHash) {
            return (await pool.query(`delete from public.oauth_login_state
                where state_hash=$1 and browser_hash=$2 and expires_at>clock_timestamp() returning state_hash`,[stateHash,browserHash])).rowCount===1;
        },
        async resolveOAuthUser(instance,accountId,profile={}) {
            const c=await pool.connect();
            try {
                await c.query('begin');
                await c.query("set local lock_timeout = '5s'");
                await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`oauth:${instance}:${accountId}`]);
                const result=await c.query(`select id,character_id,role,is_active from public.auth_user
                    where mastodon_account_id=$1 and lower(rtrim(mastodon_instance,'/'))=any($2::text[]) for update`,
                    [accountId,[instance,`https://${instance}`]]);
                if(result.rowCount>1)throw new AppError(409,'OAUTH_IDENTITY_CONFLICT','계정 연결을 운영자가 확인해야 합니다.');
                let user=result.rows[0];
                if(!user)user=(await c.query(`insert into public.auth_user(role,mastodon_instance,mastodon_account_id)
                    values('USER',$1,$2) returning id,character_id,role,is_active`,[instance,accountId])).rows[0];
                if(!user.is_active)throw new AppError(403,'USER_UNAVAILABLE','비활성 계정입니다.');
                // Profile data comes only from the verified Mastodon response, never request input.
                const name=(typeof profile.display_name==='string'&&profile.display_name.trim())||
                    (typeof profile.username==='string'&&profile.username.trim())||accountId;
                let avatar=null;
                try {const url=new URL(profile.avatar);if(url.protocol==='https:'&&!url.username&&!url.password)avatar=url.href;}catch{}
                if(!user.character_id){
                    const character=(await c.query(`insert into public.game_character
                        (name,profile_image_url,hunter_grade,has_ability,atk,def,agi,initial_setup_complete)
                        values($1,$2,null,null,null,null,null,false) returning id`,[name.slice(0,100),avatar])).rows[0];
                    await c.query('update public.auth_user set character_id=$1 where id=$2',[character.id,user.id]);
                    user={...user,character_id:character.id};
                }else if(Object.keys(profile).length){
                    await c.query('update public.game_character set name=$1,profile_image_url=$2,updated_at=clock_timestamp() where id=$3',
                        [name.slice(0,100),avatar,user.character_id]);
                }
                await c.query('update public.auth_user set oauth_verified_at=clock_timestamp() where id=$1',[user.id]);
                await c.query('commit');return user;
            } catch(error){await c.query('rollback');throw error;}
            finally{c.release();}
        },
        async saveOAuthSession(hash,userId) {
            await pool.query('delete from public.auth_session where expires_at<=clock_timestamp()');
            await pool.query(`insert into public.auth_session(token_hash,user_id,expires_at)
                values($1,$2,clock_timestamp()+$3 * interval '1 second')`,[hash,userId,sessionLifetimeSeconds]);
        },
        async getOAuthSession(hash) {
            return (await pool.query(`select u.id,u.character_id,u.role,u.is_active,u.game_test_enabled from public.auth_session s
                join public.auth_user u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>clock_timestamp() and u.is_active`,[hash])).rows[0]||null;
        },
        async revokeOAuthSession(hash){await pool.query('delete from public.auth_session where token_hash=$1',[hash]);}
    };
}
