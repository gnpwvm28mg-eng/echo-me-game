/* 别撞昨天的我 — page, results and challenge sharing. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const GAME_SECONDS = 30;
  const MAX_SCORE = 1000000;
  const STORAGE_KEY = 'echo-me:v1';
  let uiState = 'intro';
  let mode = 'random';
  let sound = false;
  let best = { score: 0, time: 0 };
  let currentSeed = randomSeed();
  let result = null;
  let toastTimer;
  let helpReturn = 'intro';
  let challenge = null;

  function randomSeed() {
    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint32Array(1);
      window.crypto.getRandomValues(bytes);
      return bytes[0] || 1;
    }
    return (Math.floor(Math.random() * 4294967295) >>> 0) || 1;
  }

  function dailySeed() {
    const key = 'echo-me:' + new Date().toISOString().slice(0, 10);
    let hash = 2166136261;
    for (let i = 0; i < key.length; i += 1) {
      hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
    }
    return (hash >>> 0) || 1;
  }

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizedScore(value) {
    return Math.max(0, Math.min(MAX_SCORE, Math.floor(finite(value))));
  }

  function normalizedTime(value) {
    return Math.max(0, Math.min(GAME_SECONDS, finite(value)));
  }

  function show(id, visible) {
    const element = $(id);
    if (element) element.hidden = !visible;
  }

  function text(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value);
  }

  function setState(next) {
    uiState = next;
    const shell = $('gameShell');
    if (shell) shell.dataset.state = next;
    document.body.classList.toggle('is-playing', next === 'playing');
    show('intro', next === 'intro');
    show('result', next === 'result');
    show('paused', next === 'paused');
    show('help', next === 'help');
    const pauseButton = $('pauseBtn');
    if (pauseButton) pauseButton.disabled = next !== 'playing';
  }

  function toast(message, duration = 2800) {
    clearTimeout(toastTimer);
    text('toast', message);
    const element = $('toast');
    if (element) {
      element.hidden = false;
      element.classList.add('visible');
      toastTimer = setTimeout(() => {
        element.classList.remove('visible');
        element.hidden = true;
      }, duration);
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ best, sound }));
    } catch (_) {
      // Private browsing and full storage must not interrupt a round.
    }
  }

  function readSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.best) {
        best = {
          score: normalizedScore(saved.best.score),
          time: normalizedTime(saved.best.time)
        };
      }
      sound = Boolean(saved && saved.sound === true);
    } catch (_) {
      sound = false;
    }
  }

  function readChallenge() {
    const params = new URLSearchParams(location.search);
    const seed = params.get('seed');
    const beat = params.get('beat');
    if (!seed || !/^\d{1,10}$/.test(seed)) return;
    const numberSeed = Number(seed);
    if (!Number.isSafeInteger(numberSeed) || numberSeed < 1 || numberSeed > 4294967295) return;
    currentSeed = numberSeed;
    if (beat === null || !/^\d{1,7}$/.test(beat)) return;
    const numberBeat = Number(beat);
    if (numberBeat < 0 || numberBeat > MAX_SCORE) return;
    const survived = params.get('survived');
    const numberSurvived = survived === null ? 0 : Number(survived);
    if (!Number.isFinite(numberSurvived) || numberSurvived < 0 || numberSurvived > GAME_SECONDS) return;
    challenge = { seed: numberSeed, score: numberBeat, time: numberSurvived };
    mode = 'challenge';
  }

  function updateMode() {
    text('modeLabel', mode === 'daily' ? '今日同一局' : mode === 'challenge' ? '好友挑战' : '自由挑战');
    show('challengeBanner', mode === 'challenge' && Boolean(challenge));
    if (challenge && mode === 'challenge') {
      text('challengeText', `朋友留下 ${challenge.score} 分 · ${challenge.time.toFixed(1)} 秒，轮到你了。`);
      text('startBtn', '接招，超越 TA');
    } else {
      text('startBtn', '开始 · 先活 30 秒');
    }
  }

  function applySound() {
    const button = $('soundBtn');
    if (button) {
      button.setAttribute('aria-pressed', String(sound));
      button.setAttribute('aria-label', sound ? '关闭音效' : '打开音效');
      button.title = sound ? '音效已开' : '音效已关';
      button.dataset.sound = sound ? 'on' : 'off';
      const label = button.querySelector('[data-sound-label]');
      if (label) label.textContent = sound ? '音效开' : '音效关';
      else button.textContent = sound ? '♪ 音效开' : '♪ 音效关';
    }
    if (window.EchoGame) window.EchoGame.setSound(sound);
  }

  function resetHud() {
    text('scoreValue', '0');
    text('timeValue', '30.0');
    text('ghostValue', '0');
    const energy = $('energyFill');
    if (energy) {
      energy.style.width = '100%';
      energy.style.transform = '';
      energy.parentElement?.setAttribute('aria-valuenow', '100');
    }
  }

  function startRound(kind = 'retry') {
    if (!window.EchoGame || typeof window.EchoGame.start !== 'function') {
      toast('游戏还在准备，马上就好。');
      return;
    }
    if (kind === 'daily') {
      mode = 'daily';
      currentSeed = dailySeed();
    } else if (kind === 'new') {
      mode = 'random';
      currentSeed = randomSeed();
    }
    result = null;
    show('shareFallback', false);
    resetHud();
    updateMode();
    setState('playing');
    applySound();
    window.EchoGame.start(currentSeed);
  }

  function pauseRound() {
    if (uiState !== 'playing') return;
    setState('paused');
    window.EchoGame?.pause();
  }

  function resumeRound() {
    if (uiState !== 'paused') return;
    setState('playing');
    window.EchoGame?.resume();
  }

  function openHelp() {
    if (uiState === 'help') return;
    helpReturn = uiState;
    setState('help');
    if (helpReturn === 'playing') window.EchoGame?.pause();
  }

  function closeHelp() {
    setState(helpReturn);
    if (helpReturn === 'playing') window.EchoGame?.resume();
  }

  function goHome() {
    window.EchoGame?.pause();
    setState('intro');
    updateMode();
  }

  function handleTick(event) {
    const data = event.detail || {};
    text('scoreValue', normalizedScore(data.score));
    text('timeValue', Math.max(0, GAME_SECONDS - normalizedTime(data.time)).toFixed(1));
    text('ghostValue', Math.max(0, Math.floor(finite(data.ghosts))));
    const value = Math.max(0, Math.min(100, finite(data.energy, 100)));
    const bar = $('energyFill');
    if (bar) {
      bar.style.width = `${value}%`;
      bar.classList.toggle('low', value < 25);
      bar.parentElement?.setAttribute('aria-valuenow', String(Math.round(value)));
    }
  }

  function handleEnd(event) {
    const data = event.detail || {};
    result = {
      score: normalizedScore(data.score),
      time: normalizedTime(data.time),
      reason: ['ghost', 'energy', 'win'].includes(data.reason) ? data.reason : 'ghost',
      ghosts: Math.max(0, Math.floor(finite(data.ghosts))),
      stars: Math.max(0, Math.floor(finite(data.stars)))
    };
    const newBest = result.score > best.score || (result.score === best.score && result.time > best.time);
    if (newBest) {
      best = { score: result.score, time: result.time };
      persist();
    }
    text('bestValue', best.score);
    show('bestBadge', newBest);
    text('bestBadge', '刷新个人纪录');
    text('resultScore', result.score);
    text('resultStats', `存活 ${result.time.toFixed(1)} 秒 · ${result.ghosts} 个过去的我 · 收集 ${result.stars} 颗能量`);
    let eyebrow = '这一局，你和自己过了几招';
    let title;
    let quip;
    if (result.reason === 'win') {
      title = '和过去和解了。';
      quip = '30 秒全身而退。把同一局发给朋友，看看谁更会躲自己。';
    } else if (result.reason === 'energy') {
      title = '电量比嘴硬先没了。';
      quip = '光会躲还不够，记得捡能量。下一局，贪一点点。';
    } else if (result.time < 10) {
      title = '被自己拿捏了。';
      quip = '刚才走过的路，转眼就来堵你。再试一次，给未来留条路。';
    } else if (result.time < 20) {
      title = '过去的我，太懂我了。';
      quip = '它只是重复你的路线，但你已经可以换个活法。';
    } else {
      title = '差一点，就放过自己了。';
      quip = `坚持了 ${result.time.toFixed(1)} 秒。最难躲开的，果然是自己。`;
    }
    if (mode === 'challenge' && challenge) {
      const won = result.score > challenge.score || (result.score === challenge.score && result.time > challenge.time + 0.049);
      const tied = result.score === challenge.score && Math.abs(result.time - challenge.time) <= 0.049;
      eyebrow = won ? `接招成功 · 超过朋友的 ${challenge.score} 分` : tied ? `势均力敌 · 和朋友打平了` : `朋友 ${challenge.score} 分 · 你的 ${result.score} 分`;
      if (won) quip = '这局你赢了。把挑战丢回去：现在，换你来追我。';
      else if (tied) quip = '同一张地图，同一种默契。再来一次，分个高下。';
      else quip = `距离朋友的 ${challenge.score} 分，还有一次「再来一局」。`;
    }
    text('resultEyebrow', eyebrow);
    text('resultTitle', title);
    text('resultQuip', quip);
    show('shareFallback', false);
    setState('result');
  }

  function challengeUrl() {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('seed', String(currentSeed));
    url.searchParams.set('beat', String(result ? result.score : best.score));
    url.searchParams.set('survived', (result ? result.time : best.time).toFixed(1));
    return url.href;
  }

  function shareText() {
    const score = result ? result.score : best.score;
    const time = (result ? result.time : best.time).toFixed(1);
    return `我的对手是几秒前的自己，居然也能输。\n《别撞昨天的我》我撑了 ${time} 秒，拿下 ${score} 分。\n同一局你能超过我吗？点开就能玩。`;
  }

  function showCopyFallback(url) {
    show('shareFallback', true);
    const input = $('shareUrl');
    if (input) {
      input.value = url;
      input.focus({ preventScroll: true });
      input.select();
      input.setSelectionRange(0, input.value.length);
    }
    toast('长按或选中链接复制，发给朋友接招。', 4000);
  }

  async function copyChallenge() {
    const url = challengeUrl();
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      toast('挑战链接已复制，发给朋友接招！');
    } catch (_) {
      showCopyFallback(url);
    }
  }

  async function shareChallenge() {
    const url = challengeUrl();
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: '别撞昨天的我 · 来接招', text: shareText(), url });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;
      }
    }
    await copyChallenge();
  }

  function listen(id, action) {
    $(id)?.addEventListener('click', action);
  }

  function init() {
    readSaved();
    readChallenge();
    text('bestValue', best.score);
    updateMode();
    setState('intro');
    applySound();
    listen('startBtn', () => startRound());
    listen('dailyBtn', () => startRound('daily'));
    listen('retryBtn', () => startRound());
    listen('newBtn', () => startRound('new'));
    listen('pauseBtn', pauseRound);
    listen('resumeBtn', resumeRound);
    listen('helpBtn', openHelp);
    listen('closeHelpBtn', closeHelp);
    listen('homeBtn', goHome);
    listen('shareBtn', shareChallenge);
    listen('copyBtn', copyChallenge);
    listen('selectUrlBtn', () => {
      const input = $('shareUrl');
      if (input) {
        input.focus();
        input.select();
        input.setSelectionRange(0, input.value.length);
        toast('链接已选中，长按选择复制。');
      }
    });
    listen('soundBtn', () => {
      sound = !sound;
      applySound();
      persist();
      toast(sound ? '音效已开启' : '音效已关闭');
    });
    window.addEventListener('echo:tick', handleTick);
    window.addEventListener('echo:end', handleEnd);
    window.addEventListener('echo:milestone', (event) => {
      const count = Math.max(1, Math.floor(finite(event.detail?.ghosts, 1)));
      toast(`第 ${count} 个过去的你，上线了。`, 1600);
    });
    window.addEventListener('echo:pause', () => {
      if (uiState === 'playing') setState('paused');
    });
    window.addEventListener('keydown', (event) => {
      if (event.repeat || event.altKey || event.metaKey || event.ctrlKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (event.key === 'Escape') {
        if (uiState === 'help') closeHelp();
        else if (uiState === 'playing') pauseRound();
        else if (uiState === 'paused') resumeRound();
      } else if (event.key === 'Enter' && uiState === 'intro' && tag !== 'BUTTON') {
        event.preventDefault();
        startRound();
      } else if (event.key.toLowerCase() === 'r' && (uiState === 'result' || uiState === 'paused')) {
        event.preventDefault();
        startRound();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && uiState === 'playing') pauseRound();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
