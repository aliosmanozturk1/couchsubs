// SPDX-License-Identifier: AGPL-3.0-only
// Samsung TV paketinin (scripts/package-tizen.sh çıktısı) gerçek Chromium'da çizimi: ultrawide (3440x1440), 16:9
// (1920x1080) ve 4K (3840x2160) ekran, görünüm (viewport) etiketi dikkate alınarak (TV tarayıcısı gibi). #304: paketteki sabit
// "width=1920" görünümü Samsung'un uygulamayı 21:9 ekranda 16:9 kutuda tutmasına yol açıyordu.
// Çalıştırma: node --test scripts/tv-tizen-screen.test.js (Tarayıcı yolu: COUCHSUBS_TEST_BROWSER)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.join(__dirname, '..');
const browser = [process.env.COUCHSUBS_TEST_BROWSER, process.env.CHROME_BIN,
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => p && fs.existsSync(p));
const shell = process.platform === 'win32' ? null : '/bin/sh';

// Chrome DevTools protokolü (--remote-debugging-pipe: fd 3 yazma, fd 4 okuma; iletiler \0 ile ayrılır).
function devtools(proc) {
  let id = 0, buffer = '';
  const waiting = new Map();
  proc.stdio[4].on('data', chunk => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const pending = waiting.get(message.id);
      if (!pending) continue;
      waiting.delete(message.id);
      message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result);
    }
  });
  return (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const message = { id: ++id, method, params };
    if (sessionId) message.sessionId = sessionId;
    waiting.set(message.id, { resolve, reject });
    proc.stdio[3].write(JSON.stringify(message) + '\0');
  });
}

// extra.cssBounds: sahte TVWindow dikdörtgeni o anki sayfa ölçüsünde sınırlar (4K QN900A); extra.yellow: Sarı tuşa
// kaç kez basılacağı (her basıştan sonra ölçülür).
async function render(page, width, height, extra = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'couchsubs-tizen-screen-'));
  const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--remote-debugging-pipe', '--user-data-dir=' + path.join(temp, 'profile'),
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []), 'about:blank'],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  try {
    const send = devtools(proc);
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    // mobile: görünüm etiketi TV tarayıcısındaki gibi uygulanır; ekran fiziksel çözünürlükte.
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true,
      screenWidth: width, screenHeight: height }, sessionId);
    await send('Page.enable', {}, sessionId);
    // extra.display: Tizen SystemInfo DISPLAY (platform.js paneli sayfa yüklenirken okur).
    if (extra.display) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.tizen = { systeminfo: { getPropertyValue: ' +
        'function (name, ok) { ok(name === "DISPLAY" ? ' + JSON.stringify(extra.display) + ' : { connected: [] }); } } };' }, sessionId);
    }
    await send('Page.navigate', { url: pathToFileURL(page).href }, sessionId);
    const expression = `new Promise(function (done) { setTimeout(function () {
      function box(el) { var b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; }
      // Bilgi paneli (kumandada OK) açık çizilir: kullanıcının fotoğrafındaki sol üst kutu.
      document.getElementById('panel').className = '';
      // HDMI penceresi (#304): sahte TVWindow (getRect yok; Samsung belgesindeki gibi istenen dikdörtgeni geri verir).
      var rects = [];
      var cssBounds = ${JSON.stringify(!!extra.cssBounds)};
      window.tizen = { systeminfo: { getPropertyValue: function (name, ok) { ok({ connected: [{ type: 'HDMI', number: 1 }] }); } },
        tvwindow: { setSource: function (s, ok) { ok(); }, show: function (ok, fail, rect) {
          rects.push(rect.slice().concat(['@' + innerWidth]));
          if (cssBounds && String(rect[2]).indexOf('%') < 0 && parseFloat(rect[2]) > innerWidth) {
            return fail({ name: 'NotSupportedError' });
          }
          ok(rect.slice()); } } };
      function snapshot() {
        return {
          rects: rects.map(function (r) { return cssBounds ? r : r.slice(0, 4); }),
          viewport: document.querySelector('meta[name="viewport"]').getAttribute('content'),
          inner: [innerWidth, innerHeight],
          scale: visualViewport.scale,
          zoom: document.documentElement.style.zoom || '',
          panel: box(document.getElementById('panel')),
          subtitle: box(document.getElementById('subtitle')),
          keys: document.getElementById('keys').textContent,
        };
      }
      var shots = [];
      var presses = ${Number(extra.yellow || 0)};
      window.COUCHSUBS_PLATFORM.showHdmi(1, null, function () {});
      function next() {
        shots.push(snapshot());
        if (shots.length > presses) return done(JSON.stringify(presses ? shots : shots[0]));
        window.COUCHSUBS_PLATFORM.togglePicture(function () {});
        setTimeout(next, 800);
      }
      setTimeout(next, ${extra.cssBounds ? 800 : 0});
    }, 1500); })`;
    const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    return JSON.parse(result.value);
  } finally {
    proc.kill();
    await new Promise(resolve => proc.exitCode !== null ? resolve() : proc.once('exit', resolve));
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
    // Chrome'un yardımcı süreçleri ana süreç çıktıktan sonra da profile yazabiliyor (sayfa ağda CouchSubs ararken):
    // geçici klasör silinemezse test başarısız sayılmaz.
    try {
      fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (e) {
      if (e.code !== 'ENOTEMPTY' && e.code !== 'EBUSY') throw e;
    }
  }
}

if (process.env.CI) assert.ok(browser, 'CI: Samsung çizim testi için Chrome gerekli');
const skip = (!browser && 'Chrome bulunamadı') || (!shell && 'sh yok (package-tizen.sh)');

test('Samsung paketi: ultrawide ve 16:9 ekranda sayfa ekranın tamamına çizilir', { skip, timeout: 120000 }, async t => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'couchsubs-tizen-dist-'));
  try {
    const built = spawnSync(shell, [path.join(repo, 'scripts', 'package-tizen.sh')],
      { env: { ...process.env, COUCHSUBS_DIST: dist, TIZEN_PROFILE: '' }, encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const page = path.join(dist, 'tv-tizen', 'app', 'index.html');
    const html = fs.readFileSync(page, 'utf8');

    await t.test('paketteki görünüm device-width (Samsung 21:9 desteğinin şartı), ortak sayfa 1920 kalır', () => {
      assert.match(html, /<meta name="viewport" content="width=device-width">/);
      assert.doesNotMatch(html, /content="width=1920"/);
      assert.match(fs.readFileSync(path.join(repo, 'tv-webos', 'index.html'), 'utf8'), /<meta name="viewport" content="width=1920">/);
    });

    await t.test('3440x1440 (Odyssey G8): sayfa 2580x1080 görünümde, ekranın tamamında', async () => {
      const r = await render(page, 3440, 1440);
      assert.equal(r.viewport, 'width=2580');
      assert.deepEqual(r.inner, [2580, 1080]);
      // Bilgi paneli 16:9 kutunun içinde (soldan 440 + güvenli alan, fotoğraftaki gibi) değil, ekranın sol güvenli
      // alanında (1080p'deki 96 piksel, 1440 satırlık ekranda 128).
      assert.ok(Math.abs(r.panel.left * r.scale - 128) < 2, JSON.stringify(r));
      assert.ok(r.panel.right > r.panel.left, JSON.stringify(r));
      // Altyazı alanı tam genişlikte ortalanır.
      assert.ok(Math.abs((r.subtitle.left + r.subtitle.right) / 2 - 1290) < 2, JSON.stringify(r));
      // HDMI penceresi: 16:9 kutu sayfa (2580x1080) koordinatında, sınırlar içinde ve ortada istenir; 0.9.32'deki
      // ['10px','-180px','2560px','1440px'] alanın dışına taştığı için Samsung reddediyordu.
      // Ekran (3440x1440) sayfadan büyük: önce fiziksel ölçüde 16:9 kutu istenir. Bu sahte pencere her isteği kabul
      // ettiği için orada kalır; sayfa koordinatı kullanan TV bunu reddeder, kutu sayfada istenir (tv-tizen.test.js).
      assert.deepEqual(r.rects, [['0', '0', '100%', '100%'], ['440px', '0px', '2560px', '1440px']]);
    });

    await t.test('1920x1080 (16:9 TV): görünüm eskisi gibi 1920', async () => {
      const r = await render(page, 1920, 1080);
      assert.equal(r.viewport, 'width=1920');
      assert.deepEqual(r.inner, [1920, 1080]);
      assert.ok(Math.abs(r.panel.left - 96) < 2, JSON.stringify(r));
      assert.ok(Math.abs((r.subtitle.left + r.subtitle.right) / 2 - 960) < 2, JSON.stringify(r));
      // 16:9 TV'de HDMI penceresi eskisi gibi tek '100%' çağrısı.
      assert.deepEqual(r.rects, [['0', '0', '100%', '100%']]);
    });

    await t.test('3840x2160 (4K QN900A, pencere sayfa ölçüsünde sınırlı): yöntemler sırayla, sayfa düzeni değişmez', async () => {
      // X'teki 4K Samsung: 'scr 3840x2160 dpr 1 page 1920x1080 vv 2'; 3840x2160 px reddedilir, '100%' sol üst çeyrek.
      const [hold, zoom, page2] = await render(page, 3840, 2160, { cssBounds: true, yellow: 2 });
      const FULL = ['0', '0', '100%', '100%'];
      // Varsayılan (hold): fiziksel istek reddedilir, '100%' ekran genişliğindeki görünümde (3840) istenir, sayfa 1920'ye
      // döner (visualViewport 2, eskisi gibi).
      assert.deepEqual(hold.rects, [[...FULL, '@1920'], ['0px', '0px', '3840px', '2160px', '@1920'], [...FULL, '@3840']]);
      assert.equal(hold.viewport, 'width=1920');
      assert.deepEqual(hold.inner, [1920, 1080]);
      assert.equal(hold.scale, 2);
      // Sarı (zoom): sayfa ekran genişliğinde, CSS zoom 2; son '100%' 3840'lık sayfada. Panel ve altyazı ekranda aynı
      // yerde (bu Chrome'da getBoundingClientRect zoom'lu ölçü verir: hold'daki CSS ölçüsü x visualViewport).
      assert.equal(zoom.viewport, 'width=device-width');
      assert.deepEqual(zoom.inner, [3840, 2160]);
      assert.equal(zoom.zoom, '2');
      assert.deepEqual(zoom.rects.at(-1), [...FULL, '@3840']);
      // Panelin alt kenarı Pencere satırının uzunluğuna bağlı (yöntemler ve panel ölçüsü yazılır, satır kaydırılır).
      for (const key of ['panel', 'subtitle']) {
        for (const side of key === 'panel' ? ['left', 'right', 'top'] : ['left', 'right', 'top', 'bottom']) {
          assert.ok(Math.abs(zoom[key][side] - hold[key][side] * hold.scale) < 2, key + ' ' + side + ' ' + JSON.stringify([hold, zoom]));
        }
      }
      // Sarı (page): eski davranış, 1920'lik görünümde '100%'.
      assert.equal(page2.viewport, 'width=1920');
      assert.equal(page2.zoom, '');
      assert.deepEqual(page2.rects.at(-1), [...FULL, '@1920']);
    });

    await t.test('Ekranı 1920x1080 bildiren ultra geniş monitör (#304, DISPLAY 3440x1440): pencere 2560lık görünümde, tuş listesinde Sarı', async () => {
      // 0.9.49 fotoğrafı: 'scr 1920x1080 dpr 1 page 1920x1080 vv 1 · 100% ok · area 0,0,1920,1080 · fit', listede Sarı yok.
      const [hold, zoom] = await render(page, 1920, 1080,
        { cssBounds: true, yellow: 1, display: { resolutionWidth: 3440, resolutionHeight: 1440 } });
      const FULL = ['0', '0', '100%', '100%'];
      // Panelin pikselindeki 16:9 kutu reddedilir; '100%' panelin 16:9 kutusunun genişliğindeki görünümde istenir.
      assert.deepEqual(hold.rects, [[...FULL, '@1920'], ['440px', '0px', '2560px', '1440px', '@1920'], [...FULL, '@2560']]);
      assert.equal(hold.viewport, 'width=1920');
      assert.match(hold.keys, /(Sarı|Yellow)/);
      // Sarı (zoom): sayfa 2560'lık görünümde 1,33 kat; panel ve altyazı aynı yerde.
      assert.equal(zoom.viewport, 'width=2560');
      assert.deepEqual(zoom.rects.at(-1), [...FULL, '@2560']);
      for (const side of ['left', 'right', 'top', 'bottom']) {
        assert.ok(Math.abs(zoom.subtitle[side] - hold.subtitle[side] * 2560 / 1920) < 2, side + ' ' + JSON.stringify([hold, zoom]));
      }
    });

    await t.test('telefon ve Android uygulamasının paketleri de aynı görünümü yazar', () => {
      for (const file of ['scripts/ios-tv-packages.sh', 'couchsubs-android/app/build.gradle']) {
        assert.match(fs.readFileSync(path.join(repo, file), 'utf8'),
          /'<meta name="viewport" content="width=1920">', '<meta name="viewport" content="width=device-width">'/, file);
      }
    });
  } finally {
    assert.equal(path.dirname(dist), path.resolve(os.tmpdir()));
    fs.rmSync(dist, { recursive: true, force: true });
  }
});
