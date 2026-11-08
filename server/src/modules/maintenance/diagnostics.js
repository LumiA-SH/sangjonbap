import {AppError} from '../../shared/http.js';

// No caller-provided SQL, no game repository calls, no connection details returned.
export function createMaintenanceDiagnostics(pool) {
    return async function diagnoseDatabase() {
        const started=performance.now();
        let client;
        try {
            client=await pool.connect();
            await client.query('BEGIN READ ONLY');
            await client.query("SET LOCAL statement_timeout = '3000ms'");
            await client.query("SET LOCAL lock_timeout = '1000ms'");
            const {rows}=await client.query("SELECT 1 AS connected, current_setting('transaction_read_only') AS read_only");
            await client.query('ROLLBACK');
            if(rows[0]?.connected!==1||rows[0]?.read_only!=='on')throw new Error('Read-only diagnostic failed');
            return {connected:true,readOnly:true,durationMs:Math.round(performance.now()-started)};
        } catch {
            throw new AppError(503,'MAINTENANCE_DB_UNAVAILABLE','읽기 전용 DB 연결 진단에 실패했습니다.');
        } finally {
            // Destroy rather than return a potentially aborted transaction to the pool.
            if(client)client.release(true);
        }
    };
}
