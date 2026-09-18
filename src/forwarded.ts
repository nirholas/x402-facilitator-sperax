/**
 * Cloud Run, Cloudflare and other proxies terminate TLS in front of the app,
 * so the request URL the server sees starts with http://. x402 publishes that
 * URL as the 402's resource.url, which must be the one clients actually call,
 * so rebuild it from the proxy's X-Forwarded-Proto.
 */
export function withForwardedProto(req: Request): Request {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (proto !== 'https' || !req.url.startsWith('http://')) return req;
  const url = `https://${req.url.slice('http://'.length)}`;
  const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers: req.headers, redirect: req.redirect };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }
  return new Request(url, init);
}
