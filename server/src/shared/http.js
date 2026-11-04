export class AppError extends Error {
  constructor(status, code, message) { super(message); this.status=status; this.code=code; }
}
export const ok = (res, data, status=200) => res.status(status).json({ok:true,data,requestId:res.locals.requestId});
// Never serialize Error wholesale: pg detail/query and arbitrary messages can contain secrets.
export function developmentErrorDetails(err) {
  const message = String(err?.message || '');
  const schemaMessage = /^(?:column [a-zA-Z0-9_." ]+ does not exist|relation "[a-zA-Z0-9_.]+" does not exist)$/;
  return {
    code: /^[A-Z0-9_]{1,64}$/.test(err?.code || '') ? err.code : undefined,
    message: schemaMessage.test(message) ? message : 'Exception message omitted; inspect the stack location.',
    // Keep source locations only, excluding the message, SQL and connection URLs.
    stack: String(err?.stack || '').split('\n').filter(line => /^\s+at /.test(line))
      .filter(line => !/https?:|postgres(?:ql)?:|[?]|@/.test(line)).slice(0, 12)
  };
}
export function errorHandler(err, req, res, next) {
  if(res.headersSent) return next(err);
  const badJson=err.type==='entity.parse.failed';
  const tooLarge=err.type==='entity.too.large';
  const status=err instanceof AppError ? err.status : badJson ? 400 : tooLarge ? 413 : 500;
  if(status===500) {
    if(req.app?.locals?.developmentErrors) console.error('Request failed',res.locals.requestId,developmentErrorDetails(err));
    else console.error('Request failed',res.locals.requestId);
  }
  res.status(status).json({ok:false,error:{code:err instanceof AppError ? err.code : badJson ? 'INVALID_JSON' : tooLarge ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR',message:status===500 ? '서버 처리 중 오류가 발생했습니다.' : badJson ? 'JSON 형식이 올바르지 않습니다.' : tooLarge ? '요청이 너무 큽니다.' : err.message},requestId:res.locals.requestId});
}
