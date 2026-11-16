// input.js — keyboard and mouse, normalised into one small object.
//
// The simulation reads `keys` (held) and `consume(code)` (pressed once), never the DOM
// events themselves, so a bot or a capture pose could drive the same interface. Pointer
// lock is requested on the first click; losing it clears every held key so a tab switch
// cannot leave the player running into a wall.
export function createInput(canvas, state, audio) {
  const keys = new Set();
  const pressed = new Set();
  const input = {
    keys,
    pressed,
    dx: 0,
    dy: 0,
    fire: false,
    aim: false,
    locked: false,
    consume(code) {
      const had = pressed.has(code);
      pressed.delete(code);
      return had;
    },
  };

  const BLOCKED_DEFAULT = [
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ControlLeft', 'ControlRight',
    'ShiftLeft', 'ShiftRight', 'KeyR', 'KeyB', 'KeyE', 'KeyG', 'KeyF',
    'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Tab',
  ];

  addEventListener('keydown', (event) => {
    if (BLOCKED_DEFAULT.includes(event.code)) event.preventDefault();
    if (!keys.has(event.code)) pressed.add(event.code);
    keys.add(event.code);
  });
  addEventListener('keyup', (event) => keys.delete(event.code));
  addEventListener('blur', () => {
    keys.clear();
    input.fire = false;
    input.aim = false;
  });
  addEventListener('mousemove', (event) => {
    if (!input.locked) return;
    input.dx += event.movementX;
    input.dy += event.movementY;
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) {
      input.fire = false;
      input.aim = false;
      keys.clear();
    }
  });
  canvas.addEventListener('mousedown', (event) => {
    audio.unlock();
    if (!input.locked && !state.shot) {
      state.started = true;
      canvas.requestPointerLock();
      return;
    }
    if (event.button === 0) input.fire = true;
    if (event.button === 2) input.aim = true;
  });
  addEventListener('mouseup', (event) => {
    if (event.button === 0) input.fire = false;
    if (event.button === 2) input.aim = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return input;
}
