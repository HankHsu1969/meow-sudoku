/* 喵喵數獨 — 遊戲主程式 */
(function () {
  'use strict';

  const $ = sel => document.querySelector(sel);
  const LEVELS = window.LEVELS;
  const A = window.MeowAudio;
  const MAX_MISTAKES = 3;
  const MAX_HINTS = 3;

  const CHAPTERS = [
    { name: '毛線球', diff: '入門', icon: 'yarn', color: '#FF9BB5' },
    { name: '小魚乾', diff: '簡單', icon: 'fish', color: '#FFAE78' },
    { name: '貓抓板', diff: '普通', icon: 'scratch', color: '#6FCBB0' },
    { name: '貓薄荷', diff: '困難', icon: 'leaf', color: '#A88BEA' },
    { name: '貓咪之王', diff: '專家', icon: 'crown', color: '#F5B82E' },
  ];
  const chapterOf = lv => CHAPTERS[Math.floor((lv - 1) / 10)];

  const IMG = { think: 'img/cat_think.png', star: 'img/cat_star.png', sad: 'img/cat_sad.png', wave: 'img/cat_wave.png' };
  Object.values(IMG).forEach(src => { new Image().src = src; });

  const SAY = {
    start: ['一起加油喵！', '慢慢來不用急喵～', '動動腦時間喵！', '今天也要努力喵！'],
    resume: ['歡迎回來喵！', '繼續剛剛的喵～'],
    good: ['好厲害喵！', '喵嗚～漂亮！', '就是這樣喵！', '繼續保持喵！'],
    unit: ['完成一排了喵！', '太棒了喵～！', '喵喵喵！好強！', '整齊又漂亮喵！'],
    wrong: ['咦？不太對喵…', '再想想看喵～', '小心一點喵！'],
    last: ['只剩最後一次機會喵！'],
    hint: ['偷偷告訴你喵～', '這格是這個喵！'],
    noHint: ['提示用完了喵～'],
    pickCell: ['先點一個格子喵～'],
    locked: ['這格已經填好了喵'],
    noUndo: ['沒有可以復原的喵'],
    notesOn: ['筆記模式開啟喵'],
    notesOff: ['筆記模式關閉喵'],
  };

  // ───────────────────────── 存檔 ─────────────────────────
  const KEY = 'meowSudoku.v1';
  const defaults = () => ({
    unlocked: 1, stars: {}, best: {}, saves: {}, tutorials: {},
    settings: { music: true, sfx: true, haptics: true },
  });
  let data = load();
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d) return Object.assign(defaults(), d, { settings: Object.assign(defaults().settings, d.settings) });
    } catch (e) { /* 讀不到就用預設值 */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* 空間不足或私密模式 */ }
  }
  const totalStars = () => Object.values(data.stars).reduce((a, b) => a + b, 0);
  function nextLevel() {
    for (let i = 1; i <= 50; i++) if (!data.stars[i]) return Math.min(i, data.unlocked);
    return 50;
  }

  // 清掉不屬於目前題目的進行中存檔（例如關卡改版之前的存檔）
  Object.keys(data.saves).forEach(lv => {
    const level = LEVELS[lv - 1];
    if (!level || !data.saves[lv] || data.saves[lv].p !== level[0]) delete data.saves[lv];
  });

  A.setMusic(data.settings.music);
  A.setSfx(data.settings.sfx);

  // ───────────────────────── 震動回饋 ─────────────────────────
  // 在 iPhone App（Capacitor）裡使用原生 Taptic Engine，瀏覽器裡則退回 navigator.vibrate
  let hapticsPlugin = null;
  function nativeHaptics() {
    const C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
    if (!hapticsPlugin) hapticsPlugin = (C.Plugins && C.Plugins.Haptics) || (C.registerPlugin && C.registerPlugin('Haptics'));
    return hapticsPlugin;
  }
  function haptic(kind) {
    if (!data.settings.haptics) return;
    const H = nativeHaptics();
    try {
      if (H) {
        if (kind === 'error') H.notification({ type: 'ERROR' });
        else if (kind === 'success') H.notification({ type: 'SUCCESS' });
        else H.impact({ style: kind === 'medium' ? 'MEDIUM' : 'LIGHT' });
      } else if (navigator.vibrate) {
        navigator.vibrate(kind === 'error' ? [30, 40, 30] : kind === 'success' ? [20, 30, 60] : 10);
      }
    } catch (e) { /* 不支援就略過 */ }
  }

  // ───────────────────────── 數獨結構 ─────────────────────────
  const boxOf = i => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);
  const UNITS = [];
  for (let r = 0; r < 9; r++) UNITS.push([...Array(9)].map((_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) UNITS.push([...Array(9)].map((_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) UNITS.push([...Array(9)].map((_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + k % 3));
  const CELL_UNITS = [...Array(81)].map((_, i) => [Math.floor(i / 9), 9 + i % 9, 18 + boxOf(i)]);
  const PEERS = [...Array(81)].map((_, i) => {
    const s = new Set();
    CELL_UNITS[i].forEach(u => UNITS[u].forEach(x => s.add(x)));
    s.delete(i);
    return [...s];
  });

  // ───────────────────────── 畫面切換 ─────────────────────────
  let screen = 'home';
  function show(name) {
    screen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    if (name === 'home') renderHome();
    if (name === 'levels') renderLevels();
    if (name === 'home') cover.start(); else cover.stop();
    A.playMusic(name === 'game' ? 'game' : 'menu');
  }

  function renderHome() {
    const lv = nextLevel();
    const allDone = Object.keys(data.stars).length >= 50;
    $('#play-label').textContent = data.saves[lv] ? `繼續第 ${lv} 關` : allDone ? '再玩一次' : `開始第 ${lv} 關`;
    $('#home-stars').textContent = `${totalStars()} / 150`;
  }

  // ───────────────────────── 關卡選擇 ─────────────────────────
  function renderLevels() {
    $('#levels-stars').textContent = totalStars();
    const list = $('#levels-list');
    const cur = nextLevel();
    let html = '';
    CHAPTERS.forEach((ch, ci) => {
      const first = ci * 10 + 1;
      const locked = first > data.unlocked;
      let got = 0;
      for (let lv = first; lv < first + 10; lv++) got += data.stars[lv] || 0;
      html += `<div class="chapter${locked ? ' locked' : ''}">
        <div class="chapter-head">
          <div class="chapter-ico" style="background:${ch.color};--ico-detail:${ch.color}"><svg><use href="#i-${ch.icon}"/></svg></div>
          <div><div class="chapter-name">第 ${ci + 1} 章．${ch.name}</div><div class="chapter-sub">${ch.diff}．第 ${first}～${first + 9} 關</div></div>
          <div class="chapter-stars"><svg><use href="#i-star"/></svg>${got}/30</div>
        </div><div class="level-grid">`;
      for (let lv = first; lv < first + 10; lv++) {
        const st = data.stars[lv] || 0;
        const isLocked = lv > data.unlocked;
        const cls = ['level-tile'];
        if (isLocked) cls.push('locked');
        else if (lv === cur && !st) cls.push('current');
        else if (st) cls.push('cleared');
        if (data.saves[lv]) cls.push('has-save');
        const stars = [0, 1, 2].map(k => `<svg class="${k < st ? 'on' : ''}"><use href="#i-star"/></svg>`).join('');
        const tut = !isLocked && TUTORIALS[lv] && !data.tutorials[lv] ? '<span class="tut-tag">教學</span>' : '';
        html += `<button class="${cls.join(' ')}" data-level="${lv}">${tut}${isLocked
          ? '<svg class="lock"><use href="#i-lock"/></svg>'
          : `<span>${lv}</span><span class="mini-stars">${stars}</span>`}</button>`;
      }
      html += '</div></div>';
    });
    list.innerHTML = html;
    const curEl = list.querySelector(`[data-level="${cur}"]`);
    if (curEl) requestAnimationFrame(() => {
      const top = curEl.closest('.chapter').offsetTop - list.offsetTop - 8;
      list.scrollTop = Math.max(0, top);
    });
  }

  $('#levels-list').addEventListener('click', e => {
    const tile = e.target.closest('[data-level]');
    if (!tile) return;
    const lv = +tile.dataset.level;
    if (lv > data.unlocked) {
      A.sfx.select();
      tile.classList.remove('shake');
      void tile.offsetWidth;
      tile.classList.add('shake');
      return;
    }
    A.sfx.button();
    startLevel(lv);
  });

  // ───────────────────────── 封面示範棋盤 ─────────────────────────
  // 封面上的數獨會像有人在玩一樣，一格一格填完、閃一下，再從頭開始
  function candidatesIn(grid, i) {
    let used = 0;
    PEERS[i].forEach(p => { if (grid[p]) used |= 1 << (grid[p] - 1); });
    return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => !(used & (1 << (d - 1))));
  }

  const cover = {
    el: $('#cover-board'),
    cells: [],
    timer: 0,
    build() {
      const [p, s] = LEVELS[14];
      this.puzzle = [...p].map(Number);
      this.solution = [...s].map(Number);
      for (let b = 0; b < 9; b++) {
        const box = document.createElement('div');
        box.className = 'cb-box';
        for (let k = 0; k < 9; k++) {
          const i = (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + k % 3;
          const cell = document.createElement('div');
          cell.className = 'cb-cell';
          box.appendChild(cell);
          this.cells[i] = cell;
        }
        this.el.appendChild(box);
      }
      this.el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.el.click(); }
      });
      this.order = this.solveOrder();
      this.reset();
    },
    // 每一步都挑「只剩一個數字能填」的格子，看起來就像真人在解題
    solveOrder() {
      const g = this.puzzle.slice();
      const order = [];
      for (let round = 0; round < 81 && g.includes(0); round++) {
        const ready = [];
        for (let i = 0; i < 81; i++) if (!g[i] && candidatesIn(g, i).length === 1) ready.push(i);
        if (!ready.length) break;
        ready.sort(() => Math.random() - 0.5).forEach(i => { g[i] = this.solution[i]; order.push(i); });
      }
      for (let i = 0; i < 81; i++) if (!g[i]) order.push(i);
      return order;
    },
    reset() {
      this.cur = this.puzzle.slice();
      this.step = 0;
      this.pause = 0;
      // 幾個比較晚才填的空格，先放上鉛筆筆記
      this.notes = {};
      this.order.slice(-16).filter((_, k) => k % 4 === 1).forEach(i => { this.notes[i] = candidatesIn(this.cur, i); });
      for (let i = 0; i < 81; i++) this.paint(i);
      this.highlight(this.order[0]);
    },
    paint(i, pop = false) {
      const el = this.cells[i];
      const v = this.cur[i];
      el.classList.toggle('f', v > 0 && !this.puzzle[i]);
      if (v) el.innerHTML = `<span>${v}</span>`;
      else if (this.notes[i]) el.innerHTML = '<div class="cb-notes">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => `<i>${this.notes[i].includes(d) ? d : ''}</i>`).join('') + '</div>';
      else el.innerHTML = '';
      if (pop) replay(el, 'pop');
    },
    highlight(t) {
      this.cells.forEach((el, i) => {
        el.classList.toggle('sel', i === t);
        el.classList.toggle('peer', t !== undefined && i !== t && PEERS[t].includes(i));
      });
    },
    tick() {
      if (document.hidden || screen !== 'home') return;
      if (this.step < this.order.length) {
        const i = this.order[this.step++];
        const d = this.solution[i];
        this.cur[i] = d;
        delete this.notes[i];
        PEERS[i].forEach(p => {
          if (this.notes[p] && this.notes[p].includes(d)) {
            this.notes[p] = this.notes[p].filter(x => x !== d);
            this.paint(p);
          }
        });
        this.paint(i, true);
        if (this.step < this.order.length) {
          this.highlight(this.order[this.step]);
        } else {
          this.highlight();
          this.cells.forEach((el, k) => replay(el, 'wave', (Math.floor(k / 9) + k % 9) * 45));
          this.pause = 5;
        }
      } else if (--this.pause <= 0) {
        this.reset();
      }
    },
    start() {
      this.stop();
      if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      this.timer = setInterval(() => this.tick(), 700);
    },
    stop() { clearInterval(this.timer); },
  };

  // ───────────────────────── 遊戲狀態 ─────────────────────────
  const G = {};
  const cellEls = [];
  const noteEls = [];
  const numEls = [];

  function buildBoard() {
    const board = $('#board');
    for (let b = 0; b < 9; b++) {
      const box = document.createElement('div');
      box.className = 'box';
      for (let k = 0; k < 9; k++) {
        const i = (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + k % 3;
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.i = i;
        cell.innerHTML = '<span class="v"></span><div class="notes">' +
          [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<i>${n}</i>`).join('') + '</div>';
        box.appendChild(cell);
        cellEls[i] = cell;
        noteEls[i] = [...cell.querySelectorAll('.notes i')];
      }
      board.appendChild(box);
    }
    board.addEventListener('pointerdown', e => {
      const cell = e.target.closest('.cell');
      if (cell) select(+cell.dataset.i);
    });

    const pad = $('#numpad');
    for (let d = 1; d <= 9; d++) {
      const btn = document.createElement('button');
      btn.className = 'num';
      btn.innerHTML = `<span>${d}</span><small></small><svg class="ok"><use href="#i-check"/></svg>`;
      btn.addEventListener('pointerdown', e => { e.preventDefault(); input(d); });
      pad.appendChild(btn);
      numEls[d] = btn;
    }
  }

  const isLocked = i => G.given[i] || G.hinted.has(i) || (G.cells[i] > 0 && !G.wrong.has(i));
  const unitDone = u => UNITS[u].every(i => G.cells[i] === G.solution[i]);
  const digitCount = d => G.cells.reduce((n, v, i) => n + (v === d && v === G.solution[i] ? 1 : 0), 0);

  function startLevel(lv, fresh = false) {
    const [p, s] = LEVELS[lv - 1];
    const tutorial = TUTORIALS[lv] && !data.tutorials[lv];
    if (tutorial) fresh = true; // 教學關一律從頭開始
    const sv = !fresh && data.saves[lv] && data.saves[lv].p === p ? data.saves[lv] : null;
    G.level = lv;
    G.solution = [...s].map(Number);
    G.given = [...p].map(v => v !== '0');
    G.cells = sv ? sv.cells.map((v, i) => (G.given[i] ? +p[i] : v)) : [...p].map(Number);
    G.notes = sv ? sv.notes.slice() : new Array(81).fill(0);
    G.wrong = new Set(sv ? sv.wrong : []);
    G.hinted = new Set(sv ? sv.hinted : []);
    G.mistakes = sv ? sv.mistakes : 0;
    G.hintsUsed = sv ? sv.hintsUsed : 0;
    G.time = sv ? sv.time : 0;
    G.moved = !!sv;
    G.history = [];
    G.notesMode = false;
    G.over = false;
    G.paused = false;
    G.tutorial = false;
    G.doneUnits = new Set(UNITS.map((_, u) => u).filter(unitDone));
    G.doneDigits = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => digitCount(d) === 9));
    G.selected = G.cells.findIndex((v, i) => !isLocked(i));
    if (fresh) delete data.saves[lv];

    const ch = chapterOf(lv);
    $('#game-level').textContent = `第 ${lv} 關`;
    $('#game-chapter').textContent = `${ch.name}．${ch.diff}`;
    $('#timer').textContent = fmtTime(G.time);
    $('#mascot-img').src = IMG.think;
    updateTools();
    renderLives();
    render();
    coach.stop();
    show('game');
    startTimer();
    if (tutorial) {
      G.tutorial = true;
      setTimeout(() => coach.start(lv), 450);
    } else {
      setTimeout(() => say(sv ? SAY.resume : SAY.start), 450);
    }
  }

  function persist() {
    if (G.over || !G.moved) return;
    data.saves[G.level] = {
      p: LEVELS[G.level - 1][0], // 題目改版時，舊存檔就會自動作廢
      cells: G.cells, notes: G.notes, wrong: [...G.wrong], hinted: [...G.hinted],
      mistakes: G.mistakes, hintsUsed: G.hintsUsed, time: G.time,
    };
    save();
  }

  // ───────────────────────── 繪製 ─────────────────────────
  function render() {
    const sel = G.selected;
    const sv = sel >= 0 ? G.cells[sel] : 0;
    const sr = Math.floor(sel / 9), sc = sel % 9, sb = sel >= 0 ? boxOf(sel) : -1;
    for (let i = 0; i < 81; i++) {
      const el = cellEls[i];
      const v = G.cells[i];
      const cl = el.classList;
      cl.toggle('given', G.given[i]);
      cl.toggle('hinted', G.hinted.has(i));
      cl.toggle('user', !G.given[i] && !G.hinted.has(i) && v > 0);
      cl.toggle('wrong', G.wrong.has(i));
      const isSel = i === sel;
      const same = !isSel && sv > 0 && v === sv;
      const peer = !isSel && !same && sel >= 0 && (Math.floor(i / 9) === sr || i % 9 === sc || boxOf(i) === sb);
      cl.toggle('selected', isSel);
      cl.toggle('same', same);
      cl.toggle('peer', peer);
      el.firstChild.textContent = v || '';
      const notes = v ? 0 : G.notes[i];
      for (let n = 0; n < 9; n++) {
        const on = (notes >> n) & 1;
        noteEls[i][n].classList.toggle('on', !!on);
        noteEls[i][n].classList.toggle('hl', !!on && sv === n + 1);
      }
    }
    for (let d = 1; d <= 9; d++) {
      const left = 9 - digitCount(d);
      numEls[d].classList.toggle('done', left === 0);
      numEls[d].querySelector('small').textContent = left;
    }
  }

  function renderLives(justLost = false) {
    let html = '';
    for (let k = 0; k < MAX_MISTAKES; k++) {
      const lost = k >= MAX_MISTAKES - G.mistakes;
      const now = justLost && k === MAX_MISTAKES - G.mistakes;
      html += `<svg class="${lost ? 'lost' : ''}${now ? ' lost-now' : ''}"><use href="#i-paw"/></svg>`;
    }
    $('#lives').innerHTML = html;
  }

  function updateTools() {
    const left = MAX_HINTS - G.hintsUsed;
    $('#hint-badge').textContent = left;
    $('#tool-hint').classList.toggle('empty', left <= 0);
    $('#tool-notes').classList.toggle('on', G.notesMode);
    $('#notes-badge').textContent = G.notesMode ? '開' : '關';
    $('#numpad').classList.toggle('notes-mode', G.notesMode);
  }

  function replay(el, cls, delay = 0) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.style.animationDelay = delay ? delay + 'ms' : '';
    el.classList.add(cls);
    clearTimeout(el['_t' + cls]);
    el['_t' + cls] = setTimeout(() => { el.classList.remove(cls); el.style.animationDelay = ''; }, 900 + delay);
  }

  let bubbleTimer = 0;
  function say(msg) {
    if (Array.isArray(msg)) msg = msg[Math.floor(Math.random() * msg.length)];
    const b = $('#bubble');
    b.textContent = msg;
    b.classList.add('show');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => b.classList.remove('show'), 2400);
  }

  let mascotTimer = 0;
  function mascot(kind) {
    const img = $('#mascot-img');
    img.src = IMG[kind];
    img.classList.remove('react');
    void img.offsetWidth;
    img.classList.add('react');
    clearTimeout(mascotTimer);
    mascotTimer = setTimeout(() => { img.src = IMG.think; }, 1700);
  }

  // ───────────────────────── 操作 ─────────────────────────
  function select(i) {
    if (G.over || G.paused) return;
    if (G.selected !== i) A.sfx.select();
    G.selected = i;
    render();
    coach.notify('select', i);
  }

  function pushHistory(i) {
    G.history.push({ i, v: G.cells[i], notes: G.notes.slice(), wrong: G.wrong.has(i) });
    if (G.history.length > 300) G.history.shift();
    G.moved = true;
  }

  function input(d) {
    if (screen !== 'game' || G.over || G.paused) return;
    const i = G.selected;
    if (i < 0) return say(SAY.pickCell);
    if (isLocked(i)) {
      // 點已填好的格子 → 只切換相同數字的高亮
      A.sfx.select();
      return;
    }
    if (G.notesMode) {
      pushHistory(i);
      G.cells[i] = 0; // 格子裡如果是填錯的數字，改成筆記
      G.wrong.delete(i);
      G.notes[i] ^= 1 << (d - 1);
      A.sfx.note(d);
      render();
      persist();
      coach.notify('input', { i, d });
      return;
    }
    if (G.cells[i] === d) return;
    pushHistory(i);
    G.cells[i] = d;
    G.notes[i] = 0;
    if (d === G.solution[i]) {
      G.wrong.delete(i);
      PEERS[i].forEach(p => { G.notes[p] &= ~(1 << (d - 1)); });
      replay(cellEls[i], 'pop');
      A.sfx.place(d);
      haptic('light');
      render();
      afterCorrect(i, d);
    } else {
      G.wrong.add(i);
      G.mistakes++;
      replay(cellEls[i], 'shake');
      A.sfx.wrong();
      haptic('error');
      renderLives(true);
      mascot('sad');
      render();
      if (G.mistakes >= MAX_MISTAKES) return lose();
      say(G.mistakes === MAX_MISTAKES - 1 ? SAY.last : SAY.wrong);
    }
    persist();
    coach.notify('input', { i, d });
  }

  function afterCorrect(i, d) {
    const finished = CELL_UNITS[i].filter(u => !G.doneUnits.has(u) && unitDone(u));
    if (finished.length) {
      finished.forEach(u => G.doneUnits.add(u));
      const cells = new Set();
      finished.forEach(u => UNITS[u].forEach(c => cells.add(c)));
      const r0 = Math.floor(i / 9), c0 = i % 9;
      cells.forEach(c => {
        const dist = Math.max(Math.abs(Math.floor(c / 9) - r0), Math.abs(c % 9 - c0));
        replay(cellEls[c], 'wave', dist * 55);
      });
      A.sfx.unit(finished.length - 1);
      mascot('star');
      say(SAY.unit);
    } else if (Math.random() < 0.07) {
      say(SAY.good);
    }
    if (!G.doneDigits.has(d) && digitCount(d) === 9) {
      G.doneDigits.add(d);
      A.sfx.digitDone();
    }
    if (G.cells.every((v, k) => v === G.solution[k])) win();
  }

  function undo() {
    if (G.over) return;
    const h = G.history.pop();
    if (!h) return say(SAY.noUndo);
    G.cells[h.i] = h.v;
    G.notes = h.notes;
    if (h.wrong) G.wrong.add(h.i); else G.wrong.delete(h.i);
    G.selected = h.i;
    G.doneUnits = new Set([...G.doneUnits].filter(unitDone));
    G.doneDigits = new Set([...G.doneDigits].filter(d => digitCount(d) === 9));
    A.sfx.undo();
    render();
    persist();
  }

  function erase() {
    if (G.over) return;
    const i = G.selected;
    if (i < 0) return say(SAY.pickCell);
    if (isLocked(i)) return say(SAY.locked);
    if (!G.cells[i] && !G.notes[i]) return;
    pushHistory(i);
    G.cells[i] = 0;
    G.notes[i] = 0;
    G.wrong.delete(i);
    A.sfx.erase();
    render();
    persist();
  }

  function toggleNotes() {
    G.notesMode = !G.notesMode;
    A.sfx.button();
    updateTools();
    if (!coach.active) say(G.notesMode ? SAY.notesOn : SAY.notesOff);
    coach.notify('notes', G.notesMode);
  }

  // 某格目前還可能填的數字（依同列、行、宮格已填的數字排除）
  function candidatesOf(i) {
    let used = 0;
    PEERS[i].forEach(p => { if (G.cells[p] && !G.wrong.has(p)) used |= 1 << (G.cells[p] - 1); });
    return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => !(used & (1 << (d - 1))));
  }
  // 候選數字個數（用來挑「最容易推理」的格子給提示）
  const candidateCount = i => candidatesOf(i).length;

  function hint() {
    if (G.over) return;
    if (G.hintsUsed >= MAX_HINTS) {
      A.sfx.select();
      return say(SAY.noHint);
    }
    let i = G.selected;
    if (i < 0 || isLocked(i)) {
      const open = [];
      for (let k = 0; k < 81; k++) if (!isLocked(k)) open.push(k);
      if (!open.length) return;
      const near = i >= 0 ? open.filter(k => PEERS[i].includes(k)) : [];
      const pool = near.length ? near : open;
      i = pool.reduce((best, k) => (candidateCount(k) < candidateCount(best) ? k : best), pool[0]);
    }
    const d = G.solution[i];
    G.history = G.history.filter(h => h.i !== i);
    G.cells[i] = d;
    G.notes[i] = 0;
    G.wrong.delete(i);
    G.hinted.add(i);
    G.hintsUsed++;
    G.moved = true;
    PEERS[i].forEach(p => { G.notes[p] &= ~(1 << (d - 1)); });
    G.selected = i;
    replay(cellEls[i], 'sparkle');
    replay(cellEls[i], 'pop');
    A.sfx.hint();
    haptic('medium');
    updateTools();
    render();
    say(SAY.hint);
    afterCorrect(i, d);
    persist();
  }

  function moveSel(dr, dc) {
    let i = G.selected < 0 ? 40 : G.selected;
    const r = (Math.floor(i / 9) + dr + 9) % 9, c = (i % 9 + dc + 9) % 9;
    select(r * 9 + c);
  }

  // ───────────────────────── 新手教學（第 1 關） ─────────────────────────
  // 每一步：text 說明、target() 要聚焦的區域、wait 需要玩家實際完成的動作（沒有 wait 就按「下一步」）
  function unionRect(els) {
    const rs = els.map(el => el.getBoundingClientRect());
    const left = Math.min(...rs.map(r => r.left));
    const top = Math.min(...rs.map(r => r.top));
    const right = Math.max(...rs.map(r => r.right));
    const bottom = Math.max(...rs.map(r => r.bottom));
    return { left, top, right, bottom };
  }
  const cellsRect = idx => unionRect(idx.map(i => cellEls[i]));
  const elRect = el => unionRect([typeof el === 'string' ? $(el) : el]);

  const TUTORIALS = {
    // 規則 + 實際填一個數字 + 介紹小幫手
    1() {
      const row = UNITS.slice(0, 9).findIndex(u => u.filter(i => !G.cells[i]).length === 1);
      const intro = [
        { text: '歡迎來到喵喵數獨！我是小橘，<br>先帶你認識遊戲規則喵～' },
        { text: '規則很簡單：每一個<b>橫列</b>都要填入 1～9，而且不能重複。', target: () => cellsRect(UNITS[Math.max(row, 0)]) },
      ];
      const outro = [
        { text: '如果填錯，會失去一個<b>貓掌</b>；三個貓掌都沒了就要重來喔。', target: () => elRect('#lives') },
        { text: '這裡還有<b>復原</b>、<b>擦除</b>、<b>筆記</b>、<b>提示</b>幾個小幫手，卡住的時候可以用喔！', target: () => elRect('.tools') },
        { text: '其他格子就交給你了，<br>慢慢來，加油喵！', button: '開始玩！' },
      ];
      if (row < 0) return intro.concat(outro);
      const t = UNITS[row].find(i => !G.cells[i]);
      const ans = G.solution[t];
      const have = UNITS[row].map(i => G.cells[i]).filter(Boolean).sort().join('、');
      return intro.concat([
        { text: '每一個<b>直行</b>也一樣，1～9 各出現一次。', target: () => cellsRect(UNITS[9 + t % 9]) },
        { text: '還有每個粗線框起來的 <b>3×3 宮格</b>，也要剛好有 1～9。', target: () => cellsRect(UNITS[18 + boxOf(t)]) },
        { text: `看這一列：已經有 ${have}，<br>只差一個數字！先點一下這個空格。`, target: () => cellsRect([t]), wait: { type: 'select', test: i => i === t } },
        { text: `缺的是 <b>${ans}</b>！點數字鍵盤上的「${ans}」把它填進去。`, target: () => elRect(numEls[ans]), wait: { type: 'input', digit: ans, test: p => p.i === t && G.cells[t] === ans, delay: 900 } },
        { text: '答對了！完成一整列的時候，格子會閃閃發亮喵～', target: () => cellsRect(UNITS[row]) },
      ], outro);
    },
  };

  const coach = {
    steps: null,
    idx: 0,
    lv: 0,
    busy: false,
    blocks: [...document.querySelectorAll('.coach-block')],
    get active() { return !!this.steps; },
    get step() { return this.steps ? this.steps[this.idx] : null; },
    start(lv) {
      if (screen !== 'game' || G.level !== lv || G.over) return;
      this.lv = lv;
      G.selected = -1;
      G.notesMode = false;
      updateTools();
      render();
      this.steps = TUTORIALS[lv]();
      $('#coach').classList.add('show');
      this.go(0);
    },
    go(k) {
      this.idx = k;
      this.busy = false;
      const s = this.step;
      if (!s) return this.finish(false);
      const card = $('#coach-card');
      card.innerHTML = `<img src="${IMG.wave}" alt="">
        <div class="coach-body">
          <div class="coach-text">${s.text}</div>
          <div class="coach-actions">
            <button class="coach-skip" data-action="coach-skip">跳過教學</button>
            <span class="coach-count">${k + 1} / ${this.steps.length}</span>
            ${s.wait ? '<span class="coach-tip">點發光的地方</span>'
    : `<button class="btn btn-primary coach-next" data-action="coach-next">${s.button || '下一步'}</button>`}
          </div>
        </div>`;
      replay(card, 'coach-in');
      this.layout();
    },
    next() { if (this.active) this.go(this.idx + 1); },
    notify(type, payload) {
      const s = this.step;
      if (!s || !s.wait || this.busy || s.wait.type !== type || !s.wait.test(payload)) return;
      this.busy = true;
      setTimeout(() => { if (this.step === s) this.next(); }, s.wait.delay || 300);
    },
    allowsKey(key) {
      const w = this.step && this.step.wait;
      if (!w || this.busy) return false;
      if (w.type === 'input') return /^[1-9]$/.test(key) && (!w.digit || +key === w.digit);
      if (w.type === 'notes') return key === 'n' || key === 'N';
      return false;
    },
    finish(skipped) {
      if (!this.active) return;
      data.tutorials[this.lv] = true;
      save();
      this.stop();
      G.tutorial = false;
      say(skipped ? '有問題隨時問我喵～' : SAY.start);
    },
    stop() {
      this.steps = null;
      $('#coach').classList.remove('show');
    },
    layout() {
      const s = this.step;
      if (!s) return;
      const W = innerWidth, H = innerHeight, pad = 5;
      const t = s.target ? s.target() : null;
      const r = t ? { left: t.left - pad, top: t.top - pad, right: t.right + pad, bottom: t.bottom + pad } : null;
      const box = r || { left: W / 2, top: H / 2, right: W / 2, bottom: H / 2 };
      const hole = $('#coach-hole');
      Object.assign(hole.style, { left: box.left + 'px', top: box.top + 'px', width: box.right - box.left + 'px', height: box.bottom - box.top + 'px' });
      hole.classList.toggle('empty', !r);
      hole.classList.toggle('pass', !!s.wait); // 只有需要玩家操作時，聚焦區才能點
      const place = (el, x, y, w, h) => Object.assign(el.style, { left: x + 'px', top: y + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
      const [bt, bb, bl, br] = this.blocks;
      place(bt, 0, 0, W, box.top);
      place(bb, 0, box.bottom, W, H - box.bottom);
      place(bl, 0, box.top, box.left, box.bottom - box.top);
      place(br, box.right, box.top, W - box.right, box.bottom - box.top);

      const paw = $('#coach-paw');
      paw.classList.toggle('show', !!(r && s.wait));
      if (r) {
        const py = r.bottom + 30 < H ? r.bottom - 12 : r.top - 30;
        Object.assign(paw.style, { left: Math.min(r.right - 14, W - 40) + 'px', top: py + 'px' });
      }

      // 說明卡：依序嘗試放在聚焦區的下、上、右、左，不能蓋住聚焦區
      const card = $('#coach-card');
      const m = 12, gap = 16;
      const cw = card.offsetWidth, ch = card.offsetHeight;
      const clampX = x => Math.min(Math.max(x, m), W - cw - m);
      const clampY = y => Math.min(Math.max(y, m), H - ch - m);
      let pos = { x: (W - cw) / 2, y: (H - ch) / 2 };
      if (r) {
        const mx = (r.left + r.right) / 2, my = (r.top + r.bottom) / 2;
        const opts = [
          { x: clampX(mx - cw / 2), y: r.bottom + gap, ok: r.bottom + gap + ch <= H - m },
          { x: clampX(mx - cw / 2), y: r.top - gap - ch, ok: r.top - gap - ch >= m },
          { x: r.right + gap, y: clampY(my - ch / 2), ok: r.right + gap + cw <= W - m },
          { x: r.left - gap - cw, y: clampY(my - ch / 2), ok: r.left - gap - cw >= m },
        ];
        pos = opts.find(o => o.ok) || { x: clampX(mx - cw / 2), y: H - ch - m };
      }
      card.style.left = pos.x + 'px';
      card.style.top = pos.y + 'px';
    },
  };
  window.addEventListener('resize', () => { if (coach.active) coach.layout(); });

  // ───────────────────────── 計時 ─────────────────────────
  let timerId = 0;
  const fmtTime = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  function startTimer() {
    clearInterval(timerId);
    timerId = setInterval(() => {
      if (screen !== 'game' || G.over || G.paused || G.tutorial || document.hidden) return;
      G.time++;
      $('#timer').textContent = fmtTime(G.time);
      if (G.time % 5 === 0) persist();
    }, 1000);
  }
  const stopTimer = () => clearInterval(timerId);

  // ───────────────────────── 過關 / 失敗 ─────────────────────────
  function win() {
    G.over = true;
    stopTimer();
    const lv = G.level;
    const stars = Math.max(1, 3 - (G.mistakes > 0 ? 1 : 0) - (G.hintsUsed > 0 ? 1 : 0));
    const prevBest = data.best[lv];
    const newRecord = prevBest !== undefined && G.time < prevBest;
    data.stars[lv] = Math.max(data.stars[lv] || 0, stars);
    if (prevBest === undefined || G.time < prevBest) data.best[lv] = G.time;
    data.unlocked = Math.max(data.unlocked, Math.min(50, lv + 1));
    delete data.saves[lv];
    save();
    G.selected = -1;
    render();
    for (let i = 0; i < 81; i++) replay(cellEls[i], 'wave', (Math.floor(i / 9) + i % 9) * 35);
    A.stopMusic(0.5);
    setTimeout(() => {
      A.sfx.win();
      haptic('success');
      confetti();
      showWin(stars, newRecord);
    }, 1000);
  }

  function lose() {
    G.over = true;
    stopTimer();
    delete data.saves[G.level];
    save();
    A.stopMusic(0.5);
    setTimeout(() => {
      A.sfx.lose();
      openModal(`<img class="modal-cat" src="${IMG.sad}" alt="">
        <h3>毛線打結了…</h3>
        <p>失誤三次了，別灰心！<br>休息一下，再試一次吧喵～</p>
        <div class="btns">
          <button class="btn btn-primary" data-action="retry"><svg class="btn-ico"><use href="#i-refresh"/></svg>重新挑戰</button>
          <button class="btn btn-light" data-action="levels">關卡列表</button>
        </div>`, { cat: true });
    }, 700);
  }

  function showWin(stars, newRecord) {
    const lv = G.level;
    const last = lv >= 50;
    openModal(`<img class="modal-cat bounce" src="${IMG.star}" alt="">
      <h3>${last ? '全部破關啦！' : '過關啦！'}</h3>
      <div class="big-stars">${[0, 1, 2].map(k => `<svg data-k="${k}" class="${k < stars ? 'on' : ''}"><use href="#i-star"/></svg>`).join('')}</div>
      ${newRecord ? '<div class="tag-new">新紀錄！</div>' : ''}
      <div class="stats">
        <div class="stat"><b>${fmtTime(G.time)}</b><span>時間</span></div>
        <div class="stat"><b>${G.mistakes}</b><span>失誤</span></div>
        <div class="stat"><b>${G.hintsUsed}</b><span>提示</span></div>
      </div>
      <div class="star-rules">${G.mistakes ? '零失誤可以多拿一顆星' : '零失誤 ✓'}　${G.hintsUsed ? '不用提示可以多拿一顆星' : '沒用提示 ✓'}</div>
      ${last ? '<p>你是真正的貓咪之王！<br>五十道謎題全部完成了喵～</p>' : ''}
      <div class="btns">
        ${last
    ? '<button class="btn btn-primary" data-action="home"><svg class="btn-ico"><use href="#i-home"/></svg>回到主畫面</button>'
    : '<button class="btn btn-primary" data-action="next">下一關<svg class="btn-ico"><use href="#i-next"/></svg></button>'}
        <button class="btn btn-light" data-action="levels">關卡列表</button>
      </div>`, { cat: true });
    const els = document.querySelectorAll('.big-stars svg');
    els.forEach((el, k) => setTimeout(() => {
      el.classList.add('in');
      if (k < stars) A.sfx.star(k);
    }, 500 + k * 380));
  }

  function confetti() {
    const layer = $('#confetti');
    layer.innerHTML = '';
    const colors = ['#FF9BB5', '#FFC94D', '#8FD6C2', '#BFA9F0', '#FFB07A', '#F0628C'];
    for (let k = 0; k < 48; k++) {
      const el = document.createElement('i');
      const color = colors[k % colors.length];
      const size = 8 + Math.random() * 10;
      const kind = k % 4;
      if (kind >= 2) {
        el.innerHTML = `<svg style="font-size:${size + 10}px;color:${color}"><use href="#i-${kind === 2 ? 'paw' : 'star'}"/></svg>`;
      } else {
        Object.assign(el.style, { width: size + 'px', height: size * 0.6 + 'px', background: color, borderRadius: '3px' });
      }
      el.style.left = Math.random() * 100 + '%';
      el.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
      el.style.setProperty('--rot', (Math.random() * 720 - 360) + 'deg');
      el.style.animationDuration = 2.4 + Math.random() * 1.8 + 's';
      el.style.animationDelay = Math.random() * 0.7 + 's';
      layer.appendChild(el);
    }
    setTimeout(() => { layer.innerHTML = ''; }, 5500);
  }

  // ───────────────────────── 彈出視窗 ─────────────────────────
  let modalOpen = false;
  let modalClose = null;
  function openModal(html, opt = {}) {
    const m = $('#modal');
    m.className = 'modal' + (opt.cat ? ' has-cat' : '');
    m.innerHTML = html;
    m.scrollTop = 0;
    $('#modal-layer').classList.add('show');
    modalOpen = true;
    modalClose = opt.onClose || null;
  }
  function closeModal() {
    $('#modal-layer').classList.remove('show');
    modalOpen = false;
    const fn = modalClose;
    modalClose = null;
    if (fn) fn();
  }

  const switchRow = (key, icon, label) =>
    `<div class="setting-row"><svg class="s-ico"><use href="#i-${icon}"/></svg>${label}
      <button class="switch${data.settings[key] ? ' on' : ''}" data-action="toggle" data-key="${key}" aria-label="${label}"></button></div>`;

  function showSettings(inGame) {
    if (inGame) G.paused = true;
    openModal(`<h3>${inGame ? '休息一下' : '設定'}</h3>
      <div style="margin-top:10px">
        ${switchRow('music', 'music', '背景音樂')}
        ${switchRow('sfx', 'speaker', '音效')}
        ${switchRow('haptics', 'vibrate', '震動回饋')}
      </div>
      <div class="btns">
        ${inGame ? `<button class="btn btn-primary" data-action="close"><svg class="btn-ico"><use href="#i-play"/></svg>繼續遊戲</button>
          <div class="row-btns">
            <button class="btn btn-light" data-action="restart"><svg class="btn-ico"><use href="#i-refresh"/></svg>重來</button>
            <button class="btn btn-light" data-action="home"><svg class="btn-ico"><use href="#i-home"/></svg>主畫面</button>
          </div>`
    : `<button class="btn btn-primary" data-action="close">好的喵</button>
          <button class="text-link" data-action="reset">重置所有進度</button>`}
      </div>`, { onClose: inGame ? () => { G.paused = false; } : null });
  }

  function showHelp() {
    openModal(`<img class="modal-cat bounce" src="${IMG.wave}" alt="">
      <h3>怎麼玩？</h3>
      <div class="rules">
        <div class="rule"><span class="n">1</span><span>每一橫列、每一直行、每個 3×3 宮格裡，數字 1～9 都只能出現一次。</span></div>
        <div class="rule"><span class="n">2</span><span>先點選一個格子，再點下方的數字填進去。</span></div>
        <div class="rule"><span class="n">3</span><span>打開「筆記」可以先記下可能的數字。</span></div>
        <div class="rule"><span class="n">4</span><span>填錯會失去一個貓掌，失誤三次就要重來喔！</span></div>
        <div class="rule"><span class="n">5</span><span>零失誤又不用提示，就能拿到三顆星！</span></div>
      </div>
      <div class="btns">
        <button class="btn btn-primary" data-action="close">知道了喵！</button>
        <button class="text-link" data-action="replay-tutorial">重看新手教學</button>
      </div>`,
    { cat: true, onClose: screen === 'game' ? () => { G.paused = false; } : null });
    if (screen === 'game') G.paused = true;
  }

  function confirm(title, text, action, label) {
    openModal(`<h3>${title}</h3><p>${text}</p>
      <div class="btns row-btns">
        <button class="btn btn-light" data-action="${screen === 'game' ? 'pause' : 'settings'}">取消</button>
        <button class="btn btn-primary" data-action="${action}">${label}</button>
      </div>`, { onClose: screen === 'game' ? () => { G.paused = false; } : null });
    if (screen === 'game') G.paused = true;
  }

  // ───────────────────────── 按鈕事件 ─────────────────────────
  const ACTIONS = {
    play() { startLevel(nextLevel()); },
    levels() {
      if (screen === 'game' && !G.over) persist();
      stopTimer();
      closeModalQuiet();
      show('levels');
    },
    home() {
      if (screen === 'game' && !G.over) persist();
      stopTimer();
      closeModalQuiet();
      show('home');
    },
    help() { showHelp(); },
    settings() { showSettings(false); },
    pause() { showSettings(true); },
    close() { closeModal(); },
    undo() { undo(); },
    erase() { erase(); },
    notes() { toggleNotes(); },
    hint() { hint(); },
    next() { closeModalQuiet(); startLevel(Math.min(50, G.level + 1)); },
    retry() { closeModalQuiet(); startLevel(G.level, true); },
    restart() { confirm('重新開始？', '這一關目前的進度會清除喔。', 'do-restart', '重新開始'); },
    'do-restart'() { closeModalQuiet(); startLevel(G.level, true); },
    reset() { confirm('重置所有進度？', '所有星星和解鎖的關卡都會清空，無法復原喔！', 'do-reset', '確定重置'); },
    'do-reset'() {
      const keep = data.settings;
      data = defaults();
      data.settings = keep;
      save();
      closeModalQuiet();
      renderHome();
    },
    'coach-next'() { coach.next(); },
    'coach-skip'() { coach.finish(true); },
    'replay-tutorial'() {
      data.tutorials = {};
      save();
      closeModalQuiet();
      startLevel(1);
    },
    toggle(btn) {
      const key = btn.dataset.key;
      data.settings[key] = !data.settings[key];
      btn.classList.toggle('on', data.settings[key]);
      if (key === 'music') A.setMusic(data.settings.music);
      if (key === 'sfx') A.setSfx(data.settings.sfx);
      if (key === 'haptics') haptic('medium');
      save();
    },
  };
  const SILENT = new Set(['undo', 'erase', 'notes', 'hint']);

  function closeModalQuiet() {
    modalClose = null;
    $('#modal-layer').classList.remove('show');
    modalOpen = false;
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    if (!ACTIONS[act]) return;
    if (!SILENT.has(act)) A.sfx.button();
    ACTIONS[act](btn);
  });

  // 點視窗外面＝關閉（過關 / 失敗視窗除外）
  $('#modal-layer').addEventListener('click', e => {
    if (e.target.id !== 'modal-layer') return;
    if (screen === 'game' && G.over) return;
    closeModal();
  });

  // 鍵盤（電腦上測試用）
  document.addEventListener('keydown', e => {
    if (screen !== 'game' || modalOpen) return;
    if (coach.active && !coach.allowsKey(e.key)) return;
    if (/^[1-9]$/.test(e.key)) input(+e.key);
    else if (e.key === 'ArrowUp') moveSel(-1, 0);
    else if (e.key === 'ArrowDown') moveSel(1, 0);
    else if (e.key === 'ArrowLeft') moveSel(0, -1);
    else if (e.key === 'ArrowRight') moveSel(0, 1);
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') erase();
    else if (e.key === 'n' || e.key === 'N') toggleNotes();
    else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) undo();
    else if (e.key === 'h' || e.key === 'H') hint();
    else return;
    e.preventDefault();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'game') persist();
  });

  // ───────────────────────── 啟動 ─────────────────────────
  buildBoard();
  cover.build();
  show('home');

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.Capacitor) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  window.__meow = { G, data: () => data, startLevel, show }; // 除錯用
})();
