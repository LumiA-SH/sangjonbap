const {createProxyMiddleware} = require('http-proxy-middleware');

module.exports = function setupProxy(app, {target = 'http://127.0.0.1:4000'} = {}) {
  // CRA's package.json proxy rewrites Origin to its target, defeating the
  // API's frontend-origin check. Change Host only; preserve the browser Origin.
  app.use(createProxyMiddleware(
    pathname => pathname === '/api' || pathname.startsWith('/api/'),
    {target, changeOrigin: true, ws: false}
  ));
};
