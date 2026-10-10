/* 喵喵數獨 — 合成音樂與音效引擎
 * 全部由 Web Audio API 即時合成，不使用任何音檔：
 *   FM 電鋼琴、雙振盪器鋸齒波 Pad、卡林巴/音樂盒鈴聲、Pluck 琶音、合成貝斯、
 *   合成鼓組（Kick / Clap / Hi-hat / Shaker）、共振峰合成的「喵～」，
 *   再加上殘響（Convolver）與延遲回音，讓聲音有空間感、不是單調的電腦嗶聲。
 */
(function () {
  'use strict';

  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let musicFx = null; // { dest, conv, delayIn, delay }
  let sfxFx = null;
  let sfxBus = null;
  let musicMaster = null;
  let sfxMaster = null;
  let noiseBuf = null;
  let seq = null;
  let pendingSong = null;
  const settings = { music: true, sfx: true };
  const MUSIC_LEVEL = 0.32;
  const SFX_LEVEL = 1.0;

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // ───────────────────────── 基礎建設 ─────────────────────────

  function makeImpulse(c, seconds, decay) {
    const rate = c.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function makeNoise(c) {
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 一組效果器（殘響 + 回音），輸出到 dest
  function makeFx(dest, impulse, verbLevel) {
    const conv = ctx.createConvolver();
    conv.buffer = impulse;
    const convOut = ctx.createGain();
    convOut.gain.value = verbLevel;
    conv.connect(convOut);
    convOut.connect(dest);

    const delayIn = ctx.createGain();
    const delay = ctx.createDelay(2.0);
    delay.delayTime.value = 0.33;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    delayIn.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    tone.connect(dest);
    tone.connect(conv);
    return { dest, conv, delayIn, delay };
  }

  // 一條「匯流排」：dry / 殘響送出 / 回音送出 三個可一起淡出的 GainNode
  function makeBus(fx, level = 1) {
    const out = ctx.createGain();
    const verb = ctx.createGain();
    const echo = ctx.createGain();
    out.gain.value = level;
    verb.gain.value = level;
    echo.gain.value = level;
    out.connect(fx.dest);
    verb.connect(fx.conv);
    echo.connect(fx.delayIn);
    return { out, verb, echo, all: [out, verb, echo] };
  }

  // 每個音符的輸入節點，依需求接上聲像、殘響、回音
  function route(bus, opt = {}) {
    const input = ctx.createGain();
    let node = input;
    if (opt.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = opt.pan;
      input.connect(p);
      node = p;
    }
    node.connect(bus.out);
    if (opt.verb) {
      const s = ctx.createGain();
      s.gain.value = opt.verb;
      node.connect(s);
      s.connect(bus.verb);
    }
    if (opt.echo) {
      const s = ctx.createGain();
      s.gain.value = opt.echo;
      node.connect(s);
      s.connect(bus.echo);
    }
    return input;
  }

  function osc(type, freq, t, stop) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(t);
    o.stop(stop);
    return o;
  }

  function noise(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur);
    return s;
  }

  function filter(type, freq, q = 1) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // ───────────────────────── 樂器 ─────────────────────────

  // FM 電鋼琴（Rhodes 風格）
  function ePiano(bus, t, midi, dur, vel = 0.6, pan = 0) {
    const f = mtof(midi);
    const out = route(bus, { pan, verb: 0.35 });
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.13, t + 0.006);
    amp.gain.setTargetAtTime(vel * 0.055, t + 0.01, 0.4);
    amp.gain.setTargetAtTime(0, t + dur, 0.2);
    amp.connect(out);
    const end = t + dur + 1.4;
    const car = osc('sine', f, t, end);
    const mod = osc('sine', f, t, end);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.6 * vel, t);
    mg.gain.setTargetAtTime(f * 0.2, t, 0.3);
    mod.connect(mg);
    mg.connect(car.frequency);
    const tine = osc('sine', f * 14, t, t + 0.3);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(f * 0.7 * vel, t);
    tg.gain.setTargetAtTime(0, t, 0.025);
    tine.connect(tg);
    tg.connect(car.frequency);
    car.connect(amp);
  }

  // 溫暖的鋸齒波 Pad（每個音兩個微微走音的振盪器 → 低通）
  function pad(bus, t, midis, dur, vel = 0.5) {
    const out = route(bus, { verb: 0.7 });
    const lp = filter('lowpass', 1000, 0.6);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.035, t + Math.min(0.6, dur * 0.4));
    amp.gain.setValueAtTime(vel * 0.035, t + dur);
    amp.gain.linearRampToValueAtTime(0, t + dur + 0.9);
    lp.connect(amp);
    amp.connect(out);
    midis.forEach(m => {
      [-9, 9].forEach(det => {
        const o = osc('sawtooth', mtof(m), t, t + dur + 1);
        o.detune.value = det;
        o.connect(lp);
      });
    });
  }

  // 合成貝斯（正弦 + 鋸齒波泛音，手機喇叭也聽得到）
  function bass(bus, t, midi, dur, vel = 0.7) {
    const f = mtof(midi);
    const out = route(bus, {});
    const lp = filter('lowpass', 900, 1.5);
    lp.frequency.setValueAtTime(1000, t);
    lp.frequency.setTargetAtTime(320, t, 0.1);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.3, t + 0.012);
    amp.gain.setTargetAtTime(vel * 0.2, t + 0.02, 0.25);
    amp.gain.setTargetAtTime(0, t + dur, 0.05);
    const end = t + dur + 0.4;
    const o1 = osc('sine', f, t, end);
    const o2 = osc('sawtooth', f, t, end);
    const g2 = ctx.createGain();
    g2.gain.value = 0.45;
    o1.connect(amp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(amp);
    amp.connect(out);
  }

  // 卡林巴 / 音樂盒鈴聲（FM，打擊瞬間帶金屬感，隨後變成純淨的音）
  function bell(bus, t, midi, dur, vel = 0.6, opt = {}) {
    const f = mtof(midi);
    const out = route(bus, { pan: opt.pan || 0, verb: opt.verb ?? 0.45, echo: opt.echo ?? 0.22 });
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.17, t + 0.004);
    amp.gain.setTargetAtTime(0, t + 0.006, 0.18 + dur * 0.3);
    amp.connect(out);
    const end = t + 0.5 + dur * 2;
    const car = osc('sine', f, t, end);
    const mod = osc('sine', f * 3.5, t, end);
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.3, t);
    mg.gain.setTargetAtTime(0, t, 0.07);
    mod.connect(mg);
    mg.connect(car.frequency);
    car.connect(amp);
    const h = osc('sine', f * 2, t, end);
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0.35, t);
    hg.gain.setTargetAtTime(0, t, 0.12);
    h.connect(hg);
    hg.connect(amp);
  }

  // Pluck 琶音（方波 + 鋸齒波，濾波器快速關閉）
  function pluck(bus, t, midi, vel = 0.5, pan = 0) {
    const f = mtof(midi);
    const out = route(bus, { pan, verb: 0.3, echo: 0.18 });
    const lp = filter('lowpass', f * 8, 3);
    lp.frequency.setValueAtTime(Math.min(f * 9, 12000), t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.4, t + 0.2);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.07, t + 0.003);
    amp.gain.setTargetAtTime(0, t + 0.005, 0.1);
    const a = osc('square', f, t, t + 0.7);
    const b = osc('sawtooth', f, t, t + 0.7);
    a.detune.value = -7;
    b.detune.value = 7;
    a.connect(lp);
    b.connect(lp);
    lp.connect(amp);
    amp.connect(out);
  }

  function kick(bus, t, vel = 0.8) {
    const out = route(bus, {});
    const o = osc('sine', 150, t, t + 0.4);
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(vel * 0.55, t);
    amp.gain.setTargetAtTime(0, t + 0.02, 0.09);
    o.connect(amp);
    amp.connect(out);
    const n = noise(t, 0.02);
    const ng = ctx.createGain();
    ng.gain.value = vel * 0.06;
    const hp = filter('highpass', 2500);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(out);
  }

  function clap(bus, t, vel = 0.6) {
    const out = route(bus, { verb: 0.35 });
    const bp = filter('bandpass', 1600, 0.9);
    const amp = ctx.createGain();
    // 三次快速的小爆音 → 拍手感
    amp.gain.setValueAtTime(0, t);
    [0, 0.012, 0.024].forEach(o => {
      amp.gain.setValueAtTime(vel * 0.32, t + o);
      amp.gain.setTargetAtTime(vel * 0.05, t + o + 0.001, 0.004);
    });
    amp.gain.setTargetAtTime(0, t + 0.03, 0.06);
    const n = noise(t, 0.35);
    n.connect(bp);
    bp.connect(amp);
    amp.connect(out);
    const body = osc('triangle', 210, t, t + 0.1);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(vel * 0.1, t);
    bg.gain.setTargetAtTime(0, t, 0.025);
    body.connect(bg);
    bg.connect(out);
  }

  function rim(bus, t, vel = 0.5) {
    const out = route(bus, { verb: 0.3 });
    const o = osc('triangle', 420, t, t + 0.12);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(vel * 0.16, t);
    amp.gain.setTargetAtTime(0, t, 0.018);
    o.connect(amp);
    const n = noise(t, 0.06);
    const bp = filter('bandpass', 2200, 2);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vel * 0.18, t);
    ng.gain.setTargetAtTime(0, t, 0.015);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    amp.connect(out);
  }

  function hat(bus, t, vel = 0.4, open = false, pan = 0.15) {
    const out = route(bus, { pan });
    const hp = filter('highpass', 7500, 0.7);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(vel * 0.1, t);
    amp.gain.setTargetAtTime(0, t + 0.002, open ? 0.09 : 0.022);
    const n = noise(t, open ? 0.5 : 0.12);
    n.connect(hp);
    hp.connect(amp);
    amp.connect(out);
  }

  function shaker(bus, t, vel = 0.2, pan = -0.25) {
    const out = route(bus, { pan });
    const bp = filter('bandpass', 6500, 1.2);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.09, t + 0.015);
    amp.gain.setTargetAtTime(0, t + 0.02, 0.025);
    const n = noise(t, 0.15);
    n.connect(bp);
    bp.connect(amp);
    amp.connect(out);
  }

  // 共振峰合成的貓叫聲「喵～」：鋸齒波聲源 + 三個會移動的共振峰（m → ia → ow）
  function meow(bus, t, pitch = 1, len = 1, vel = 0.6) {
    const L = 0.6 * len;
    const out = route(bus, { verb: 0.25 });
    const src = osc('sawtooth', 500 * pitch, t, t + L + 0.1);
    src.frequency.setValueAtTime(480 * pitch, t);
    src.frequency.linearRampToValueAtTime(760 * pitch, t + L * 0.28);
    src.frequency.linearRampToValueAtTime(690 * pitch, t + L * 0.65);
    src.frequency.linearRampToValueAtTime(440 * pitch, t + L);
    const lfo = osc('sine', 6.5, t, t + L + 0.1);
    const lg = ctx.createGain();
    lg.gain.value = 10 * pitch;
    lfo.connect(lg);
    lg.connect(src.frequency);

    const sum = ctx.createGain();
    const formant = (q, gain, points) => {
      const f = filter('bandpass', points[0], q);
      f.frequency.setValueAtTime(points[0], t);
      f.frequency.linearRampToValueAtTime(points[1], t + L * 0.3);
      f.frequency.linearRampToValueAtTime(points[2], t + L * 0.7);
      f.frequency.linearRampToValueAtTime(points[3], t + L);
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(f);
      f.connect(g);
      g.connect(sum);
    };
    formant(5, 1.0, [380, 950, 760, 480]);
    formant(7, 0.7, [1500, 2100, 1400, 950]);
    formant(9, 0.3, [2800, 3000, 2700, 2500]);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * 0.75, t + 0.07);
    amp.gain.linearRampToValueAtTime(vel * 0.9, t + L * 0.35);
    amp.gain.linearRampToValueAtTime(vel * 0.5, t + L * 0.8);
    amp.gain.linearRampToValueAtTime(0, t + L);
    sum.connect(amp);
    amp.connect(out);
  }

  // ───────────────────────── 樂曲 ─────────────────────────
  // 每首曲子以 16 分音符為一步、16 步為一小節；play() 在每一步被呼叫一次並排程該步的音符。

  const SONGS = {
    // 主選單：輕快可愛的「喵喵進行曲」
    menu: {
      bpm: 108,
      swing: 0.04,
      bars: 8,
      chords: [[60, 64, 67], [59, 62, 67], [57, 60, 64], [57, 60, 65], [60, 64, 67], [59, 62, 67], [57, 60, 65], [59, 62, 65, 67]],
      roots: [48, 47, 45, 41, 48, 43, 41, 43],
      melody: [
        [0, 0, 76, 2], [0, 2, 79, 2], [0, 4, 84, 4], [0, 8, 79, 2], [0, 10, 76, 2], [0, 12, 79, 4],
        [1, 0, 74, 2], [1, 2, 79, 2], [1, 4, 83, 4], [1, 8, 81, 2], [1, 10, 79, 2], [1, 12, 74, 4],
        [2, 0, 72, 2], [2, 2, 76, 2], [2, 4, 81, 4], [2, 8, 79, 2], [2, 10, 76, 2], [2, 12, 72, 4],
        [3, 0, 69, 2], [3, 2, 72, 2], [3, 4, 77, 2], [3, 6, 76, 2], [3, 8, 77, 2], [3, 10, 79, 2], [3, 12, 81, 4],
        [4, 0, 79, 4], [4, 4, 76, 2], [4, 6, 79, 2], [4, 8, 84, 4], [4, 12, 83, 2], [4, 14, 84, 2],
        [5, 0, 86, 4], [5, 4, 83, 2], [5, 6, 79, 2], [5, 8, 74, 4], [5, 12, 79, 4],
        [6, 0, 81, 2], [6, 2, 79, 2], [6, 4, 77, 2], [6, 6, 76, 2], [6, 8, 74, 2], [6, 10, 72, 2], [6, 12, 69, 4],
        [7, 0, 71, 2], [7, 2, 74, 2], [7, 4, 77, 2], [7, 6, 79, 2], [7, 8, 83, 6],
      ],
      play(bus, bar, step, t, loop, S) {
        const chord = this.chords[bar];
        const root = this.roots[bar];
        if (step === 0) pad(bus, t, chord.map(m => m - 12), S * 16, 0.6);
        // Pluck 琶音
        if (step % 2 === 0) {
          const order = [0, 1, 2, 1, 0, 1, 2, chord.length > 3 ? 3 : 1];
          const n = chord[order[step / 2]] + 12;
          pluck(bus, t, n, step % 4 === 0 ? 0.55 : 0.38, step % 4 === 0 ? -0.3 : 0.3);
        }
        // 跳躍的貝斯
        const bassPat = { 0: [0, 3], 6: [0, 2], 8: [0, 3], 12: [12, 2], 14: [7, 2] };
        if (bassPat[step]) bass(bus, t, root + bassPat[step][0], S * bassPat[step][1], 0.75);
        // 鼓
        if (loop > 0 || bar >= 2) {
          if (step === 0 || step === 8 || (bar % 4 === 3 && step === 10)) kick(bus, t, 0.8);
          if (step === 4 || step === 12) clap(bus, t, 0.55);
          if (step % 4 === 2) hat(bus, t, 0.5, step === 14 && bar % 2 === 1);
          shaker(bus, t, step % 2 ? 0.12 : 0.2);
        }
        // 主旋律（音樂盒），第二輪起改用電鋼琴並高八度裝飾
        for (const [b, s, m, len] of this.melody) {
          if (b === bar && s === step) {
            bell(bus, t, m, S * len, 0.6, { pan: 0.1 });
            if (loop % 2 === 1) ePiano(bus, t, m - 12, S * len, 0.35, -0.2);
          }
        }
      },
    },

    // 遊戲中：慵懶的 Lo-fi「午後貓窩」，不搶注意力
    game: {
      bpm: 80,
      swing: 0.14,
      bars: 8,
      chords: [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59],
        [53, 57, 60, 64], [52, 56, 59, 62], [57, 60, 64, 67], [50, 53, 57, 60, 64]],
      roots: [41, 40, 38, 36, 41, 40, 45, 38],
      melody: [
        [0, 2, 69, 2], [0, 4, 72, 2], [0, 6, 76, 4], [0, 12, 74, 2], [0, 14, 72, 2],
        [1, 0, 71, 6], [1, 8, 67, 4], [1, 12, 64, 4],
        [2, 2, 65, 2], [2, 4, 69, 2], [2, 6, 72, 4], [2, 12, 69, 2], [2, 14, 72, 2],
        [3, 0, 76, 6], [3, 8, 74, 2], [3, 10, 71, 6],
        [4, 2, 72, 2], [4, 4, 76, 2], [4, 6, 79, 4], [4, 12, 77, 2], [4, 14, 76, 2],
        [5, 0, 74, 4], [5, 4, 71, 2], [5, 6, 68, 4], [5, 12, 71, 4],
        [6, 0, 72, 4], [6, 4, 76, 4], [6, 8, 69, 6],
        [7, 0, 69, 2], [7, 2, 67, 2], [7, 4, 65, 4], [7, 8, 71, 4], [7, 12, 74, 4],
      ],
      play(bus, bar, step, t, loop, S) {
        const phase = loop % 4; // 0 = 只有和弦（喘口氣），1/2 = 完整，3 = 沒有旋律
        let chord = this.chords[bar];
        let root = this.roots[bar];
        if (bar === 7 && step >= 8) { chord = [55, 59, 62, 65]; root = 43; } // G7 回到開頭
        if (step === 0) pad(bus, t, chord, S * 16, 0.45);
        if (bar === 7 && step === 8) pad(bus, t, chord, S * 8, 0.45);
        // 電鋼琴和弦
        if (step === 0 || (bar === 7 && step === 8)) chord.forEach((m, i) => ePiano(bus, t + i * 0.012, m, S * 6, 0.62, (i - 1.5) * 0.2));
        if (step === 7 && bar !== 7) chord.forEach((m, i) => ePiano(bus, t + i * 0.01, m, S * 3, 0.38, (i - 1.5) * 0.2));
        if (phase === 3 && step === 11 && bar !== 7) chord.slice(1).forEach((m, i) => ePiano(bus, t + i * 0.01, m + 12, S * 2, 0.3, 0.3));
        // 貝斯
        const bassPat = { 0: [0, 5], 6: [0, 2], 10: [7, 3], 14: [12, 2] };
        if (bassPat[step] && !(bar === 7 && step === 10)) bass(bus, t, root + bassPat[step][0], S * bassPat[step][1], 0.6);
        if (bar === 7 && step === 8) bass(bus, t, 43, S * 6, 0.6);
        // 鼓（輕柔）
        if (phase !== 0) {
          if (step === 0 || step === 7 || step === 10) kick(bus, t, step === 0 ? 0.6 : 0.42);
          if (step === 4 || step === 12) rim(bus, t, 0.5);
          if (step % 2 === 0) hat(bus, t, step % 4 === 0 ? 0.32 : 0.22);
        }
        // 旋律
        if (phase === 1 || phase === 2) {
          for (const [b, s, m, len] of this.melody) {
            if (b === bar && s === step) bell(bus, t, m + (phase === 2 ? 12 : 0), S * len, phase === 2 ? 0.42 : 0.55, { echo: 0.3 });
          }
        }
      },
    },
  };

  // ───────────────────────── 播放控制 ─────────────────────────

  function scheduler() {
    if (!ctx || !seq || ctx.state !== 'running') return;
    const song = seq.song;
    const S = 60 / song.bpm / 4;
    if (seq.next < ctx.currentTime - 0.2) seq.next = ctx.currentTime + 0.05; // 從背景回來時追上進度
    while (seq.next < ctx.currentTime + 0.15) {
      const step = seq.step % 16;
      const bar = Math.floor(seq.step / 16) % song.bars;
      const loop = Math.floor(seq.step / (16 * song.bars));
      song.play(seq.bus, bar, step, seq.next, loop, S);
      seq.next += S * (step % 2 === 0 ? 1 + song.swing : 1 - song.swing);
      seq.step++;
    }
  }

  function fadeBus(bus, to, time) {
    const now = ctx.currentTime;
    bus.all.forEach(g => {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(to, now + time);
    });
  }

  function playMusic(name) {
    pendingSong = name;
    if (!ctx) return;
    if (seq && seq.name === name) return;
    stopMusic(0.8);
    const song = SONGS[name];
    if (!song) return;
    const bus = makeBus(musicFx, 0);
    fadeBus(bus, 1, 1.2);
    musicFx.delay.delayTime.setValueAtTime((60 / song.bpm) * 0.75, ctx.currentTime);
    seq = { name, song, bus, step: 0, next: ctx.currentTime + 0.1 };
  }

  function stopMusic(fade = 0.6) {
    pendingSong = null;
    if (!seq || !ctx) return;
    const old = seq.bus;
    fadeBus(old, 0, fade);
    setTimeout(() => old.all.forEach(g => g.disconnect()), (fade + 3) * 1000);
    seq = null;
  }

  function init() {
    if (ctx || !AC) return;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      ctx = new AC();
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);

    musicMaster = ctx.createGain();
    musicMaster.gain.value = settings.music ? MUSIC_LEVEL : 0;
    musicMaster.connect(master);
    sfxMaster = ctx.createGain();
    sfxMaster.gain.value = settings.sfx ? SFX_LEVEL : 0;
    sfxMaster.connect(master);

    noiseBuf = makeNoise(ctx);
    musicFx = makeFx(musicMaster, makeImpulse(ctx, 2.8, 3.2), 0.55);
    sfxFx = makeFx(sfxMaster, makeImpulse(ctx, 1.8, 3.5), 0.5);
    sfxFx.delay.delayTime.value = 0.18;
    sfxBus = makeBus(sfxFx, 1);

    setInterval(scheduler, 25);
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });
    if (pendingSong) {
      const name = pendingSong;
      pendingSong = null;
      playMusic(name);
    }
  }

  // iOS 需要在使用者觸碰時建立 / 喚醒 AudioContext
  function unlock() {
    init();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume();
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
  }
  ['touchend', 'pointerup', 'click', 'keydown'].forEach(ev =>
    window.addEventListener(ev, unlock, { capture: true, passive: true }));

  function setMusic(on) {
    settings.music = on;
    if (musicMaster) {
      const now = ctx.currentTime;
      musicMaster.gain.cancelScheduledValues(now);
      musicMaster.gain.setValueAtTime(musicMaster.gain.value, now);
      musicMaster.gain.linearRampToValueAtTime(on ? MUSIC_LEVEL : 0, now + 0.4);
    }
  }
  function setSfx(on) {
    settings.sfx = on;
    if (sfxMaster) sfxMaster.gain.value = on ? SFX_LEVEL : 0;
  }

  // ───────────────────────── 音效 ─────────────────────────

  const PENTA = [60, 62, 64, 67, 69, 72, 74, 76, 79]; // 數字 1~9 對應五聲音階，填數字就像在彈琴
  const ready = () => ctx && ctx.state === 'running' && settings.sfx;
  const now = () => ctx.currentTime + 0.01;

  const SFX = {
    select() {
      if (!ready()) return;
      const t = now();
      const out = route(sfxBus, {});
      const o = osc('sine', 1300, t, t + 0.08);
      o.frequency.exponentialRampToValueAtTime(820, t + 0.04);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.09, t);
      g.gain.setTargetAtTime(0, t, 0.018);
      o.connect(g);
      g.connect(out);
      const n = noise(t, 0.03);
      const bp = filter('bandpass', 3200, 1.5);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.06, t);
      ng.gain.setTargetAtTime(0, t, 0.008);
      n.connect(bp);
      bp.connect(ng);
      ng.connect(out);
    },
    place(d) {
      if (!ready()) return;
      const t = now();
      const out = route(sfxBus, {});
      const o = osc('sine', 320, t, t + 0.12);
      o.frequency.exponentialRampToValueAtTime(980, t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.13, t);
      g.gain.setTargetAtTime(0, t + 0.01, 0.025);
      o.connect(g);
      g.connect(out);
      bell(sfxBus, t + 0.015, PENTA[(d || 1) - 1] + 12, 0.35, 0.75, { verb: 0.3, echo: 0.08 });
    },
    note(d) {
      if (!ready()) return;
      const t = now();
      const out = route(sfxBus, {});
      [0, 0.045].forEach((o, i) => {
        const n = noise(t + o, 0.04);
        const hp = filter('bandpass', 4200 + i * 900, 2.5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t + o);
        g.gain.linearRampToValueAtTime(0.09, t + o + 0.008);
        g.gain.setTargetAtTime(0, t + o + 0.01, 0.012);
        n.connect(hp);
        hp.connect(g);
        g.connect(out);
      });
      bell(sfxBus, t, PENTA[(d || 1) - 1] + 24, 0.1, 0.25, { verb: 0.2, echo: 0 });
    },
    wrong() {
      if (!ready()) return;
      const t = now();
      const out = route(sfxBus, { verb: 0.2 });
      const lp = filter('lowpass', 1100, 2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.2, t + 0.01);
      g.gain.setTargetAtTime(0, t + 0.12, 0.08);
      const wob = osc('sine', 14, t, t + 0.5); // 「啵嚶」的抖動感
      const wg = ctx.createGain();
      wg.gain.value = 18;
      wob.connect(wg);
      [233, 247].forEach(f => {
        const o = osc('triangle', f, t, t + 0.5);
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.72, t + 0.28);
        wg.connect(o.frequency);
        o.connect(lp);
      });
      lp.connect(g);
      g.connect(out);
      meow(sfxBus, t + 0.05, 0.75, 0.55, 0.32);
    },
    erase() {
      if (!ready()) return;
      const t = now();
      const out = route(sfxBus, {});
      const bp = filter('bandpass', 3000, 1.2);
      bp.frequency.setValueAtTime(3200, t);
      bp.frequency.exponentialRampToValueAtTime(500, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16, t + 0.03);
      g.gain.linearRampToValueAtTime(0, t + 0.2);
      const n = noise(t, 0.22);
      n.connect(bp);
      bp.connect(g);
      g.connect(out);
    },
    undo() {
      if (!ready()) return;
      const t = now();
      const out = route(sfxBus, {});
      const bp = filter('bandpass', 600, 1.2);
      bp.frequency.setValueAtTime(500, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.13, t + 0.05);
      g.gain.linearRampToValueAtTime(0, t + 0.18);
      const n = noise(t, 0.2);
      n.connect(bp);
      bp.connect(g);
      g.connect(out);
      bell(sfxBus, t + 0.08, 67, 0.15, 0.35, { verb: 0.2, echo: 0 });
    },
    button() {
      if (!ready()) return;
      const t = now();
      const out = route(sfxBus, { verb: 0.15 });
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.008);
      g.gain.setTargetAtTime(0, t + 0.02, 0.04);
      const a = osc('sine', 520, t, t + 0.2);
      a.frequency.exponentialRampToValueAtTime(820, t + 0.06);
      const b = osc('triangle', 1040, t, t + 0.2);
      b.frequency.exponentialRampToValueAtTime(1640, t + 0.06);
      const bg = ctx.createGain();
      bg.gain.value = 0.3;
      a.connect(g);
      b.connect(bg);
      bg.connect(g);
      g.connect(out);
    },
    hint() {
      if (!ready()) return;
      const t = now();
      [72, 76, 79, 84, 88, 91].forEach((m, i) => bell(sfxBus, t + i * 0.055, m, 0.25, 0.5 - i * 0.04, { verb: 0.6, echo: 0.25, pan: (i - 2.5) * 0.15 }));
      const n = noise(t, 0.6);
      const hp = filter('highpass', 9000);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.04, t + 0.2);
      g.gain.linearRampToValueAtTime(0, t + 0.55);
      n.connect(hp);
      hp.connect(g);
      g.connect(route(sfxBus, { verb: 0.5 }));
    },
    unit(k = 0) {
      if (!ready()) return;
      const t = now() + 0.08;
      const base = [72, 74, 77][k % 3];
      [0, 4, 7, 12].forEach((iv, i) => bell(sfxBus, t + i * 0.07, base + iv, 0.4, 0.45, { verb: 0.55, echo: 0.2, pan: (i - 1.5) * 0.25 }));
      pad(sfxBus, t, [base - 12, base - 5, base + 4], 0.5, 0.9);
    },
    digitDone() {
      if (!ready()) return;
      const t = now() + 0.25;
      bell(sfxBus, t, 84, 0.3, 0.4, { verb: 0.5 });
      bell(sfxBus, t + 0.09, 91, 0.5, 0.35, { verb: 0.6 });
    },
    star(i) {
      if (!ready()) return;
      const t = now();
      const m = [76, 79, 84][i] || 84;
      bell(sfxBus, t, m, 0.6, 0.7, { verb: 0.5, echo: 0.2 });
      bell(sfxBus, t, m + 12, 0.4, 0.3, { verb: 0.6 });
      shaker(sfxBus, t, 0.5, 0);
    },
    win() {
      if (!ready()) return;
      const t = now();
      [60, 64, 67, 72, 76, 79].forEach((m, i) => {
        bell(sfxBus, t + i * 0.085, m + 12, 0.3, 0.55, { verb: 0.5, echo: 0.15, pan: (i - 2.5) * 0.12 });
        pluck(sfxBus, t + i * 0.085, m, 0.5, (2.5 - i) * 0.12);
      });
      const t2 = t + 0.55;
      [60, 64, 67, 71, 74].forEach((m, i) => ePiano(sfxBus, t2 + i * 0.02, m, 1.4, 0.7, (i - 2) * 0.2));
      pad(sfxBus, t2, [48, 55, 64, 67, 71], 1.4, 1.2);
      bass(sfxBus, t2, 36, 1.2, 0.8);
      kick(sfxBus, t2, 0.7);
      hat(sfxBus, t2, 0.6, true);
      bell(sfxBus, t2 + 0.1, 88, 0.6, 0.45, { verb: 0.7, echo: 0.3 });
      bell(sfxBus, t2 + 0.25, 91, 0.6, 0.4, { verb: 0.7, echo: 0.3 });
      bell(sfxBus, t2 + 0.4, 96, 0.8, 0.35, { verb: 0.7, echo: 0.3 });
      meow(sfxBus, t2 + 0.6, 1.15, 0.9, 0.5);
    },
    lose() {
      if (!ready()) return;
      const t = now();
      [[67, 0], [66, 0.28], [65, 0.56], [64, 0.84]].forEach(([m, o]) => {
        ePiano(sfxBus, t + o, m, 0.3, 0.6);
        ePiano(sfxBus, t + o, m - 9, 0.3, 0.4);
      });
      pad(sfxBus, t + 1.1, [53, 56, 60, 62], 1.2, 1);
      bass(sfxBus, t + 1.1, 41, 1.0, 0.6);
      meow(sfxBus, t + 1.25, 0.82, 1.4, 0.45);
    },
    meow(pitch = 1) {
      if (!ready()) return;
      meow(sfxBus, now(), pitch, 1, 0.55);
    },
  };

  // 開發用：在離線 context 中渲染音效，回傳峰值 / RMS，用來平衡各音效音量
  async function measure(fn, seconds = 2) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const saved = { ctx, musicFx, sfxFx, sfxBus, musicMaster, sfxMaster, noiseBuf, settings: { ...settings } };
    const off = new OAC(2, 44100 * seconds, 44100);
    ctx = off;
    const master = off.createGain();
    master.connect(off.destination);
    musicMaster = off.createGain(); musicMaster.gain.value = MUSIC_LEVEL; musicMaster.connect(master);
    sfxMaster = off.createGain(); sfxMaster.gain.value = SFX_LEVEL; sfxMaster.connect(master);
    noiseBuf = makeNoise(off);
    musicFx = makeFx(musicMaster, makeImpulse(off, 2.8, 3.2), 0.55);
    sfxFx = makeFx(sfxMaster, makeImpulse(off, 1.8, 3.5), 0.5);
    sfxBus = makeBus(sfxFx, 1);
    settings.sfx = true;
    const realReady = off.state;
    try {
      Object.defineProperty(off, 'state', { value: 'running', configurable: true });
    } catch (e) { /* ignore */ }
    fn({ SFX, SONGS, makeBus, musicFx, ctx: off });
    ctx = saved.ctx; musicFx = saved.musicFx; sfxFx = saved.sfxFx; sfxBus = saved.sfxBus;
    musicMaster = saved.musicMaster; sfxMaster = saved.sfxMaster; noiseBuf = saved.noiseBuf;
    Object.assign(settings, saved.settings);
    void realReady;
    const buf = await off.startRendering();
    let peak = 0, sum = 0;
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; }
    return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4) };
  }

  // 開發用：離線渲染一段樂曲
  function measureSong(name, bars = 8) {
    const song = SONGS[name];
    const S = 60 / song.bpm / 4;
    const secs = Math.ceil(S * 16 * bars * 1.05) + 3;
    return measure(({ makeBus: mb, musicFx: fx, ctx: c }) => {
      const bus = mb(fx, 1);
      let tt = 0.05;
      for (let i = 0; i < 16 * bars; i++) {
        const step = i % 16, bar = Math.floor(i / 16) % song.bars, loop = Math.floor(i / (16 * song.bars));
        song.play(bus, bar, step, tt, loop, S);
        tt += S * (step % 2 === 0 ? 1 + song.swing : 1 - song.swing);
      }
      void c;
    }, secs);
  }

  window.MeowAudio = {
    unlock,
    playMusic,
    stopMusic,
    setMusic,
    setSfx,
    sfx: SFX,
    get running() { return !!ctx && ctx.state === 'running'; },
    _measure: measure,
    _measureSong: measureSong,
  };
})();
