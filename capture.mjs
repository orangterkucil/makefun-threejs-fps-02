// capture.mjs — four real screenshots from the live page, over CDP, in headless Chrome.
//
// This is deliberately not a mock-up pipeline: it boots the same static server the game
// runs behind, launches Chrome with SwiftShader so WebGL works without a GPU, navigates to
// ?shot=<pose>, waits until the page has actually rendered frames, and only then asks the
// browser for a PNG. Every frame counter and every console error is printed, so a failed
// capture is loud rather than silent.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WIDTH = 1280;
const HEIGHT = 720;
const VIEWPORT = { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false };
const shots = JSON.parse(readFileSync(new URL('./shots.json', import.meta.url), 'utf8'));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function freePort() {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });
}

async function waitFor(url, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.text();
    } catch { /* not up yet */ }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${url}`);
}

// A very small CDP client: one socket, one id counter, session-scoped commands.
function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = [];
  let nextId = 1;

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
      else resolve(message.result);
      return;
    }
    for (const listener of listeners) listener(message);
  });

  const ready = new Promise((done, fail) => {
    socket.addEventListener('open', () => done());
    socket.addEventListener('error', () => fail(new Error('cdp socket error')));
  });

  return {
    ready,
    on: (listener) => listeners.push(listener),
    close: () => socket.close(),
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.delete(id)) reject(new Error(`cdp timeout: ${method}`));
        }, 40000);
      });
    },
  };
}

const chromePath = process.env.CHROME_PATH
  ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((candidate) => {
    try { return readFileSync(candidate) && candidate; } catch { return false; }
  });
if (!chromePath) throw new Error('no chrome binary found; set CHROME_PATH');

const httpPort = await freePort();
const debugPort = await freePort();
const server = spawn(process.execPath, ['--experimental-strip-types', 'serve.ts', '--port', String(httpPort), '--root', 'game'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => process.stdout.write(`[serve] ${chunk}`));
server.stderr.on('data', (chunk) => process.stderr.write(`[serve] ${chunk}`));

const profile = resolve(`.capture-profile-${process.pid}`);
mkdirSync(profile, { recursive: true });
const chrome = spawn(chromePath, [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-default-browser-check',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--force-device-scale-factor=1',
  `--window-size=${WIDTH},${HEIGHT}`,
  `--user-data-dir=${profile}`,
  `--remote-debugging-port=${debugPort}`,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
const chromeLog = [];
chrome.stderr.on('data', (chunk) => chromeLog.push(String(chunk)));

const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch { /* already gone */ }
  try { server.kill('SIGKILL'); } catch { /* already gone */ }
  // The throwaway browser profile is a build artefact, not part of the entry: drop it so the
  // working tree stays clean after a capture run.
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* already gone */ }
};
process.on('exit', cleanup);

let failures = 0;
try {
  const version = JSON.parse(await waitFor(`http://127.0.0.1:${debugPort}/json/version`));
  console.log(`[capture] ${version.Browser} on ${chromePath}`);

  const client = connect(version.webSocketDebuggerUrl);
  await client.ready;

  const consoleErrors = [];
  client.on((message) => {
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails.text + ' ' + (message.params.exceptionDetails.exception?.description ?? ''));
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
  });

  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => client.send(method, params, sessionId);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  mkdirSync('screenshots', { recursive: true });

  for (const shot of shots) {
    const url = `http://127.0.0.1:${httpPort}/index.html?shot=${encodeURIComponent(shot.pose)}&seed=7`;
    consoleErrors.length = 0;
    await send('Page.navigate', { url });

    // Wait for real frames, not for the load event: the loop sets this after it draws.
    const deadline = Date.now() + 40000;
    let frames = 0;
    let webgl = '';
    while (Date.now() < deadline) {
      const probe = await send('Runtime.evaluate', {
        expression: `(() => {
          const api = window.__saltline;
          if (!api) return { ready: false };
          const gl = api.renderer.getContext();
          return {
            ready: Boolean(window.__shotReady),
            frames: api.frameCount,
            tris: api.renderer.info.render.triangles,
            gl: gl ? gl.getParameter(gl.VERSION) : 'none',
            state: api.state.phase,
          };
        })()`,
        returnByValue: true,
      });
      const value = probe.result?.value ?? { ready: false };
      frames = value.frames ?? 0;
      webgl = value.gl ?? '';
      if (value.ready && frames > 24) break;
      await sleep(150);
    }
    if (frames <= 24) throw new Error(`pose ${shot.pose} never rendered (frames=${frames})`);

    await sleep(shot.wait);
    const shotResult = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = join('screenshots', `${shot.name}.png`);
    writeFileSync(file, Buffer.from(shotResult.data, 'base64'));
    const size = Buffer.from(shotResult.data, 'base64').length;
    console.log(`[capture] ${file} ${WIDTH}x${HEIGHT} ${size} bytes · frames=${frames} · ${webgl}`);
    if (consoleErrors.length) {
      failures++;
      console.log(`[capture] page errors during ${shot.name}:\n  ${consoleErrors.join('\n  ')}`);
    }
  }

  const stats = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__saltline.renderer.info.render)',
    returnByValue: true,
  });
  console.log(`[capture] render info ${stats.result?.value}`);
  client.close();
} finally {
  cleanup();
}

if (failures) {
  console.log(chromeLog.slice(-40).join(''));
  process.exitCode = 1;
}
console.log(failures ? `[capture] FAILED with ${failures} pose(s) reporting page errors` : '[capture] all poses captured');
