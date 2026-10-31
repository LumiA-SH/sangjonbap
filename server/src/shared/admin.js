import {AppError} from './http.js';

export function requireAdmin(req,res,next) {
    if (!req.auth?.user?.is_active || req.auth.user.role !== 'ADMIN') {
        throw new AppError(403,'ADMIN_REQUIRED','관리자 권한이 필요합니다.');
    }
    next();
}
