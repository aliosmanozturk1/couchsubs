// SPDX-License-Identifier: AGPL-3.0-only
// LG TV (tv-webos/platform.js): HDMI görüntüsünün gözcüsü. Görüntü oyunun ortasında düşünce <video> yeniden kurulur;
// çalışan görüntüye dokunulmaz. <video>, zamanlayıcılar ve saat taklit edilir.
// Çalıştırma: node --test scripts/tv-webos-hdmi.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'tv-webos', 'platform.js'), 'utf8');

function startTv(options = {}) {
  let clock = 1000000;
  let timers = [];
  let nextTimer = 1;
  const videos = [];
  const statuses = [];
  const listeners = {};

  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.parentNode = null;
      if (tag === 'video') {
        this.readyState = 0;
        this.videoWidth = 0;
        this.videoHeight = 0;
        this.currentTime = 0;
        this.paused = false;
        this.ended = false;
        this.error = null;
        this.plays = 0;
        this.loads = 0;
        // options.mediaFocus: TV'nin Chromium'u ses odağı özelliğini (webosMediaFocus) veriyor.
        if (options.mediaFocus) this.webosMediaFocus = false;
        videos.push(this);
      }
    }
    get firstChild() { return this.children[0] || null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    }
    set innerHTML(value) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; }
    fire(name) { (this.listeners[name] || []).slice().forEach((fn) => fn({ type: name })); }
    play() { this.plays++; if (options.playResumes) this.paused = false; }
    pause() { this.paused = true; }
    load() { this.loads++; }
    // Sınamalar için: görüntü geldi.
    start() {
      this.readyState = 4;
      this.videoWidth = 1920;
      this.videoHeight = 1080;
      this.fire('loadeddata');
      this.fire('playing');
    }
  }

  const document = {
    hidden: false,
    createElement: (tag) => new Element(tag),
    addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); },
    fire: (name) => (listeners[name] || []).forEach((fn) => fn({ type: name }))
  };
  const windowListeners = {};
  const window = {
    navigator: { userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/79.0.3945.79 Safari/537.36' },
    PalmSystem: { deviceInfo: JSON.stringify({ platformVersion: '7.4.0', modelName: '55NANO756PA' }) },
    addEventListener: (name, fn) => { (windowListeners[name] = windowListeners[name] || []).push(fn); },
    // options.steps: varsayılan kapalı ses adımları (odak, TV sesini açma) açılır.
    ...(options.steps ? { COUCHSUBS_SOUND_STEPS: options.steps } : {})
  };
  class FakeDate { getTime() { return clock; } }
  // options.luna(uri, params): Luna hizmetinin yanıtı (nesne); verilmezse PalmServiceBridge yok.
  const calls = [];
  const sent = [];
  class PalmServiceBridge {
    call(uri, params) {
      calls.push(uri);
      sent.push({ uri, params: JSON.parse(params) });
      const reply = options.luna(uri, JSON.parse(params));
      if (reply) this.onservicecallback(JSON.stringify(reply));
    }
  }
  const context = {
    window, document, JSON, Math, Number, String, Date: FakeDate,
    ...(options.luna ? { PalmServiceBridge } : {}),
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.push({ id, at: clock + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); }
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'platform.js' });
  const platform = window.COUCHSUBS_PLATFORM;
  const host = new Element('div');

  const tv = {
    platform, document, videos, statuses, host, calls, sent,
    get video() { return videos[videos.length - 1]; },
    show(port) { platform.showHdmi(port || 3, host, (kind) => statuses.push(kind)); },
    // Saati ilerletir; her adımda (varsa) canlı görüntünün sayacı da ilerler.
    advance(ms, eachStep) {
      const end = clock + ms;
      while (true) {
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const due = timers[0];
        if (!due || due.at > end) break;
        timers.shift();
        clock = Math.max(clock, due.at);
        if (eachStep) eachStep();
        due.fn();
      }
      clock = end;
    },
    hide() { document.hidden = true; document.fire('visibilitychange'); },
    unhide() { document.hidden = false; document.fire('visibilitychange'); },
    focus() { (windowListeners.focus || []).forEach((fn) => fn()); }
  };
  return tv;
}

// Sayacı ilerleyen sağlam görüntü: her denetimde currentTime biraz artar.
function ticking(tv) {
  return () => { if (tv.video && tv.video.readyState >= 2 && !tv.video.frozen) tv.video.currentTime += 1; };
}

test('webOS HDMI: sağlam görüntüye dokunulmaz (sayaç ilerlese de ilerlemese de)', () => {
  for (const moving of [true, false]) {
    const tv = startTv();
    tv.show(3);
    tv.video.start();
    tv.advance(10 * 60 * 1000, moving ? ticking(tv) : null);
    assert.strictEqual(tv.videos.length, 1, moving ? 'sayaç ilerlerken' : 'sayaç hiç ilerlemezken');
    assert.strictEqual(tv.video.attributes.src, undefined);
    assert.strictEqual(tv.video.children[0].attributes.src, 'ext://hdmi:3');
    assert.match(tv.platform.diagnostics(), /^hdmi playing rs4 1920x1080 t[+=] · snd on sx on · webOS 7\.4\.0 55NANO756PA cr79$/);
  }
});

test('webOS HDMI: hata olayında <video> 2 sn sonra yeniden kurulur, görüntü gelince durum yenilenir', () => {
  const tv = startTv();
  tv.show(3);
  const first = tv.video;
  first.start();
  tv.advance(20000, ticking(tv));
  first.error = { code: 4 };
  first.fire('error');
  assert.strictEqual(tv.statuses[tv.statuses.length - 1], 'inputError');
  tv.advance(1900);
  assert.strictEqual(tv.videos.length, 1, '2 sn dolmadan kurulmaz');
  tv.advance(600);
  assert.strictEqual(tv.videos.length, 2);
  assert.strictEqual(first.parentNode, null, 'eski <video> sayfadan çıkar');
  assert.strictEqual(first.loads, 1, 'eski boru hattı bırakılır');
  assert.strictEqual(tv.video.children[0].attributes.src, 'ext://hdmi:3');
  assert.strictEqual(tv.host.children.length, 1);
  tv.video.start();
  assert.strictEqual(tv.statuses[tv.statuses.length - 1], 'playing');
  assert.match(tv.platform.diagnostics(), /hdmi playing .* · rebuilt 1 \(error\) · last error code 4/);
  // Eski <video>'nun geç gelen olayı yenisini etkilemez.
  first.fire('error');
  tv.advance(60000, ticking(tv));
  assert.strictEqual(tv.videos.length, 2);
});

test('webOS HDMI: "oynatılıyor" görünürken sayaç durursa (siyah ekran) yeniden kurulur', () => {
  const tv = startTv();
  tv.show(3);
  const first = tv.video;
  first.start();
  tv.advance(60000, ticking(tv));
  assert.strictEqual(tv.videos.length, 1);
  // Görüntü katmanı düştü: <video> hâlâ "oynuyor" diyor ama kare ilerlemiyor.
  first.frozen = true;
  tv.advance(14000, ticking(tv));
  assert.strictEqual(tv.videos.length, 1, '15 sn dolmadan kurulmaz');
  tv.advance(12000, ticking(tv));
  assert.strictEqual(tv.videos.length, 2);
  assert.match(tv.platform.diagnostics(), /rebuilt 1 \(stalled\)/);
});

test('webOS HDMI: kare kaybolursa kurulur; düzelmezse denemeler seyrekleşir, dakikada en çok dört', () => {
  const tv = startTv();
  tv.show(3);
  tv.video.start();
  tv.advance(20000, ticking(tv));
  tv.video.readyState = 0;
  tv.video.videoWidth = 0;
  const before = tv.videos.length;
  tv.advance(60000);
  const firstMinute = tv.videos.length - before;
  assert.ok(firstMinute >= 2 && firstMinute <= 4, 'ilk dakikada ' + firstMinute + ' deneme');
  tv.advance(10 * 60000);
  const later = tv.videos.length - before - firstMinute;
  assert.ok(later >= 5 && later <= 12, 'sonraki 10 dakikada ' + later + ' deneme (dakikada bir civarı)');
  // Görüntü geri gelince durulur.
  tv.video.start();
  const settled = tv.videos.length;
  tv.advance(5 * 60000, ticking(tv));
  assert.strictEqual(tv.videos.length, settled);
});

test('webOS HDMI: bu girişte görüntü hiç gelmediyse en çok üç kez denenir', () => {
  const tv = startTv();
  tv.show(1);
  tv.advance(30 * 60000);
  assert.strictEqual(tv.videos.length, 4);
  // Kullanıcı başka giriş seçince sayaç baştan başlar.
  tv.show(2);
  tv.video.start();
  tv.advance(60000, ticking(tv));
  assert.strictEqual(tv.videos.length, 5);
});

test('webOS HDMI: duraklamış görüntü önce oynatılır, olmazsa yeniden kurulur', () => {
  const resumed = startTv({ playResumes: true });
  resumed.show(3);
  resumed.video.start();
  resumed.advance(20000, ticking(resumed));
  resumed.video.paused = true;
  resumed.video.fire('pause');
  resumed.advance(30000, ticking(resumed));
  assert.strictEqual(resumed.videos.length, 1);
  assert.strictEqual(resumed.video.plays, 1);

  const stuck = startTv();
  stuck.show(3);
  stuck.video.start();
  stuck.advance(20000, ticking(stuck));
  stuck.video.paused = true;
  stuck.advance(16000);
  assert.strictEqual(stuck.videos.length, 2);
  assert.match(stuck.platform.diagnostics(), /rebuilt 1 \(paused\)/);
});

test('webOS HDMI: stalled/emptied/abort olayları sağlam görüntüyü yeniden kurdurmaz', () => {
  const tv = startTv();
  tv.show(3);
  tv.video.start();
  tv.advance(20000, ticking(tv));
  for (const name of ['stalled', 'emptied', 'abort']) {
    tv.video.fire(name);
    tv.advance(10000, ticking(tv));
  }
  assert.strictEqual(tv.videos.length, 1);
  assert.match(tv.platform.diagnostics(), /ev abort/);
});

test('webOS HDMI: arka plandan dönünce sayaç ilerlemiyorsa yeniden kurulur, ilerliyorsa dokunulmaz', () => {
  const dead = startTv();
  dead.show(3);
  dead.video.start();
  dead.advance(20000);
  dead.hide();
  dead.advance(60000);
  assert.strictEqual(dead.videos.length, 1, 'arka plandayken kurulmaz');
  dead.unhide();
  dead.advance(5000);
  assert.strictEqual(dead.videos.length, 2);
  assert.match(dead.platform.diagnostics(), /rebuilt 1 \(resume\)/);

  const alive = startTv();
  alive.show(3);
  alive.video.start();
  alive.advance(20000, ticking(alive));
  alive.hide();
  alive.advance(60000);
  alive.unhide();
  alive.advance(30000, ticking(alive));
  assert.strictEqual(alive.videos.length, 1);
});

test('webOS HDMI: odak ve yeniden başlatılma sağlam görüntüye dokunmaz, bozuk görüntüyü birkaç saniyede kurar', () => {
  const tv = startTv();
  tv.show(3);
  tv.video.start();
  tv.advance(20000);
  tv.focus();
  tv.document.fire('webOSRelaunch');
  tv.advance(4000);
  assert.strictEqual(tv.videos.length, 1);
  tv.video.readyState = 0;
  tv.video.videoWidth = 0;
  tv.document.fire('webOSRelaunch');
  tv.advance(4000);
  assert.strictEqual(tv.videos.length, 2);
});

test('webOS HDMI: aynı giriş yeniden seçilince boru hattı bırakılıp baştan kurulur; çıkışta görüntü bırakılır', () => {
  const tv = startTv();
  tv.show(3);
  const first = tv.video;
  first.start();
  tv.show(3);
  assert.strictEqual(first.loads, 1);
  assert.strictEqual(tv.videos.length, 2);
  assert.strictEqual(tv.host.children.length, 1);
  const second = tv.video;
  tv.show(2);
  assert.strictEqual(second.loads, 0, 'başka girişe geçerken eskisi gibi yalnız sayfadan çıkarılır');
  const third = tv.video;
  tv.platform.exit(true);
  assert.strictEqual(third.loads, 1);
  tv.advance(10 * 60000);
  assert.strictEqual(tv.videos.length, 3, 'çıkıştan sonra yeniden kurulmaz');
});

// <video>'ya yazılan ses özelliklerini kaydeder; kill verilirse yazıldığı an görüntüyü düşürür (webOS'un boru hattını
// askıya aldığı TV taklidi). throws: yazmak hata fırlatır.
function watchSound(video, { kill = [], throws = [] } = {}) {
  const touched = [];
  const values = { muted: false, defaultMuted: false, volume: 1, webosMediaFocus: false };
  const track = { on: false };
  for (const name of Object.keys(values)) {
    if (name === 'webosMediaFocus' && !('webosMediaFocus' in video)) continue;
    Object.defineProperty(video, name, {
      configurable: true,
      get: () => values[name],
      set: (value) => {
        touched.push(name);
        if (throws.includes(name)) throw new Error('not allowed');
        values[name] = value;
        if (kill.includes(name)) { video.readyState = 0; video.videoWidth = 0; }
      }
    });
  }
  const tracks = [{}];
  Object.defineProperty(tracks[0], 'enabled', {
    get: () => track.on,
    set: (value) => {
      touched.push('track');
      if (throws.includes('track')) throw new Error('not allowed');
      track.on = value;
      if (kill.includes('track')) { video.readyState = 0; video.videoWidth = 0; }
    }
  });
  video.audioTracks = tracks;
  return touched;
}

function lunaCalls(tv, part) { return tv.sent.filter((c) => c.uri.indexOf(part) >= 0); }

// 0.9.53, X'te LG OLED: güncellemeden sonra çeviriyi başlatınca ekran siyah. Ses adımları görüntü gelmeden yapılıyordu.
test('webOS HDMI: görüntü gelmeden ses adımı, ses ayarı okuma, odak yapılmaz (0.9.46 yolu)', () => {
  const tv = startTv({ mediaFocus: true, steps: { focus: true, tvUnmute: true },
    luna: () => ({ returnValue: true, volumeStatus: { volume: 10, muteStatus: false } }) });
  tv.show(2);
  const video = tv.video;
  const touched = watchSound(video);
  video.fire('loadedmetadata');
  video.fire('canplay');
  tv.advance(7000);
  assert.deepStrictEqual(touched, [], 'görüntü yokken <video>\'ya dokunulmaz');
  assert.strictEqual(lunaCalls(tv, 'com.webos.audio').length + lunaCalls(tv, 'settingsservice').length, 0);
  assert.match(tv.platform.diagnostics(), / sx wait · webOS/);
  assert.strictEqual(video.children[0].attributes.src, 'ext://hdmi:2');
  assert.strictEqual(video.autoplay, true);
});

test('webOS HDMI: ses adımları görüntü 3 sn geldikten sonra bir kez; odak ve TV sesini açma varsayılan kapalı', () => {
  const tv = startTv({ mediaFocus: true, luna: (uri) => (uri.indexOf('settingsservice') >= 0
    ? { returnValue: true, settings: { soundOutput: 'external_arc' } }
    : { returnValue: true, volumeStatus: { volume: 14, muteStatus: true } }) });
  tv.show(2);
  const video = tv.video;
  const touched = watchSound(video);
  video.start();
  tv.advance(2900, ticking(tv));
  assert.deepStrictEqual(touched, [], 'hemen değil');
  tv.advance(200, ticking(tv));
  assert.deepStrictEqual(touched, ['muted', 'defaultMuted', 'track'], 'kapalı ses parçası açılır; odak istenmez');
  assert.strictEqual(video.webosMediaFocus, false);
  tv.advance(60000, ticking(tv));
  assert.strictEqual(lunaCalls(tv, '/setMuted').length, 0, 'TV sesi açılmaz (varsayılan kapalı)');
  assert.strictEqual(touched.length, 3, 'bir kez');
  assert.strictEqual(tv.videos.length, 1);
  assert.match(tv.platform.diagnostics(), / · snd on v100 tr1\/1 fixed 1 out external_arc tv 14 muted sx on · webOS/);
});

test('webOS HDMI: ses adımı görüntüyü düşürürse adımlar kapanır, <video> eski yolla kurulur ve bir daha dokunulmaz', () => {
  const tv = startTv({ luna: () => ({ returnValue: true }) });
  tv.show(3);
  const first = tv.video;
  watchSound(first, { kill: ['track'] });
  first.start();
  tv.advance(3500);
  assert.strictEqual(first.readyState, 0, 'taklit: ses parçasını açmak görüntüyü düşürdü');
  tv.advance(20000);
  assert.ok(tv.videos.length >= 2, 'gözcü yeniden kurdu');
  assert.match(tv.platform.diagnostics(), / sx off drop lost/);
  const second = tv.video;
  const touched = watchSound(second, { kill: ['track'] });
  second.start();
  tv.advance(10 * 60000, ticking(tv));
  assert.deepStrictEqual(touched, [], 'eski yol: ses adımı yok');
  assert.strictEqual(tv.videos.length, 2);
  assert.strictEqual(tv.statuses[tv.statuses.length - 1], 'playing');
});

test('webOS HDMI: siyah ekranda kullanıcı girişi yeniden seçerse ses adımları kapanır', () => {
  const tv = startTv();
  tv.show(3);
  watchSound(tv.video);
  tv.video.start();
  tv.advance(4000);
  tv.show(3);
  const touched = watchSound(tv.video);
  tv.video.start();
  tv.advance(60000, ticking(tv));
  assert.deepStrictEqual(touched, []);
  assert.match(tv.platform.diagnostics(), / sx off reselect/);
});

test('webOS HDMI: görüntü hiç gelmezse adımlar kapanır (eski yol); hata fırlatan ses özelliği görüntüyü etkilemez', () => {
  const none = startTv();
  none.show(1);
  none.advance(20000);
  assert.ok(none.videos.length >= 2);
  assert.match(none.platform.diagnostics(), / sx off nopic/);

  const strict = startTv({ mediaFocus: true, steps: { focus: true } });
  strict.show(2);
  const touched = watchSound(strict.video, { throws: ['muted', 'track', 'webosMediaFocus'] });
  strict.video.start();
  strict.advance(60000, ticking(strict));
  assert.ok(touched.includes('webosMediaFocus'), 'açıkça istenince odak denenir');
  assert.strictEqual(strict.videos.length, 1);
  assert.match(strict.platform.diagnostics(), /^hdmi playing .* mf err sx on · webOS/);
});

test('webOS HDMI: açıkça istenirse odak sınırlı sayıda, TV sesi kısık kalırsa bir kez açılır; yeniden açılış sayılır', () => {
  const state = { muted: false };
  const tv = startTv({ mediaFocus: true, steps: { focus: true, tvUnmute: true }, luna: (uri, params) => {
    if (uri.endsWith('/setMuted')) { state.muted = params.muted; return { returnValue: true }; }
    if (uri.indexOf('settingsservice') >= 0) return { returnValue: true, settings: {} };
    return { returnValue: true, volumeStatus: { volume: 20, muteStatus: state.muted } };
  } });
  tv.show(2);
  const video = tv.video;
  video.start();
  tv.advance(3100, ticking(tv));
  assert.strictEqual(video.webosMediaFocus, true);
  state.muted = true;
  tv.advance(2000, ticking(tv));
  assert.deepStrictEqual(lunaCalls(tv, '/setMuted').map((c) => c.params), [{ muted: false }]);
  for (let i = 0; i < 5; i++) {
    video.webosMediaFocus = false;
    video.fire('webosmediafocuschange');
  }
  assert.match(tv.platform.diagnostics(), / mf 0 .*tvmute unmuted sx on/);
  tv.document.fire('webOSRelaunch');
  tv.document.fire('webOSRelaunch');
  tv.advance(4000, ticking(tv));
  assert.match(tv.platform.diagnostics(), / · rl 2 · snd/);
  assert.strictEqual(tv.videos.length, 1);
});

