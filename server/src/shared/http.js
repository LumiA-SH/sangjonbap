export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
export const ok = (res, data, status=200) => res.status(status).json({ok:true,data,requestId:res.locals.requestId});
export function errorHandler(err, req, res, next) {
  if(res.headersSent) return next(err);
  const badJson=err.type==='entity.parse.failed';
  const tooLarge=err.type==='entity.too.large';
  const status=err instanceof AppError ? err.status : badJson ? 400 : tooLarge ? 413 : 500;
  if(status===500) console.error('Request failed',res.locals.requestId); // No SQL, credentials or body in logs.
  res.status(status).json({ok:false,error:{code:err instanceof AppError ? err.code : badJson ? 'INVALID_JSON' : tooLarge ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR',message:status===500 ? '서버 처리 중 오류가 발생했습니다.' : badJson ? 'JSON 형식이 올바르지 않습니다.' : tooLarge ? '요청이 너무 큽니다.' : err.message},requestId:res.locals.requestId});
}
