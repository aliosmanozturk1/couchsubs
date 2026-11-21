// SPDX-License-Identifier: AGPL-3.0-only
// Samsung TV (tv-tizen/platform.js): ultrawide ekranda sayfa görünümü ve HDMI penceresi (#304). Sayfa sahte Tizen
// API'leriyle Node'da çalıştırılır; TV ya da tarayıcı gerekmez. Çalıştırma: node --test scripts/tv-tizen.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const tizenDir = path.join(__dirname, '..', 'tv-tizen');
const code = fs.readFileSync(path.join(tizenDir, 'platform.js'), 'utf8');

// innerWidth/innerHeight: uygulama yüzeyinin paketteki "width=device-width" görünümündeki ölçüsü.
// opts.screen: window.screen; opts.area: Samsung'un '100%' pencere için getRect('px') ile bildirdiği alan [w, h]
// (verilmezse sayfa ölçüsü; null ise getRect yok). Sahte show, Samsung belgesindeki gibi alanın dışına taşan
// dikdörtgeni NotSupportedError ile reddeder ve başarıda istenen dikdörtgeni aynen geri verir.
// opts.reject(rect): true ise show o dikdörtgeni ayrıca reddeder; opts.picture: kayıtlı seçim.
// opts.follow: görünüm değişince innerWidth/innerHeight de değişir ('width=device-width' ekranın ölçüsü, 'width=N' N
// genişlik, 16:9). opts.cssBounds: TVWindow sınırı ve '100%' penceresi o anki sayfa ölçüsü (4K Samsung QN900A).
function load(innerWidth, innerHeight, opts = {}) {
  let window = null;
  const meta = { content: 'width=device-width', setAttribute(name, value) {
    if (name !== 'content') return;
    this.content = value;
    if (!opts.follow || !window) return;
    const width = value === 'width=device-width' ? opts.screen[0] : Number(value.replace('width=', ''));
    window.innerWidth = width;
    window.innerHeight = Math.round(width * opts.screen[1] / opts.screen[0]);
  } };
  const shown = [];
  const store = {};
  if (opts.picture) store['couchsubs.picture'] = opts.picture;
  window = { innerWidth, innerHeight, addEventListener() {},
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
  if (opts.screen) window.screen = { width: opts.screen[0], height: opts.screen[1] };
  const area = opts.area === undefined ? [innerWidth, innerHeight] : opts.area;
  // opts.physical: TV koordinatı fiziksel pikselde okur (sınır ekranın ölçüsü), '100%' ise sayfanın CSS ölçüsünde çizilir
  // (4K Samsung, scr 3840x2160, sayfa 1920x1080: görüntü sol üst çeyrekte).
  const staticBounds = opts.physical ? opts.screen : area || [innerWidth, innerHeight];
  const staticArea = area || [innerWidth, innerHeight];
  const page = () => [window.innerWidth, window.innerHeight];
  let bounds = staticBounds;
  let fullArea = staticArea;
  let current = null;
  const px = (rect) => rect.map((v) => (String(v).endsWith('%') ? null : parseFloat(v)));
  const outside = (rect) => {
    const [x, y, w, h] = px(rect);
    if (w === null) return false;
    return x < 0 || y < 0 || x + w > bounds[0] || y + h > bounds[1];
  };
  const tvwindow = {
    setSource(source, ok) { ok(); },
    show(ok, fail, rect, type, z) {
      if (opts.cssBounds) bounds = fullArea = page();
      const entry = { rect: [...rect], type, z, ok: false, page: page() };
      shown.push(entry);
      if (outside(rect) || (opts.reject && opts.reject(rect))) {
        const error = new Error('outside'); error.name = 'NotSupportedError';
        return fail(error);
      }
      entry.ok = true;
      current = String(rect[2]).endsWith('%') ? ['0px', '0px', fullArea[0] + 'px', fullArea[1] + 'px'] : [...rect];
      ok([...rect]);
    },
  };
  if (area) tvwindow.getRect = (ok) => ok(opts.lyingRect ? ['0px', '0px', fullArea[0] + 'px', fullArea[1] + 'px'] : current ? [...current] : null);
  // Çözünürlük değişikliği dinleyicisi ve zamanlayıcılar elle yürütülür.
  const listeners = [];
  tvwindow.addVideoResolutionChangeListener = (callback) => { listeners.push(callback); return listeners.length; };
  tvwindow.getVideoResolution = (ok) => ok({ width: 1920, height: 1080, frequency: 60, type: 'HDMI' });
  let timers = [];
  let intervals = [];
  const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].fn = null; };
  const setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  const runTimers = () => { const due = timers; timers = []; for (const t of due) if (t.fn) t.fn(); };
  const tick = () => { for (const t of intervals) t.fn(); };
  const resolution = (info) => { for (const l of listeners) l(info); };
  // Samsung pencereyi kendiliğinden '100%'e döndürür (PS5 sinyal değişimi).
  const resetWindow = () => { current = ['0px', '0px', fullArea[0] + 'px', fullArea[1] + 'px']; };
  const tizen = {
    systeminfo: {
      getPropertyValue(name, ok) { ok({ connected: [{ type: 'HDMI', number: 1 }], disconnected: [] }); },
    },
    tvwindow,
  };
  const document = { querySelector: (q) => (q === 'meta[name="viewport"]' ? meta : null), documentElement: { style: {} } };
  vm.runInNewContext(code, { window, document, tizen, setTimeout, clearTimeout, setInterval });
  const diagnostics = [];
  window.COUCHSUBS_PLATFORM.pictureDiagnostics((text) => diagnostics.push(text));
  // accepted: Samsung'un kabul ettiği istekler (reddedilen denemeler hariç).
  return { platform: window.COUCHSUBS_PLATFORM, meta, shown, store, diagnostics, current: () => current, window, document,
    accepted: () => shown.filter((s) => s.ok),
    runTimers, tick, resolution, resetWindow, listeners, pending: () => timers.filter((t) => t.fn).length, intervals: () => intervals.length };
}

test('16:9 TV (1080p ve 4K): görünüm 1920 piksel kalır', () => {
  assert.equal(load(1920, 1080).meta.content, 'width=1920');
  // Yuvarlama payı: 16:9'a yakın yüzey de değişmez.
  assert.equal(load(1920, 1079).meta.content, 'width=1920');
  // 16:10 ve 4:3 de geniş sayılmaz.
  assert.equal(load(1920, 1200).meta.content, 'width=1920');
});

test('21:9 ultrawide yüzey (Odyssey G8 3440x1440): sayfa 1080 piksel yükseklikte, ekran genişliğinde', () => {
  assert.equal(load(3440, 1440).meta.content, 'width=2580');
  // Eski görünümle ölçülen 1920x804 yüzey de aynı orana gelir.
  assert.equal(load(1920, 804).meta.content, 'width=2579');
  // 2560x1080 yüzey.
  assert.equal(load(1920, 810).meta.content, 'width=2560');
});

test('32:9 yüzey de geniş sayılır', () => {
  assert.equal(load(1920, 540).meta.content, 'width=3840');
});

test('viewportFor: geçersiz ölçüde dokunmaz, oranı korur', () => {
  const { platform } = load(1920, 1080);
  assert.equal(platform.viewportFor(0, 0), null);
  assert.equal(platform.viewportFor(undefined, 1080), null);
  assert.equal(platform.viewportFor(3440, 1440), 'width=2580');
  assert.equal(platform.viewportFor(5120, 1440), 'width=3840');
  assert.equal(platform.viewportFor(3840, 2160), null);
  assert.equal(platform.viewportFor(1440, 1080), null);
});

const FULL = ['0', '0', '100%', '100%'];

function playHdmi(loaded) {
  const statuses = [];
  loaded.platform.showHdmi(1, null, (s) => statuses.push(s));
  assert.deepEqual(statuses, ['loading', 'playing']);
  return loaded.accepted().map((s) => s.rect);
}

test('16:9 TV (1080p ve 4K): HDMI penceresi yüzeyin tamamı, sayfanın arkasında; tek show', () => {
  for (const screen of [[1920, 1080], undefined]) {
    const loaded = load(1920, 1080, { screen });
    assert.deepEqual(playHdmi(loaded), [FULL]);
    assert.equal(loaded.shown[0].type, 'MAIN');
    assert.equal(loaded.shown[0].z, 'BEHIND');
    assert.equal(loaded.platform.pictureModes(), null);
  }
});

// Her istenen dikdörtgen alanın içinde (eksi köken ya da alandan büyük ölçü yok).
function assertInside(rects, bounds) {
  for (const rect of rects) {
    if (String(rect[2]).endsWith('%')) continue;
    const [x, y, w, h] = rect.map((v) => parseFloat(v));
    assert.ok(x >= 0 && y >= 0 && x + w <= bounds[0] && y + h <= bounds[1], JSON.stringify(rect));
  }
}

// #304: 0.9.32 pencereyi sayfa kökenli ama fiziksel ölçüde istiyordu (['10px','-180px','2560px','1440px']). Samsung
// belgesine göre görüntü alanından taşan dikdörtgen reddedilir; yedekler de taştığı için sonunda '100%' kalıyordu
// ("değişen bir şey yok"). Artık istek hep alanın içinde.
test('3440x1440 (Odyssey G8), Samsung alanı sayfa ölçüsünde: 16:9 kutu alanın içinde, kabul edilir', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440] });
  assert.equal(loaded.meta.content, 'width=2580');
  const rects = playHdmi(loaded);
  assert.deepEqual(rects, [FULL, ['330px', '0px', '1920px', '1080px']]);
  assertInside(rects, [2580, 1080]);
  assert.deepEqual(loaded.current(), ['330px', '0px', '1920px', '1080px']);
  assert.equal(loaded.platform.pictureModes(), 'fit');
});

test('3440x1440, Samsung alanı fiziksel pikselde bildirirse kutu o koordinatta: 2560x1440 ortada', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440], area: [3440, 1440] });
  const rects = playHdmi(loaded);
  assert.deepEqual(rects, [FULL, ['440px', '0px', '2560px', '1440px']]);
  assertInside(rects, [3440, 1440]);
});

test('3440x1440, getRect yoksa alan sayfa ölçüsü; ekran ne bildirirse bildirsin istek taşmaz', () => {
  for (const screen of [[3440, 1440], [2580, 1080], [1920, 1080], undefined]) {
    const loaded = load(2580, 1080, { screen, area: null });
    const rects = playHdmi(loaded);
    assert.deepEqual(rects, [FULL, ['330px', '0px', '1920px', '1080px']], JSON.stringify(screen));
    assertInside(rects, [2580, 1080]);
  }
});

test('"ekranı doldur" seçiliyse yalnız 100% penceresi (alanın tamamı), ek istek yok', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440], picture: 'fill' });
  assert.deepEqual(playHdmi(loaded), [FULL]);
  assert.deepEqual(loaded.current(), ['0px', '0px', '2580px', '1080px']);
});

test('Samsung 16:9 kutuyu reddederse 100% penceresi yeniden istenir, görüntü açılır, ret panelde yazar', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440], reject: (rect) => !String(rect[2]).endsWith('%') });
  assert.deepEqual(playHdmi(loaded), [FULL, FULL]);
  assert.deepEqual(loaded.shown.map((s) => s.rect),
    [FULL, ['440px', '0px', '2560px', '1440px'], ['330px', '0px', '1920px', '1080px'], FULL]);
  assert.deepEqual(loaded.current(), ['0px', '0px', '2580px', '1080px']);
  assert.match(loaded.diagnostics.at(-1), /330,0,1920,1080 fail NotSupportedError/);
});

test('Tanı satırı: bildirilen ölçüler, alan, seçim, istek ve sonucu', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440] });
  playHdmi(loaded);
  const line = loaded.diagnostics.at(-1);
  assert.match(line, /scr 3440x1440/);
  assert.match(line, /page 2580x1080/);
  // Önce ekranın fiziksel ölçüsü denenir; bu TV sayfa koordinatı kullandığı için reddedilir, kutu alanda istenir.
  assert.match(line, /100% ok · area 0,0,2580,1080 · fit 440,0,2560,1440 fail NotSupportedError 330,0,1920,1080 ok · now 330,0,1920,1080/);
  // getRect yoksa alanın sayfadan alındığı yazılır.
  const noRect = load(2580, 1080, { area: null });
  playHdmi(noRect);
  assert.match(noRect.diagnostics.at(-1), /area page 0,0,2580,1080/);
  // 16:9 TV'de de ölçüler yazılır (tek show).
  const tv = load(1920, 1080, { screen: [1920, 1080] });
  playHdmi(tv);
  assert.match(tv.diagnostics.at(-1), /page 1920x1080 · 100% ok · area 0,0,1920,1080 · fit$/);
});

test('100% penceresi de açılamazsa tanı satırına yazılır, durum inputError', () => {
  const loaded = load(1920, 1080, { reject: () => true });
  const statuses = [];
  loaded.platform.showHdmi(1, null, (s) => statuses.push(s));
  assert.deepEqual(statuses, ['loading', 'inputError']);
  assert.match(loaded.diagnostics.at(-1), /100% fail NotSupportedError/);
});

test('Sarı tuş (togglePicture): seçim kaydedilir, açık pencere yeni ölçüyle yeniden çizilir', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440] });
  playHdmi(loaded);
  assert.equal(loaded.platform.togglePicture(), 'fill');
  assert.equal(loaded.store['couchsubs.picture'], 'fill');
  assert.deepEqual(loaded.shown.at(-1).rect, FULL);
  assert.deepEqual(loaded.current(), ['0px', '0px', '2580px', '1080px']);
  assert.equal(loaded.platform.togglePicture(), 'fit');
  assert.deepEqual(loaded.shown.at(-1).rect, ['330px', '0px', '1920px', '1080px']);
  assertInside(loaded.accepted().map((s) => s.rect), [2580, 1080]);
  // Fiziksel ölçü bir kez reddedildi; sonraki çizimlerde yeniden denenmez.
  assert.equal(loaded.shown.filter((s) => s.rect[2] === '2560px').length, 1);
});

test('32:9 (Odyssey G9 5120x1440): 16:9 kutu alanın ortasında ya da alanın tamamı', () => {
  assert.deepEqual(playHdmi(load(3840, 1080, { screen: [5120, 1440] })).at(-1), ['960px', '0px', '1920px', '1080px']);
  assert.deepEqual(playHdmi(load(3840, 1080, { screen: [5120, 1440], picture: 'fill' })), [FULL]);
});

test('pictureRect: 16:9 alanda, doldurmada ve geçersiz ölçüde null; sonuç hep alanın içinde', () => {
  const { platform } = load(1920, 1080);
  assert.equal(platform.pictureRect([0, 0, 1920, 1080], 'fit'), null);
  assert.equal(platform.pictureRect([0, 0, 3840, 2160], 'fit'), null);
  assert.equal(platform.pictureRect(null, 'fit'), null);
  assert.equal(platform.pictureRect([0, 0, 0, 1080], 'fit'), null);
  assert.equal(platform.pictureRect([0, 0, 2580, 1080], 'fill'), null);
  assert.deepEqual([...platform.pictureRect([0, 0, 2560, 1080], 'fit')], ['320px', '0px', '1920px', '1080px']);
  for (const area of [[0, 0, 2580, 1080], [0, 0, 3440, 1440], [0, 0, 1921, 804], [0, 0, 5120, 1440]]) {
    const [x, y, w, h] = platform.pictureRect(area, 'fit').map((v) => parseFloat(v));
    assert.ok(x >= 0 && y === 0 && x + w <= area[2] && h <= area[3], JSON.stringify(area));
  }
});

test('config.xml: yüzey ekranın tamamı (base_screen_resolution=fullscreen)', () => {
  const config = fs.readFileSync(path.join(tizenDir, 'config.xml'), 'utf8');
  assert.match(config, /<tizen:metadata key="http:\/\/tizen\.org\/metadata\/app_ui_type\/base_screen_resolution" value="fullscreen"\/>/);
});

// TV'nin kendi adresi (#484): Tizen sistem bilgisi adres vermezse Samsung ağ API'si sorulur.
function loadNetwork({ ethernet, wifi, samsung }) {
  const answer = (value) => (name, ok, fail) => {
    if (value === undefined) return fail(new Error('NotSupportedError'));
    ok({ ipAddress: value });
  };
  const tizen = {
    systeminfo: {
      getPropertyValue(name, ok, fail) {
        if (name === 'ETHERNET_NETWORK') return answer(ethernet)(name, ok, fail);
        if (name === 'WIFI_NETWORK') return answer(wifi)(name, ok, fail);
        ok({ connected: [], disconnected: [] });
      },
    },
  };
  const window = { innerWidth: 1920, innerHeight: 1080, addEventListener() {} };
  const document = { querySelector: () => null };
  const context = { window, document, tizen };
  if (samsung !== undefined) {
    context.webapis = { network: { getIp() { if (samsung instanceof Error) throw samsung; return samsung; } } };
  }
  vm.runInNewContext(code, context);
  return window.COUCHSUBS_PLATFORM;
}

function addressOf(platform) {
  let result = 'yanıt yok';
  platform.localAddress((ip) => { result = ip; });
  return result;
}

test('localAddress: Tizen sistem bilgisi adres verirse o kullanılır (kablolu önce)', () => {
  assert.equal(addressOf(loadNetwork({ ethernet: '192.168.1.40', wifi: '192.168.1.41', samsung: '10.0.0.2' })), '192.168.1.40');
  assert.equal(addressOf(loadNetwork({ ethernet: '', wifi: '192.168.1.41', samsung: '10.0.0.2' })), '192.168.1.41');
});

test('localAddress: sistem bilgisi adres vermezse Samsung ağ API\'si (webapis.network.getIp) sorulur', () => {
  assert.equal(addressOf(loadNetwork({ samsung: '192.168.0.23' })), '192.168.0.23');
  assert.equal(addressOf(loadNetwork({ ethernet: '', wifi: '', samsung: '192.168.0.23' })), '192.168.0.23');
});

test('localAddress: hiçbir yol adres vermezse null (app.js yaygın ev ağlarını tarar)', () => {
  assert.equal(addressOf(loadNetwork({})), null);
  assert.equal(addressOf(loadNetwork({ samsung: '' })), null);
  assert.equal(addressOf(loadNetwork({ samsung: '0.0.0.0' })), null);
  assert.equal(addressOf(loadNetwork({ samsung: new Error('SecurityError') })), null);
  assert.equal(loadNetwork({}).samsungIp(), null);
});

// Samsung TV'nin tanıdığı izinler ve hangi Tizen sürümünden beri olduğu (Samsung Smart TV API belgeleri: Tizen Web
// Device API, Samsung Product API, W3C). Tizen 2.4 (2016 TV'ler) listede olmayan ya da kendinden yeni izni içeren paketi
// sebep yazmadan "install failed[118]" ile reddeder (#497: http://tizen.org/privilege/power, Power API TV'de yok).
const TV_PRIVILEGES = {
  'http://tizen.org/privilege/tv.window': '2.3',
  'http://tizen.org/privilege/tv.inputdevice': '2.3',
  'http://tizen.org/privilege/tv.audio': '2.3',
  'http://tizen.org/privilege/tv.display': '2.3',
  'http://tizen.org/privilege/application.launch': '2.3',
  'http://tizen.org/privilege/internet': '2.3',
  'http://tizen.org/privilege/network.get': '2.3',
  'http://developer.samsung.com/privilege/network.public': '2.3',
};

function versionNumber(v) {
  const [major, minor = '0'] = v.split('.');
  return Number(major) * 100 + Number(minor);
}

test('config.xml: her izin Samsung TV\'de var ve paketin en düşük Tizen sürümünde de tanınıyor (#497)', () => {
  const config = fs.readFileSync(path.join(tizenDir, 'config.xml'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const required = (config.match(/required_version="([0-9.]+)"/) || [])[1];
  assert.equal(required, '2.4', '2016 Samsung TV\'ler (Tizen 2.4) kurabilmeli');
  const privileges = [...config.matchAll(/<tizen:privilege name="([^"]+)"\/>/g)].map((m) => m[1]);
  assert.ok(privileges.length > 0);
  for (const name of privileges) {
    assert.ok(name in TV_PRIVILEGES, `${name} Samsung TV izin listesinde yok; Tizen 2.4 paketi reddeder`);
    assert.ok(versionNumber(TV_PRIVILEGES[name]) <= versionNumber(required), `${name} Tizen ${required}'te yok`);
  }
  assert.ok(!privileges.includes('http://tizen.org/privilege/power'));
  // Ağ adresi yedeği (webapis.network.getIp) için gereken izin duruyor.
  assert.ok(privileges.includes('http://developer.samsung.com/privilege/network.public'));
});

test('platform.js: Samsung TV\'de olmayan Tizen Power API\'si çağrılmıyor (#497)', () => {
  assert.doesNotMatch(code, /tizen\.power/);
});

// #304: PS5 menüden oyuna geçince HDMI sinyali değişir, Samsung pencereyi '100%'e döndürür; görüntü yeniden dört yandan
// çubuklu kalıyordu. Sinyal değişince ve kutu bozulunca pencere yeniden istenir.
const BOX = ['330px', '0px', '1920px', '1080px'];

test('Sinyal değişince (PS5 menü → oyun) 16:9 kutu kısa gecikmeyle yeniden istenir', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440] });
  playHdmi(loaded);
  assert.equal(loaded.listeners.length, 1);
  loaded.resetWindow();
  loaded.resolution({ width: 3840, height: 2160, frequency: 60, type: 'HDMI' });
  // Hemen değil, sinyal oturunca (iki deneme).
  assert.equal(loaded.pending(), 2);
  const before = loaded.shown.length;
  loaded.runTimers();
  assert.deepEqual(loaded.shown.slice(before).map((s) => s.rect), [FULL, BOX, FULL, BOX]);
  assert.deepEqual(loaded.current(), BOX);
  assert.match(loaded.diagnostics.at(-1), /^signal 3840\/2160\/60\/HDMI → .*330,0,1920,1080 ok/);
});

test('Aynı çözünürlük yeniden bildirilirse pencere yenilenmez; ilk değer de yenilemez', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440] });
  playHdmi(loaded);
  loaded.platform.videoResolution(() => {});
  loaded.resolution({ width: 1920, height: 1080, frequency: 60, type: 'HDMI' });
  assert.equal(loaded.pending(), 0);
  loaded.resolution({ width: 1920, height: 1080, frequency: 120, type: 'HDMI' });
  assert.equal(loaded.pending(), 2);
  loaded.runTimers();
  loaded.resolution({ width: 1920, height: 1080, frequency: 120, type: 'HDMI' });
  assert.equal(loaded.pending(), 0);
});

test('Samsung kutuyu sessizce 100%e döndürürse birkaç saniyede bir sınanır ve yeniden istenir', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440] });
  playHdmi(loaded);
  assert.equal(loaded.intervals(), 1);
  let before = loaded.shown.length;
  loaded.tick();
  assert.equal(loaded.shown.length, before, 'kutu duruyorsa yeniden çizilmez');
  loaded.resetWindow();
  loaded.tick();
  assert.deepEqual(loaded.shown.slice(before).map((s) => s.rect), [FULL, BOX]);
  assert.match(loaded.diagnostics.at(-1), /^reset 0,0,2580,1080 → /);
  before = loaded.shown.length;
  loaded.tick();
  assert.equal(loaded.shown.length, before);
});

test('getRect kabul edilen kutuyu söylemiyorsa sınama yapılmaz (boşuna yeniden çizim yok)', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440], lyingRect: true });
  playHdmi(loaded);
  const before = loaded.shown.length;
  loaded.tick();
  loaded.tick();
  assert.equal(loaded.shown.length, before);
});

test('Ekranı doldur seçiliyken ve 16:9 TV\'de sınama/yeniden isteme yok', () => {
  const fill = load(2580, 1080, { screen: [3440, 1440], picture: 'fill' });
  playHdmi(fill);
  const before = fill.shown.length;
  fill.tick();
  assert.equal(fill.shown.length, before);
  const tv = load(1920, 1080);
  playHdmi(tv);
  const shownBefore = tv.shown.length;
  tv.tick();
  assert.equal(tv.shown.length, shownBefore);
  tv.resolution({ width: 3840, height: 2160, frequency: 60, type: 'HDMI' });
  assert.equal(tv.pending(), 0);
});

// X'te bildirilen 4K Samsung TV (QE75QN900A, 0.9.46): Pencere satırı 'scr 3840x2160 dpr 1 page 1920x1080 vv 2 · 100% ok ·
// area 0,0,1920,1080 · fit 0,0,3840,2160 fail NotSupportedError · now 0,0,1920,1080'. TVWindow dikdörtgeni o anki sayfa
// ölçüsünde sınırlıyor (cssBounds), sayfa 1920'lik görünümde 2 kat büyütülüyor: '100%' sol üst çeyrek. Görünüm kısa
// süre ekran genişliğinde açılıp '100%' o ölçüde istenir (hold); Sarı sıradaki yöntemi dener.
// Görünüm değişikliğinden sonraki beklemeler dahil bütün zamanlayıcılar.
function drain(loaded) {
  for (let i = 0; i < 10 && loaded.pending(); i++) loaded.runTimers();
}

function playAsync(loaded) {
  const statuses = [];
  loaded.platform.showHdmi(1, null, (s) => statuses.push(s));
  drain(loaded);
  assert.deepEqual(statuses, ['loading', 'playing']);
  return loaded.accepted().map((s) => s.rect);
}

const QN900A = { screen: [3840, 2160], follow: true, cssBounds: true };

test('4K Samsung (QN900A): fiziksel istek reddedilir, pencere ekran genişliğindeki görünümde istenir, sayfa 1920ye döner', () => {
  const loaded = load(1920, 1080, QN900A);
  assert.equal(loaded.meta.content, 'width=1920');
  assert.deepEqual(playAsync(loaded), [FULL, FULL]);
  assert.deepEqual(loaded.shown.map((s) => s.rect), [FULL, ['0px', '0px', '3840px', '2160px'], FULL]);
  // Son '100%' ekran genişliğindeki görünümde istendi: pencere ekranın tamamı.
  assert.deepEqual(loaded.shown.at(-1).page, [3840, 2160]);
  assert.deepEqual(loaded.current(), ['0px', '0px', '3840px', '2160px']);
  // Sayfa yine 1920'lik görünümde, zoom yok.
  assert.equal(loaded.meta.content, 'width=1920');
  assert.equal(loaded.platform.pageZoom(), 1);
  assert.equal(loaded.platform.pictureModes(), 'hold');
  assert.match(loaded.diagnostics.at(-1),
    /scr 3840x2160 .*area 0,0,1920,1080 · auto · physical 0,0,3840,2160 fail NotSupportedError hold vw 3840 ok · now 0,0,3840,2160 · vw 1920$/);
  // Yeniden açılışta fiziksel istek bir daha denenmez.
  playAsync(loaded);
  assert.equal(loaded.shown.filter((s) => s.rect[2] === '3840px').length, 1);
});

test('4K Samsung: sinyal değişince (menü → oyun) pencere yine ekran genişliğindeki görünümde istenir', () => {
  const loaded = load(1920, 1080, QN900A);
  playAsync(loaded);
  loaded.resetWindow();
  loaded.resolution({ width: 3840, height: 2160, frequency: 60, type: 'HDMI' });
  drain(loaded);
  assert.deepEqual(loaded.current(), ['0px', '0px', '3840px', '2160px']);
  assert.equal(loaded.meta.content, 'width=1920');
  assert.match(loaded.diagnostics.at(-1), /^signal 3840\/2160\/60\/HDMI → .*hold vw 3840 ok/);
});

test('4K Samsung: Sarı sırayla zoom, page, hold dener; seçim saklanır, zoom sayfayı 1920lik ölçüye büyütür', () => {
  const loaded = load(1920, 1080, QN900A);
  playAsync(loaded);
  const yellow = () => { const mode = loaded.platform.togglePicture(() => {}); drain(loaded); return mode; };
  assert.equal(yellow(), 'zoom');
  assert.equal(loaded.store['couchsubs.picture4k'], 'zoom');
  assert.equal(loaded.meta.content, 'width=device-width');
  assert.equal(loaded.document.documentElement.style.zoom, '2');
  assert.equal(loaded.platform.pageZoom(), 2);
  assert.deepEqual(loaded.current(), ['0px', '0px', '3840px', '2160px']);
  assert.match(loaded.diagnostics.at(-1), /· zoom · zoom vw 3840 ok · now 0,0,3840,2160 · vw 3840 zoom 2$/);
  assert.equal(yellow(), 'page');
  assert.equal(loaded.meta.content, 'width=1920');
  assert.equal(loaded.document.documentElement.style.zoom, '');
  assert.equal(loaded.platform.pageZoom(), 1);
  assert.deepEqual(loaded.current(), ['0px', '0px', '1920px', '1080px']);
  assert.match(loaded.diagnostics.at(-1), /· page · page ok/);
  assert.equal(yellow(), 'hold');
  assert.deepEqual(loaded.current(), ['0px', '0px', '3840px', '2160px']);
  // Kayıtlı seçim yeniden açılışta kullanılır (fiziksel istek denenmez).
  const again = load(1920, 1080, { ...QN900A });
  again.store['couchsubs.picture4k'] = 'zoom';
  playAsync(again);
  assert.equal(again.shown.filter((s) => s.rect[2] === '3840px').length, 0);
  assert.equal(again.platform.pageZoom(), 2);
});

test('4K Samsung: görünüm genişlemezse hold ve zoom atlanır, eski 100% penceresi kalır, nedeni yazılır', () => {
  const loaded = load(1920, 1080, { screen: [3840, 2160], cssBounds: true });
  playAsync(loaded);
  assert.equal(loaded.meta.content, 'width=1920');
  assert.equal(loaded.platform.pageZoom(), 1);
  assert.match(loaded.diagnostics.at(-1), /physical 0,0,3840,2160 fail NotSupportedError hold fail vw 1920 zoom fail vw 1920 page ok/);
});

test('4K Samsung fiziksel koordinat kullanıyorsa (0.9.39) pencere ekranın fiziksel ölçüsünde kalır', () => {
  const loaded = load(1920, 1080, { screen: [3840, 2160], physical: true });
  assert.deepEqual(playHdmi(loaded), [FULL, ['0px', '0px', '3840px', '2160px']]);
  assert.deepEqual(loaded.current(), ['0px', '0px', '3840px', '2160px']);
  assert.match(loaded.diagnostics.at(-1), /scr 3840x2160 .*area 0,0,1920,1080 · auto · physical 0,0,3840,2160 ok/);
  loaded.resetWindow();
  loaded.resolution({ width: 3840, height: 2160, frequency: 60, type: 'HDMI' });
  loaded.runTimers();
  assert.deepEqual(loaded.current(), ['0px', '0px', '3840px', '2160px']);
});

test('Ultra geniş monitör fiziksel koordinat kullanıyorsa 16:9 kutu fiziksel ölçüde ortada', () => {
  const loaded = load(2580, 1080, { screen: [3440, 1440], physical: true });
  assert.deepEqual(playHdmi(loaded), [FULL, ['440px', '0px', '2560px', '1440px']]);
  const fill = load(2580, 1080, { screen: [3440, 1440], physical: true, picture: 'fill' });
  assert.deepEqual(playHdmi(fill), [FULL, ['0px', '0px', '3440px', '1440px']]);
});
