// CRA supplies the same public base to development and production builds.
export function publicAsset(path) {
  return (process.env.PUBLIC_URL || '').replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}
