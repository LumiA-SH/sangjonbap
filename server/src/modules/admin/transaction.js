import {beginGameTransaction, commitGameTransaction, rollbackGameTransaction} from '../../shared/daily-gate.js';
import {AppError} from '../../shared/http.js';

export const fail = (code,message,status=409) => {throw new AppError(status,code,message);};
export async function requireAdminRow(client,userId) {
    const row=(await client.query("select id from public.auth_user where id=$1 and is_active and role='ADMIN' for share",[userId])).rows[0];
    if (!row) fail('ADMIN_REQUIRED','관리자 권한이 필요합니다.',403);
}
export async function checkDuplicate(client,key) {
    if ((await client.query('select id from public.action_log where request_key=$1',[key])).rowCount) fail('DUPLICATE_REQUEST','이미 처리된 요청입니다.');
}
export async function adminTransaction(pool,work) {
    const client=await pool.connect();
    try {
        await beginGameTransaction(client);
        const result=await work(client);
        await commitGameTransaction(client);
        return result;
    } catch(error) {
        await rollbackGameTransaction(client);
        if (error.code==='23505') fail('DUPLICATE_REQUEST','이미 등록되거나 처리된 요청입니다.');
        if (['23503','23514','22003','22007','22008'].includes(error.code)) fail('INVALID_ADMIN_INPUT','참조 대상 또는 DB 제약조건을 확인하세요.',400);
        throw error;
    } finally {client.release();}
}
