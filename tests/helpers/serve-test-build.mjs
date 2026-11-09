import { createStudyStaticServer } from '../../scripts/serve.mjs';

const [directory, requested] = process.argv.slice(2);
const port = Number(requested);
if (!process.send || !directory || !Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('Expected a parent test runner, build directory and loopback port.');
}
const server = createStudyStaticServer(directory);
process.once('disconnect', () => server.close());
server.once('error', error => {
  console.error(error.message);
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
server.listen(port, '127.0.0.1', () => process.send({ port: server.address().port }));
