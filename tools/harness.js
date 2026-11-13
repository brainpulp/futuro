// Loads index.html in jsdom so the ENGINE can be driven from Node — the same engine the
// app runs, never a second implementation of it.
//
// ⚠ jsdom has no canvas backend. Without the getContext stub the page script aborts
// partway through and every later `const` stays in its temporal dead zone, which presents
// as "runSim is not defined" rather than as a canvas error.
// ⚠ `S`, `EMPTY` and `_DEAL_COLORS` are let/const, so they are NOT on `window`. Reach
// them with `window.eval(...)`.
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

module.exports = function load(file) {
  const target = file || path.join(__dirname, '..', 'index.html');
  const html = fs.readFileSync(target, 'utf8')
    .replace(/<script[^>]*\bsrc=[^>]*><\/script>/g, '');   // strip the CDN tags
  // ⚠ The stub must be installed BEFORE the page parses. index.html builds its emoji
  // bitmaps in an IIFE at parse time, so a stub applied after `new JSDOM` arrives too
  // late: getContext() has already returned null and the script died on `.font`.
  // `beforeParse` is the only hook that runs early enough.
  const quiet = new VirtualConsole();
  quiet.on('jsdomError', () => {});          // jsdom's own "not implemented" noise
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/', virtualConsole: quiet,
    beforeParse(win) { stub(win); },
  });
  return dom.window;
};

function stub(w) {
  const noop = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => ({
    canvas: {}, measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    getImageData: () => ({ data: [] }), createImageData: () => ({ data: [] }),
    putImageData: noop, drawImage: noop,
    save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, fill: noop, arc: noop, rect: noop, fillRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop, setLineDash: noop, closePath: noop,
    translate: noop, scale: noop, rotate: noop, clip: noop,
  });
}
