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
    addEventListener: (name, fn) => { (windowListeners[name] = windowListeners[name] || []).push(fn); }
  };
  class FakeDate { getTime() { return clock; } }
  const context = {
    window, document, JSON, Math, Number, String, Date: FakeDate,
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.push({ id, at: clock + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); }
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'platform.js' });
  const platform = window.COUCHSUBS_PLATFORM;
  const host = new Element('div');

  const tv = {
    platform, document, videos, statuses, host,
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
    assert.match(tv.platform.diagnostics(), /^hdmi playing rs4 1920x1080 t[+=] · webOS 7\.4\.0 55NANO756PA cr79$/);
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
