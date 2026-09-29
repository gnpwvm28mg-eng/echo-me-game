(() => {
  'use strict';
  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  const W = 360, H = 420, ROUND = 30, LOOP = 5;
  const TAU = Math.PI * 2;
  const ghostColors = ['#B599FF', '#FF8B9C', '#8AA7FF', '#FFB574', '#D8A4EC'];
  let scale = 1, offX = 0, offY = 0, dpr = 1;
  let state = 'idle', elapsed = 0, energy = 100, score = 0, starsTaken = 0;
  let player = { x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, vx: 0, vy: 0 };
  let ghosts = [], stars = [], recording = [], particles = [], ripples = [], trail = [];
  let seed = 1, rng, lastFrame = 0, segment = 0, lastSample = -1, lastTick = -1;
  let sound = true, audioCtx, pointerActive = false, pulse = 0, shake = 0;
  let visualClock = 0, lastSpawnPoint = { x: 180, y: 210 };
  const keys = new Set();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent('echo:' + name, { detail }));
  const snapshot = () => ({ state, score, time: Math.min(ROUND, elapsed), energy: Math.round(energy), ghosts: ghosts.length, stars: starsTaken, seed });
  function seeded(value) {
    let a = value >>> 0;
    return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hash(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value >>> 0;
    let h = 2166136261;
    for (const c of String(value || Date.now())) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    const cw = Math.max(1, r.width || W), ch = Math.max(1, r.height || H);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
    scale = Math.min(cw / W, ch / H);
    offX = (cw - W * scale) / 2; offY = (ch - H * scale) / 2;
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize);
  canvas.style.touchAction = 'none';
  resize();
  function unlockAudio() {
    if (!sound) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    } catch (_) { sound = false; }
  }
  function tone(freq, duration = .09, type = 'sine', volume = .07, bend = 1) {
    if (!sound || !audioCtx || audioCtx.state !== 'running') return;
    try {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * bend), t + duration);
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(volume, t + .008);
      gain.gain.exponentialRampToValueAtTime(.001, t + duration);
      osc.connect(gain); gain.connect(audioCtx.destination); osc.start(t); osc.stop(t + duration + .01);
    } catch (_) { /* audio never blocks play */ }
  }
  function nextStar(index) {
    let p;
    for (let i = 0; i < 30; i++) {
      p = { x: 35 + rng() * 290, y: 35 + rng() * 350 };
      if (dist(p, lastSpawnPoint) > 68 && stars.every((s, j) => j === index || dist(p, s) > 62)) break;
    }
    lastSpawnPoint = { x: p.x, y: p.y };
    return { ...p, phase: rng() * TAU, born: elapsed };
  }
  function start(value) {
    seed = hash(value); rng = seeded(seed);
    state = 'running'; elapsed = 0; energy = 100; score = 0; starsTaken = 0;
    player = { x: W / 2, y: H / 2, tx: W / 2, ty: H / 2, vx: 0, vy: 0 };
    ghosts = []; stars = []; recording = [{ t: 0, x: player.x, y: player.y }];
    particles = []; ripples = []; trail = []; segment = 0; lastSample = 0; lastTick = -1;
    keys.clear(); pointerActive = false; shake = 0; pulse = 0;
    lastSpawnPoint = { x: 180, y: 210 };
    for (let i = 0; i < 3; i++) stars.push(nextStar(i));
    unlockAudio(); tone(440, .09, 'sine', .04, 1.5);
    lastFrame = performance.now(); emit('tick', snapshot());
    return snapshot();
  }
  function pause() {
    if (state !== 'running') return;
    state = 'paused'; keys.clear(); pointerActive = false; player.tx = player.x; player.ty = player.y;
    emit('pause', snapshot());
  }
  function resume() {
    if (state !== 'paused') return;
    state = 'running'; lastFrame = performance.now(); unlockAudio(); emit('tick', snapshot());
  }
  function end(reason) {
    if (state !== 'running') return;
    state = 'ended'; score = starsTaken * 100 + Math.floor(elapsed * 10);
    keys.clear(); pointerActive = false;
    if (reason === 'win') {
      burst(player.x, player.y, '#BEFFD8', 42); tone(523, .17, 'sine', .07, 1.5);
      setTimeout(() => tone(784, .2, 'sine', .07, 1.333), 130);
    } else {
      shake = 8; burst(player.x, player.y, '#FF8B9C', 28); tone(160, .35, 'triangle', .1, .25);
      try { navigator.vibrate?.([30, 40, 45]); } catch (_) {}
    }
    emit('tick', snapshot()); emit('end', { ...snapshot(), reason });
  }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = 35 + Math.random() * 130;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .35 + Math.random() * .45, max: .8, r: 1.5 + Math.random() * 2.5, color });
    }
  }
  function setTarget(e) {
    const r = canvas.getBoundingClientRect();
    player.tx = clamp(((e.clientX - r.left) - offX) / scale, 17, W - 17);
    player.ty = clamp(((e.clientY - r.top) - offY) / scale, 17, H - 17);
  }
  canvas.addEventListener('pointerdown', e => {
    if (state !== 'running') return;
    e.preventDefault(); pointerActive = true; unlockAudio(); setTarget(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    ripples.push({ x: player.tx, y: player.ty, life: .5, color: '#BDF9C9' });
  });
  canvas.addEventListener('pointermove', e => {
    if (state === 'running' && pointerActive) { e.preventDefault(); setTarget(e); }
  });
  canvas.addEventListener('pointerup', () => { pointerActive = false; });
  canvas.addEventListener('pointercancel', () => { pointerActive = false; });
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (state === 'running' && ['arrowup','arrowdown','arrowleft','arrowright','w','a','s','d'].includes(k)) { e.preventDefault(); keys.add(k); }
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => { keys.clear(); if (state === 'running') pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'running') pause(); });
  function ghostPosition(g, phase) {
    const points = g.points;
    let lo = 0, hi = points.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (points[m].t <= phase) lo = m; else hi = m; }
    const a = points[lo], b = points[Math.min(lo + 1, points.length - 1)];
    const f = clamp((phase - a.t) / Math.max(.001, b.t - a.t), 0, 1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, vx: b.x - a.x, vy: b.y - a.y };
  }
  function update(dt) {
    const oldElapsed = elapsed;
    elapsed = Math.min(ROUND, elapsed + dt); energy = Math.max(0, energy - dt * 7);
    const keyboardX = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
    const keyboardY = (keys.has('arrowdown') || keys.has('s') ? 1 : 0) - (keys.has('arrowup') || keys.has('w') ? 1 : 0);
    if (keyboardX || keyboardY) {
      const n = Math.hypot(keyboardX, keyboardY);
      player.tx = clamp(player.x + keyboardX / n * 300 * dt, 17, W - 17);
      player.ty = clamp(player.y + keyboardY / n * 300 * dt, 17, H - 17);
    }
    const dx = player.tx - player.x, dy = player.ty - player.y, distance = Math.hypot(dx, dy);
    const step = Math.min(distance, dt * 390);
    const ox = player.x, oy = player.y;
    if (distance > .1) { player.x += dx / distance * step; player.y += dy / distance * step; }
    player.vx = (player.x - ox) / Math.max(dt, .001); player.vy = (player.y - oy) / Math.max(dt, .001);
    trail.push({ x: player.x, y: player.y, life: .34 });
    if (trail.length > 24) trail.shift();
    const currentSegment = Math.floor((elapsed + 1e-7) / LOOP);
    if (currentSegment > segment && elapsed < ROUND) {
      recording.push({ t: LOOP, x: player.x, y: player.y });
      const color = ghostColors[ghosts.length % ghostColors.length];
      ghosts.push({ points: recording, color, born: elapsed, x: recording[0].x, y: recording[0].y, vx: 0, vy: 0 });
      burst(recording[0].x, recording[0].y, color, 22);
      ripples.push({ x: recording[0].x, y: recording[0].y, life: 1, color });
      recording = [{ t: 0, x: player.x, y: player.y }]; segment = currentSegment; lastSample = 0;
      tone(290 + ghosts.length * 45, .2, 'triangle', .045, .6); emit('milestone', { ghosts: ghosts.length, time: elapsed });
    }
    const phase = elapsed - segment * LOOP;
    if (phase - lastSample > .035) { recording.push({ t: phase, x: player.x, y: player.y }); lastSample = phase; }
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      if (dist(player, star) < 25) {
        starsTaken++; energy = Math.min(100, energy + 25); pulse = 1;
        burst(star.x, star.y, '#F8D475', 15); ripples.push({ x: star.x, y: star.y, life: .45, color: '#F8D475' });
        tone(660 + (starsTaken % 5) * 90, .1, 'sine', .055, 1.35);
        stars[i] = nextStar(i);
      }
    }
    for (const ghost of ghosts) {
      Object.assign(ghost, ghostPosition(ghost, elapsed % LOOP));
      if (elapsed - ghost.born > 1.05 && dist(player, ghost) < 19.5) { end('ghost'); return; }
    }
    score = starsTaken * 100 + Math.floor(elapsed * 10);
    if (energy <= 0) { end('energy'); return; }
    if (elapsed >= ROUND) { end('win'); return; }
    if (elapsed - lastTick >= .08 || Math.floor(oldElapsed) !== Math.floor(elapsed)) { lastTick = elapsed; emit('tick', snapshot()); }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); }
  }
  function starShape(x, y, r, rotation = 0) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = rotation + i * Math.PI / 4; const z = i % 2 ? r * .32 : r; const px = x + Math.cos(a) * z, py = y + Math.sin(a) * z; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.closePath();
  }
  function blob(p, color, isGhost, index, opacity = 1) {
    ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = opacity;
    const speed = Math.min(1, Math.hypot(p.vx || 0, p.vy || 0) / (isGhost ? 12 : 300));
    const wobble = Math.sin(visualClock * 6 + index * 1.7) * .025;
    ctx.save(); ctx.translate(0, 15); ctx.scale(1, .3); ctx.fillStyle = '#02050C'; ctx.globalAlpha *= .3; ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill(); ctx.restore();
    ctx.scale(1 + wobble + speed * .05, 1 - wobble - speed * .04);
    ctx.shadowColor = color; ctx.shadowBlur = isGhost ? 13 : 20 + pulse * 12;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(-14, 1); ctx.bezierCurveTo(-15, -10, -7, -16, 1, -15); ctx.bezierCurveTo(12, -16, 17, -8, 15, 3); ctx.bezierCurveTo(14, 12, 8, 16, 0, 15); ctx.bezierCurveTo(-9, 16, -16, 11, -14, 1); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isGhost ? '#FFFFFF50' : '#D8FFE4'; ctx.lineWidth = isGhost ? 1 : 1.4; ctx.stroke();
    ctx.fillStyle = '#FFFFFF'; ctx.globalAlpha = opacity * .28; ctx.beginPath(); ctx.ellipse(-5, -9, 5, 2.5, -.45, 0, TAU); ctx.fill(); ctx.globalAlpha = opacity;
    const lookX = clamp((p.vx || 0) / (isGhost ? 8 : 160), -2, 2), lookY = clamp((p.vy || 0) / (isGhost ? 8 : 160), -1.5, 1.5);
    ctx.fillStyle = '#14273A';
    const blink = Math.sin(visualClock * .8 + index * 3) > .997;
    [-5, 5].forEach(x => { ctx.beginPath(); ctx.ellipse(x + lookX, -2 + lookY, 2, blink ? .65 : 3.2, 0, 0, TAU); ctx.fill(); });
    ctx.strokeStyle = '#14273A'; ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(lookX, 3 + lookY, 3, .1, Math.PI - .1); ctx.stroke();
    if (isGhost) {
      ctx.fillStyle = '#131C31'; ctx.beginPath(); ctx.arc(12, -13, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = color; ctx.font = 'bold 9px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(index + 1), 12, -13);
    } else {
      ctx.fillStyle = '#E7FFE9'; ctx.beginPath(); ctx.moveTo(-3, -17); ctx.lineTo(0, -21); ctx.lineTo(3, -17); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawBackground() {
    ctx.fillStyle = '#10182A'; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(180, 180, 10, 180, 180, 280); g.addColorStop(0, '#182438'); g.addColorStop(1, '#101727'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#B0C5E017';
    for (let x = 18; x < W; x += 24) for (let y = 18; y < H; y += 24) { ctx.beginPath(); ctx.arc(x, y, .85, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = '#91A8CA10'; ctx.lineWidth = 1; roundRect(9.5, 9.5, W - 19, H - 19, 18); ctx.stroke();
    if (state === 'running' && energy < 27) { ctx.fillStyle = `rgba(242,94,105,${(.05 + Math.sin(visualClock * 7) * .025) * (1 - energy / 40)})`; ctx.fillRect(0, 0, W, H); }
  }
  function drawStar(star, preview = false) {
    const bob = Math.sin(visualClock * 3 + star.phase) * 2.5;
    const x = star.x, y = star.y + bob;
    const grow = preview ? 1 : clamp((elapsed - star.born) * 5, 0, 1);
    ctx.save(); ctx.translate(x, y); ctx.scale(grow, grow);
    ctx.fillStyle = '#F8D4750B'; ctx.beginPath(); ctx.arc(0, 0, 22 + Math.sin(visualClock * 2 + star.phase) * 2, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#F8D47527'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.stroke();
    ctx.shadowColor = '#F8D475'; ctx.shadowBlur = 15; ctx.fillStyle = '#F9D679'; starShape(0, 0, 11, Math.sin(visualClock + star.phase) * .11); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#FFF4C5'; starShape(-1, -1, 5); ctx.fill(); ctx.restore();
  }
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#10182A'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * offX, dpr * offY);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    if (shake > .1) ctx.translate((Math.random() - .5) * shake, (Math.random() - .5) * shake);
    drawBackground();
    if (state === 'idle') {
      const t = visualClock * .55;
      const demoStars = [{ x: 90, y: 93, phase: 0 }, { x: 283, y: 155, phase: 1 }, { x: 112, y: 336, phase: 3 }];
      demoStars.forEach(s => drawStar(s, true));
      ctx.save(); ctx.setLineDash([2, 7]); ctx.strokeStyle = '#B599FF45'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(180, 217, 108, 106, -.25, 0, TAU); ctx.stroke(); ctx.restore();
      for (let i = 2; i >= 0; i--) {
        const a = t - i * 1.6;
        blob({ x: 180 + Math.sin(a) * 109, y: 217 + Math.cos(a) * 97, vx: Math.cos(a) * 50, vy: -Math.sin(a) * 50 }, i ? ghostColors[i - 1] : '#B9F9CC', i > 0, Math.max(0, i - 1), i ? .7 : 1);
      }
    } else {
      stars.forEach(s => drawStar(s));
      for (let i = 0; i < ghosts.length; i++) {
        const ghost = ghosts[i];
        const grace = clamp((elapsed - ghost.born) / 1.05, 0, 1);
        ctx.save(); ctx.strokeStyle = ghost.color; ctx.globalAlpha = .08; ctx.lineWidth = 1.2; ctx.setLineDash([2, 7]); ctx.beginPath();
        ghost.points.forEach((p, j) => j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.restore();
        if (grace < 1) { ctx.save(); ctx.strokeStyle = ghost.color; ctx.globalAlpha = .5 * (1 - grace); ctx.lineWidth = 1; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.arc(ghost.x, ghost.y, 32 - grace * 8, 0, TAU); ctx.stroke(); ctx.restore(); }
        blob(ghost, ghost.color, true, i, grace < 1 ? .3 + grace * .4 : .84);
      }
      for (const dot of trail) { ctx.globalAlpha = dot.life * .4; ctx.fillStyle = '#B9F9CC'; ctx.beginPath(); ctx.arc(dot.x, dot.y, 6 * dot.life / .34, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (state === 'running' && dist(player, { x: player.tx, y: player.ty }) > 20) { ctx.strokeStyle = '#B9F9CC45'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(player.tx, player.ty, 5, 0, TAU); ctx.stroke(); }
      blob(player, '#B9F9CC', false, -1);
      // A tiny countdown arc makes the five-second echo cycle legible without text.
      ctx.strokeStyle = '#B599FF45'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(player.x, player.y, 22, -Math.PI / 2, -Math.PI / 2 + (elapsed % LOOP) / LOOP * TAU); ctx.stroke();
    }
    for (const p of particles) { ctx.globalAlpha = clamp(p.life / .5, 0, 1); ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * clamp(p.life * 3, .2, 1), 0, TAU); ctx.fill(); }
    for (const ripple of ripples) { ctx.globalAlpha = ripple.life * .8; ctx.strokeStyle = ripple.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ripple.x, ripple.y, 8 + (1 - ripple.life) * 36, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.restore();
  }
  function frame(now) {
    const dt = Math.min(.04, Math.max(0, (now - (lastFrame || now)) / 1000)); lastFrame = now;
    visualClock += dt;
    if (state === 'running') update(dt);
    if (state !== 'paused') {
      particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .98; p.vy *= .98; p.life -= dt; });
      particles = particles.filter(p => p.life > 0);
      ripples.forEach(p => p.life -= dt * 1.5); ripples = ripples.filter(p => p.life > 0);
      trail.forEach(p => p.life -= dt); trail = trail.filter(p => p.life > 0);
      pulse = Math.max(0, pulse - dt * 4); shake = Math.max(0, shake - dt * 24);
    }
    render(); requestAnimationFrame(frame);
  }
  window.EchoGame = { start, pause, resume, setSound(value) { sound = Boolean(value); if (sound) unlockAudio(); return sound; }, getState: snapshot };
  requestAnimationFrame(frame);
})();
