// Runs the server and web dev processes together. Ctrl+C (or either process
// exiting) stops both, so no server is left holding the port.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = ['server', 'web'].map((ws) =>
  spawn(npm, ['run', 'dev', '--workspace', ws], { stdio: 'inherit' }),
);

let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 3000).unref();
  Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.once('exit', r))))).then(
    () => process.exit(code),
  );
}

for (const child of children) child.on('exit', (code) => stop(code ?? 0));
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
