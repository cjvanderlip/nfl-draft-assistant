import { createApiServer } from './api/server.js';

const port = Number(process.env.PORT ?? 3000);
const server = createApiServer();

server.on('error', (error: Error & { code?: string }) => {
  console.error('Failed to start Draft Sharks Companion API.', error);
  process.exitCode = 1;
});

server.listen(port, () => {
  console.log(`Draft Sharks Companion API listening on http://localhost:${port}`);
});
