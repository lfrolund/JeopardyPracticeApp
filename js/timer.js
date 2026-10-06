// Countdown ring for a clue. The gold arc starts full and empties clockwise from 12 o'clock,
// with the whole seconds left in the middle. Calls onExpire once when it reaches zero.
const SIZE = 52;
const STROKE = 5;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;
const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

export function countdown(seconds, onExpire) {
  const wrap = document.createElement('div');
  wrap.className = 'timer';
  wrap.setAttribute('role', 'timer');
  const ring = svg('svg', { width: SIZE, height: SIZE, viewBox: `0 0 ${SIZE} ${SIZE}`, 'aria-hidden': 'true' });
  const c = SIZE / 2;
  ring.append(
    svg('circle', { class: 'timer-track', cx: c, cy: c, r: R, 'stroke-width': STROKE, fill: 'none' }),
    // Rotated so the arc starts at 12 o'clock; SVG draws circles clockwise, so a growing
    // dash offset opens the gap at the top and sweeps it clockwise.
    svg('circle', {
      class: 'timer-arc', cx: c, cy: c, r: R, 'stroke-width': STROKE, fill: 'none',
      'stroke-dasharray': CIRCUMFERENCE, 'stroke-dashoffset': 0, transform: `rotate(-90 ${c} ${c})`,
    }),
  );
  const label = document.createElement('span');
  label.className = 'timer-label';
  wrap.append(ring, label);
  const arc = ring.lastChild;

  const total = seconds * 1000;
  let start = performance.now();
  let frame = 0;
  let running = true;

  function draw(left) {
    const frac = Math.max(0, left / total);
    arc.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE * (1 - frac)));
    const secs = Math.ceil(left / 1000);
    label.textContent = String(Math.max(0, secs));
    wrap.classList.toggle('low', left <= 5000);
    wrap.setAttribute('aria-label', `${Math.max(0, secs)} seconds left`);
  }

  function tick(now) {
    if (!running) return;
    // Stop quietly if the clue was closed without stopping the timer.
    if (!wrap.isConnected && now - start > 1000) { running = false; return; }
    const left = total - (now - start);
    draw(left);
    if (left <= 0) {
      running = false;
      wrap.classList.add('expired');
      onExpire();
      return;
    }
    frame = requestAnimationFrame(tick);
  }

  draw(total);
  frame = requestAnimationFrame(tick);

  return {
    el: wrap,
    stop() {
      running = false;
      cancelAnimationFrame(frame);
      wrap.classList.add('stopped');
    },
    restart() {
      cancelAnimationFrame(frame);
      wrap.classList.remove('stopped', 'expired');
      start = performance.now();
      running = true;
      draw(total);
      frame = requestAnimationFrame(tick);
    },
  };
}
