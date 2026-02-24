import { io, server } from '../server/index.js';

function getRequestPathname(req) {
  // Optional route-injected override (useful with explicit rewrites).
  if (req && req.query && typeof req.query.__pathname === 'string') {
    return req.query.__pathname;
  }

  try {
    return new URL(req?.url || '/', 'http://localhost').pathname;
  } catch (e) {
    return req?.url || '/';
  }
}

function isSocketIoPath(pathname) {
  if (!pathname) return false;
  return pathname === '/socket.io' || pathname === '/socket.io/' || pathname.startsWith('/socket.io/');
}

// Vercel serverless entrypoint. Forward each request through the Node HTTP server
// so Express and Socket.IO request handlers share the same pipeline.
export default function handler(req, res) {
  const pathname = getRequestPathname(req);

  // Handle Socket.IO polling requests explicitly in serverless mode.
  // This avoids falling through to Express 404 when Vercel normalizes paths.
  if (isSocketIoPath(pathname) && io?.engine?.handleRequest) {
    const rawUrl = String(req?.url || '');
    const queryIndex = rawUrl.indexOf('?');
    const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : '';
    req.url = `${pathname}${query}`;
    io.engine.handleRequest(req, res);
    return;
  }

  server.emit('request', req, res);
}
