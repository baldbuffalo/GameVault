/**
 * wiimote.js — WebHID Wii Remote handler for GameVault
 *
 * Supports:
 *  • Core buttons (D-pad, A, B, 1, 2, +, -, Home)
 *  • Player LED (LED 1 lit on connect)
 *  • Rumble (short pulse on selection confirm)
 *  • IR camera (basic pointer, mode 1)
 *  • Accelerometer (raw values exposed)
 *  • Falls back to Gamepad API when WebHID unavailable
 *
 * Usage:
 *   import { Wiimote } from './wiimote.js';
 *   const wm = new Wiimote();
 *   wm.on('button', ({ name, pressed }) => { ... });
 *   wm.on('ir',     ({ x, y, visible }) => { ... });
 *   wm.on('accel',  ({ x, y, z })       => { ... });
 *   wm.on('connected', (device)          => { ... });
 *   wm.on('disconnected', ()             => { ... });
 *   await wm.requestConnect(); // must be called from a user gesture
 */

// ── HID constants ────────────────────────────────────────────────────────────
const NINTENDO_VID = 0x057e;
const WM_PID       = 0x0306; // Wii Remote
const WM_PLUS_PID  = 0x0330; // Wii Remote Plus (MotionPlus inside)

// Output report IDs
const OUT_RUMBLE          = 0x10;
const OUT_LED             = 0x11;
const OUT_DATA_REPORTING  = 0x12;
const OUT_IR_ENABLE       = 0x13;
const OUT_SPEAKER_ENABLE  = 0x14;
const OUT_STATUS_REQUEST  = 0x15;
const OUT_WRITE_MEMORY    = 0x16;
const OUT_IR_ENABLE2      = 0x1a;

// Input report IDs
const IN_STATUS        = 0x20;
const IN_READ_DATA     = 0x21;
const IN_ACK           = 0x22;
const IN_BUTTONS_ONLY  = 0x30;
const IN_BTNS_ACCEL    = 0x31;
const IN_BTNS_IR10     = 0x36; // buttons + IR (10 bytes)
const IN_BTNS_ACCEL_IR = 0x33; // buttons + accel + IR (12 bytes)

// Button bitmasks (applied to the 2-byte core button field)
const BTN = {
  LEFT:  0x0100,
  RIGHT: 0x0200,
  DOWN:  0x0400,
  UP:    0x0800,
  PLUS:  0x1000,
  TWO:   0x0001,
  ONE:   0x0002,
  B:     0x0004,
  A:     0x0008,
  MINUS: 0x0010,
  HOME:  0x0080,
};

// IR sensitivity block (level 3 — good for living-room distances)
const IR_SENSITIVITY_1 = new Uint8Array([0x02, 0x00, 0x00, 0x71, 0x01, 0x00, 0xaa, 0x00, 0x64]);
const IR_SENSITIVITY_2 = new Uint8Array([0x63, 0x03]);

// ── Wiimote class ─────────────────────────────────────────────────────────────
export class Wiimote {
  constructor() {
    this._device      = null;
    this._listeners   = {};
    this._prevButtons = 0;
    this._rumbling    = false;
    this._irEnabled   = false;
    this._useWebHID   = 'hid' in navigator;
    this._gpIndex     = null;
    this._gpPollId    = null;
    this._lastGPBtns  = [];
    this._lastGPAxes  = [];

    // If WebHID is unavailable, watch for Gamepad API connections
    if (!this._useWebHID) {
      window.addEventListener('gamepadconnected',    e => this._onGamepadConnected(e));
      window.addEventListener('gamepaddisconnected', () => this._onGamepadDisconnected());
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get connected() {
    return this._useWebHID
      ? (this._device?.opened ?? false)
      : this._gpIndex !== null;
  }

  get supportsWebHID() { return this._useWebHID; }

  /** Call from a user-gesture handler (click, keydown, etc.) */
  async requestConnect() {
    if (this._useWebHID) {
      return this._connectWebHID();
    } else {
      // WebHID not available — instruct user to pair via OS Bluetooth
      this._emit('status', {
        type: 'info',
        message: 'WebHID not supported. Pair your Wii Remote via OS Bluetooth settings, then press any button.'
      });
      return false;
    }
  }

  async disconnect() {
    if (this._device?.opened) {
      await this._device.close();
    }
    if (this._gpPollId) cancelAnimationFrame(this._gpPollId);
    this._device   = null;
    this._gpIndex  = null;
    this._gpPollId = null;
    this._emit('disconnected');
  }

  /** Short rumble pulse (ms) */
  async rumble(ms = 120) {
    if (!this.connected || this._rumbling) return;
    this._rumbling = true;
    await this._sendReport(OUT_RUMBLE, [0x01]);
    setTimeout(async () => {
      await this._sendReport(OUT_RUMBLE, [0x00]);
      this._rumbling = false;
    }, ms);
  }

  on(event, cb) {
    (this._listeners[event] ??= []).push(cb);
    return this; // chainable
  }

  off(event, cb) {
    if (!cb) { this._listeners[event] = []; return; }
    this._listeners[event] = (this._listeners[event] ?? []).filter(f => f !== cb);
  }

  // ── WebHID internals ───────────────────────────────────────────────────────

  async _connectWebHID() {
    try {
      const devices = await navigator.hid.requestDevice({
        filters: [
          { vendorId: NINTENDO_VID, productId: WM_PID },
          { vendorId: NINTENDO_VID, productId: WM_PLUS_PID },
        ]
      });
      if (!devices.length) return false;

      this._device = devices[0];
      await this._device.open();
      this._device.addEventListener('inputreport', e => this._onInputReport(e));

      // Let the remote settle, then initialise
      await this._sleep(100);
      await this._init();

      this._emit('connected', this._device);
      return true;
    } catch (err) {
      console.error('[Wiimote] WebHID error:', err);
      this._emit('error', err);
      return false;
    }
  }

  async _init() {
    // 1. LED 1 on (player 1)
    await this._setLED(1);
    // 2. Request status to get battery level etc.
    await this._sendReport(OUT_STATUS_REQUEST, [0x00]);
    await this._sleep(50);
    // 3. Enable IR camera
    await this._enableIR();
    // 4. Set data reporting mode: buttons + accel + IR (0x33)
    await this._sendReport(OUT_DATA_REPORTING, [0x00, IN_BTNS_ACCEL_IR]);
  }

  async _setLED(player = 1) {
    const LED_BITS = [0x10, 0x20, 0x40, 0x80];
    const val = LED_BITS.slice(0, player).reduce((a, b) => a | b, 0);
    await this._sendReport(OUT_LED, [val]);
  }

  async _enableIR() {
    // Two-step enable
    await this._sendReport(OUT_IR_ENABLE,  [0x04]);
    await this._sendReport(OUT_IR_ENABLE2, [0x04]);

    // Write sensitivity block 1
    await this._writeMemory(0xb00000, IR_SENSITIVITY_1);
    await this._sleep(20);
    // Write sensitivity block 2
    await this._writeMemory(0xb0001a, IR_SENSITIVITY_2);
    await this._sleep(20);
    // Set IR mode = 1 (basic)
    await this._writeMemory(0xb00033, new Uint8Array([0x01]));
    await this._sleep(20);
    // Re-enable
    await this._sendReport(OUT_IR_ENABLE,  [0x04]);
    await this._sendReport(OUT_IR_ENABLE2, [0x04]);

    this._irEnabled = true;
  }

  async _writeMemory(address, data) {
    const report = new Uint8Array(22);
    report[0] = 0x04; // write to registers
    report[1] = (address >> 16) & 0xff;
    report[2] = (address >>  8) & 0xff;
    report[3] = (address      ) & 0xff;
    report[4] = data.length;
    for (let i = 0; i < data.length && i < 16; i++) report[5 + i] = data[i];
    await this._sendReport(OUT_WRITE_MEMORY, report);
    await this._sleep(20);
  }

  async _sendReport(id, data) {
    if (!this._device?.opened) return;
    try {
      await this._device.sendReport(id, new Uint8Array(data));
    } catch (e) {
      console.warn('[Wiimote] sendReport failed:', e);
    }
  }

  // ── Input report parsing ───────────────────────────────────────────────────

  _onInputReport(event) {
    const { reportId, data } = event;

    switch (reportId) {
      case IN_STATUS:       this._parseStatus(data);       break;
      case IN_BUTTONS_ONLY: this._parseButtons(data, 0);   break;
      case IN_BTNS_ACCEL:   this._parseBtnsAccel(data);    break;
      case IN_BTNS_ACCEL_IR:this._parseBtnsAccelIR(data);  break;
      case IN_BTNS_IR10:    this._parseBtnsIR10(data);     break;
      default: break;
    }
  }

  _parseButtons(data, offset) {
    const raw = (data.getUint8(offset) << 8) | data.getUint8(offset + 1);
    this._processButtons(raw);
    return raw;
  }

  _parseBtnsAccel(data) {
    const btns = this._parseButtons(data, 0);
    const ax = (data.getUint8(2) << 2) | ((btns & 0x6000) >> 13);
    const ay = (data.getUint8(3) << 2) | ((btns & 0x0020) >> 4);
    const az = (data.getUint8(4) << 2) | ((btns & 0x0040) >> 4);
    this._emit('accel', {
      x: (ax - 0x200) / 0x1ff,
      y: (ay - 0x200) / 0x1ff,
      z: (az - 0x200) / 0x1ff,
    });
  }

  _parseBtnsAccelIR(data) {
    this._parseBtnsAccel(data);
    // IR data starts at byte 6, 12 bytes, basic mode: 4 dots × 3 bytes
    const irData = [];
    for (let i = 0; i < 4; i++) {
      const base  = 6 + i * 3;
      const x_lo  = data.getUint8(base);
      const y_lo  = data.getUint8(base + 1);
      const extra = data.getUint8(base + 2);
      const x_hi  = (extra >> 4) & 0x03;
      const y_hi  = (extra >> 6) & 0x03;
      const size  = extra & 0x0f;
      const x     = (x_hi << 8) | x_lo;
      const y     = (y_hi << 8) | y_lo;
      irData.push({ x, y, size, visible: x !== 0x3ff });
    }
    this._processIR(irData);
  }

  _parseBtnsIR10(data) {
    this._parseButtons(data, 0);
    const irData = [];
    for (let i = 0; i < 4; i++) {
      const base = 2 + i * 2 + Math.floor(i / 2);
      const x_lo = data.getUint8(base);
      const y_lo = data.getUint8(base + 1);
      irData.push({ x: x_lo, y: y_lo, size: 0, visible: x_lo !== 0xff });
    }
    this._processIR(irData);
  }

  _parseStatus(data) {
    const btns    = this._parseButtons(data, 0);
    const flags   = data.getUint8(2);
    const battery = data.getUint8(5);
    this._emit('status', {
      type:      'battery',
      battery:   Math.round((battery / 0xc0) * 100),
      leds:      (flags >> 4) & 0x0f,
      speaker:   !!(flags & 0x04),
      ir:        !!(flags & 0x08),
      extension: !!(flags & 0x01),
    });
  }

  _processButtons(raw) {
    const prev = this._prevButtons;
    this._prevButtons = raw;

    for (const [name, mask] of Object.entries(BTN)) {
      const pressed  = !!(raw  & mask);
      const wasPrev  = !!(prev & mask);
      if (pressed !== wasPrev) {
        this._emit('button', { name, pressed });
      }
    }
  }

  _processIR(dots) {
    // Find first visible dot pair (sensor bar has 2 clusters)
    const visible = dots.filter(d => d.visible);
    if (!visible.length) {
      this._emit('ir', { x: null, y: null, visible: false, dots });
      return;
    }
    // Average the two brightest visible dots for the pointer position
    const avg = visible.slice(0, 2).reduce(
      (acc, d) => ({ x: acc.x + d.x, y: acc.y + d.y }),
      { x: 0, y: 0 }
    );
    const count = Math.min(visible.length, 2);
    // Normalise: IR camera is 1024×768 → 0..1 range, Y is inverted
    this._emit('ir', {
      x:       avg.x / count / 1023,
      y: 1.0 - avg.y / count / 767,
      visible: true,
      dots,
    });
  }

  // ── Gamepad API fallback ───────────────────────────────────────────────────

  _onGamepadConnected(event) {
    // Accept any gamepad; prefer Nintendo-named ones
    const gp = event.gamepad;
    const name = gp.id.toLowerCase();
    const isWiimote = name.includes('nintendo') || name.includes('wii') || name.includes('057e');
    if (this._gpIndex === null || isWiimote) {
      this._gpIndex = gp.index;
      this._emit('connected', { id: gp.id, type: 'gamepad' });
      this._startGamepadPoll();
    }
  }

  _onGamepadDisconnected() {
    if (this._gpPollId) cancelAnimationFrame(this._gpPollId);
    this._gpIndex = null;
    this._emit('disconnected');
  }

  _startGamepadPoll() {
    const poll = () => {
      const gp = navigator.getGamepads()[this._gpIndex];
      if (!gp) { this._gpPollId = requestAnimationFrame(poll); return; }

      const btns = gp.buttons.map(b => b.pressed);
      const axes = gp.axes;

      const changes = [
        { name: 'UP',    pressed: btns[12] || axes[1] < -0.5 },
        { name: 'DOWN',  pressed: btns[13] || axes[1] >  0.5 },
        { name: 'LEFT',  pressed: btns[14] || axes[0] < -0.5 },
        { name: 'RIGHT', pressed: btns[15] || axes[0] >  0.5 },
        { name: 'A',     pressed: btns[0] },
        { name: 'B',     pressed: btns[1] },
        { name: 'HOME',  pressed: btns[8] || btns[16] },
        { name: 'PLUS',  pressed: btns[9] },
        { name: 'MINUS', pressed: btns[8] },
        { name: 'ONE',   pressed: btns[2] },
        { name: 'TWO',   pressed: btns[3] },
      ];

      for (const ch of changes) {
        const prev = this._lastGPBtns[ch.name] ?? false;
        if (ch.pressed !== prev) {
          this._emit('button', ch);
          this._lastGPBtns[ch.name] = ch.pressed;
        }
      }

      this._gpPollId = requestAnimationFrame(poll);
    };
    this._gpPollId = requestAnimationFrame(poll);
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  _emit(event, ...args) {
    (this._listeners[event] ?? []).forEach(cb => cb(...args));
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

// ── Convenience singleton factory (for non-module usage via <script>) ─────────
// Attach to window so plain <script> pages can use it too
if (typeof window !== 'undefined') {
  window.Wiimote = Wiimote;
}
