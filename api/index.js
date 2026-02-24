import { server } from '../server/index.js';

// Vercel serverless entrypoint. Forward each request through the Node HTTP server
// so Express and Socket.IO request handlers share the same pipeline.
export default function handler(req, res) {
  server.emit('request', req, res);
}
