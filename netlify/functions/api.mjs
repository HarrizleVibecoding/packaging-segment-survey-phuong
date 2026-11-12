// Runs server.js's handler as a Netlify Function for /api/* and /images/*.
// The pages themselves (index.html, app.js, style.css) are served as static files from public/.
let handlerPromise;

function loadHandler(deployContext) {
  // Data lives in this site's Netlify Blobs. Deploy previews and branch deploys use a separate
  // store and "TEST - ..." Sheet tabs, like Vercel previews, so tests never touch real data.
  process.env.STORAGE = 'netlify';
  if (process.env.DATA_PREFIX === undefined) process.env.DATA_PREFIX = deployContext === 'production' ? '' : 'preview/';
  return handlerPromise ??= import('../../server.js').then(module => module.handler);
}

// server.js speaks Node's req/res; translate from the web Request/Response that Netlify uses.
export async function runNodeHandler(handler, request) {
  const body = request.body ? Buffer.from(await request.arrayBuffer()) : null;
  const url = new URL(request.url);
  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers: { ...Object.fromEntries(request.headers), host: url.host },
    async *[Symbol.asyncIterator]() { if (body) yield body; }
  };
  return new Promise((resolve, reject) => {
    let status = 200, headers = {};
    const res = {
      writeHead(code, values = {}) { status = code; headers = values; return res; },
      end(chunk) { resolve(new Response(chunk ?? null, { status, headers })); }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

export default async (request, context) => runNodeHandler(await loadHandler(context?.deploy?.context), request);

export const config = { path: ['/api/*', '/images/*'] };
