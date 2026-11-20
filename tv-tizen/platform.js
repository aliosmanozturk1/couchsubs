// SPDX-License-Identifier: AGPL-3.0-only
// Tizen'e (Samsung TV) özgü işler. webOS karşılığı: tv-webos/platform.js
// HDMI görüntüsü resmî TVWindow API'siyle HTML katmanının arkasında gösterilir.
(function () {
  'use strict';

  var KEYS = ['0', '1', '2', '3', '4', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'];
  // Çözünürlük değişikliği dinleyicisi (bir kez kurulur) ve güncel değeri alan işlev.
  var resolutionListener = null;
  var resolutionCallback = null;
  // HDMI görüntüsü uygulama yüzeyinin tamamını kaplar (yüzde, ekran kökenli; Samsung TVWindow API).
  var FULL_SCREEN = ['0', '0', '100%', '100%'];
  // 16:9'dan belirgin geniş yüzey (21:9 = 2,33; 3440x1440 = 2,39; 32:9 = 3,56). 16:9 (1,78) ve yuvarlama payı altında.
  var WIDE_RATIO = 1.9;
  // Sayfa her TV'de 1080 CSS piksel yükseklikte düzenlenir (index.html: width=1920); geniş ekranda da öyle kalır.
  var PAGE_HEIGHT = 1080;
  // 16:9 (ve dar) yüzeyde görünüm genişliği: ortak index.html'deki gibi.
  var NARROW_WIDTH = 1920;

  // Ultrawide ekran (#304): Samsung yüzeyi config.xml'deki base_screen_resolution ile ve ancak sayfa
  // "width=device-width" görünümüyle açılırsa ekranın tamamı yapar (Samsung "21:9 Aspect Ratio Support" belgesi);
  // ortak index.html'in sabit "width=1920"si uygulamayı 16:9 kutuda tutuyordu. Samsung paketinde görünüm bu yüzden
  // device-width'tir (scripts/package-tizen.sh) ve burada asıl değerine getirilir. Geniş yüzeyde genişlik yüksekliği 1080
  // tutacak şekilde verilir (3440x1440 için 2580): yazı ve kutular 16:9 TV'dekiyle aynı boyda, app.js yerleşimi
  // innerWidth/innerHeight'tan hesaplandığı için ekrana yayılır. 16:9 yüzeyde null döner, görünüm eskisi gibi 1920 olur.
  function viewportFor(width, height) {
    if (!(width > 0) || !(height > 0)) return null;
    var ratio = width / height;
    return ratio >= WIDE_RATIO ? 'width=' + Math.round(PAGE_HEIGHT * ratio) : null;
  }

  function fitWideScreen() {
    try {
      var content = viewportFor(window.innerWidth, window.innerHeight) || 'width=' + NARROW_WIDTH;
      var meta = document.querySelector('meta[name="viewport"]');
      if (meta) meta.setAttribute('content', content);
    } catch (e) {}
  }

  // --- Geniş ekranda HDMI penceresi (#304) ---
  // Samsung TVWindow belgesi: show() dikdörtgeni görüntü alanının sınırları içinde olmalıdır, dışına taşan dikdörtgen
  // NotSupportedError ile reddedilir; başarı geri çağrısı da yalnız istenen dikdörtgeni aynen geri verir (gerçek ölçüyü
  // söylemez). 0.9.32'deki düzeltme pencereyi sayfanın kökenine göre fiziksel ölçüde istiyordu (3440x1440'ta
  // ['10px','-180px','2560px','1440px']): x ve y sayfa koordinatında, genişlik ve yükseklik fiziksel pikselde. Bu
  // dikdörtgen görüntü alanının dışına taştığı için Samsung reddediyor, yedekler de ('0px','0px','2560px','1440px' yine
  // taşıyor) sonunda eski '100%' penceresine düşüyordu: kullanıcının "değişen bir şey yok" demesinin nedeni.
  // Artık dikdörtgen tek koordinat sisteminde, Samsung'un '100%' penceresi için bildirdiği alanın (getRect, 'px') ya da o
  // yoksa sayfanın içinde istenir; hiçbir zaman eksi köken ya da alandan büyük ölçü istenmez.
  // PS5 16:9 verir: varsayılan 'fit' alan yüksekliğinde 16:9 (yanlarda siyah), 'fill' alanın tamamı ('100%').
  // Her denemenin sonucu ve bildirilen ölçüler bilgi panelindeki "Pencere" satırına yazılır (pictureDiagnostics).
  var PICTURE_KEY = 'couchsubs.picture';
  var shownPort = null;
  var pictureLog = '';
  var pictureListener = null;
  // Kabul edilen 16:9 kutu (Samsung koordinatında [x, y, w, h]); yoksa null ('100%' penceresi).
  var acceptedRect = null;
  // PS5 menüden oyuna geçince HDMI sinyali değişir (çözünürlük, kare hızı, HDR) ve Samsung pencereyi kendiliğinden
  // '100%'e döndürür; görüntü yeniden dört yandan çubuklu kalıyordu (#304). Sinyal değişince kutu kısa gecikmeyle yeniden
  // istenir; ayrıca açık kutu birkaç saniyede bir getRect ile sınanır, başka ölçüye dönmüşse yeniden istenir.
  var REWINDOW_DELAYS = [700, 2500];
  var WATCH_INTERVAL = 5000;
  var rewindowTimers = [];
  var watchTimer = null;
  // getRect kabul edilen kutuyu geri vermiyorsa (TV gerçek ölçüyü söylemiyor) sınama yapılmaz: yoksa pencere boşuna
  // birkaç saniyede bir yeniden çizilirdi.
  var rectTrusted = true;
  // Son çözünürlük bildirimi; aynısı yeniden gelirse pencere yenilenmez.
  var lastResolution = null;
  // Ekranın fiziksel ölçüsündeki istek bir kez reddedildiyse bu TV sayfa koordinatı kullanıyor; yeniden denenmez.
  var physicalRejected = false;

  function pictureMode() {
    try { return window.localStorage.getItem(PICTURE_KEY) === 'fill' ? 'fill' : 'fit'; } catch (e) { return 'fit'; }
  }

  function parseRect(rect) {
    if (!rect || rect.length !== 4) return null;
    var out = [];
    for (var i = 0; i < 4; i++) {
      var text = String(rect[i]);
      if (text.indexOf('%') >= 0) return null;
      var value = parseFloat(text);
      if (isNaN(value)) return null;
      out.push(value);
    }
    return out[0] >= 0 && out[1] >= 0 && out[2] > 0 && out[3] > 0 ? out : null;
  }

  // area: '100%' penceresinin kapladığı alan [x, y, w, h] (Samsung'un koordinatında). Dönen dikdörtgen hep bu alanın
  // içindedir. 16:9 (ve dar) alanda, 'fill' seçiminde ya da 16:9 kutu alanla aynıysa null: '100%' penceresi kalır.
  function pictureRect(area, mode) {
    if (!area || !(area[2] > 0) || !(area[3] > 0)) return null;
    if (area[2] / area[3] < WIDE_RATIO || mode === 'fill') return null;
    var height = Math.floor(area[3]);
    var width = Math.min(Math.floor(area[2]), Math.round(height * 16 / 9));
    if (area[2] - width < 2) return null;
    var x = Math.max(0, Math.round(area[0] + (area[2] - width) / 2));
    var y = Math.max(0, Math.round(area[1]));
    return [x + 'px', y + 'px', width + 'px', height + 'px'];
  }

  function rectText(rect) {
    if (!rect) return '-';
    var out = [];
    for (var i = 0; i < rect.length; i++) out.push(String(rect[i]).replace('px', ''));
    return out.join(',');
  }

  function errorText(e) {
    return e ? String(e.name || e.code || e.message || e).slice(0, 40) : 'error';
  }

  function notePicture(text) {
    pictureLog = text;
    if (pictureListener) {
      try { pictureListener(text); } catch (e) {}
    }
  }

  // TV'nin bildirdiği ölçüler: hangi koordinat sisteminin geçerli olduğunu bir sonraki fotoğraftan okumak için.
  function reportedSizes() {
    var parts = [];
    try {
      if (window.screen) parts.push('scr ' + window.screen.width + 'x' + window.screen.height);
    } catch (e) {}
    try { if (window.devicePixelRatio) parts.push('dpr ' + window.devicePixelRatio); } catch (e) {}
    try { parts.push('page ' + window.innerWidth + 'x' + window.innerHeight); } catch (e) {}
    try {
      if (window.visualViewport && window.visualViewport.scale) parts.push('vv ' + window.visualViewport.scale);
    } catch (e) {}
    return parts.join(' ');
  }

  // Samsung'un o an gösterdiği pencerenin piksel ölçüsü (getRect). API yoksa ya da hata verirse callback(null).
  function readRect(callback) {
    var called = false;
    var once = function (value) { if (!called) { called = true; callback(value); } };
    try {
      if (!tizen.tvwindow.getRect) return once(null);
      var result = tizen.tvwindow.getRect(function (rect) { once(rect); }, function () { once(null); }, 'px', 'MAIN');
      // Eski sürümler sonucu doğrudan döndürür.
      if (result && result.length === 4) once(result);
    } catch (e) {
      once(null);
    }
  }

  function later(callback, ms) {
    try { return setTimeout(callback, ms); } catch (e) { return null; }
  }

  function cancel(timer) {
    try { if (timer !== null) clearTimeout(timer); } catch (e) {}
  }

  function isWide() {
    return viewportFor(window.innerWidth, window.innerHeight) !== null;
  }

  function sameRect(a, b) {
    if (!a || !b) return false;
    for (var i = 0; i < 4; i++) if (Math.abs(a[i] - b[i]) > 2) return false;
    return true;
  }

  // '100%'ten başka bir pencere gerekiyor mu: geniş ekran ya da ekranın fiziksel ölçüsünde kabul edilmiş pencere (4K).
  function customWindow() {
    return isWide() || acceptedRect !== null;
  }

  // HDMI açıkken pencere yeniden istenir (sinyal değişti ya da Samsung ölçüyü bozdu).
  function rewindow(why) {
    if (shownPort === null || !customWindow()) return;
    try {
      showWindow(function () {}, function () {}, why);
    } catch (e) {}
  }

  function scheduleRewindow(why) {
    if (shownPort === null || !customWindow()) return;
    for (var i = 0; i < rewindowTimers.length; i++) cancel(rewindowTimers[i]);
    rewindowTimers = [];
    for (var j = 0; j < REWINDOW_DELAYS.length; j++) {
      rewindowTimers.push(later(function () { rewindow(why); }, REWINDOW_DELAYS[j]));
    }
  }

  // Kabul edilen 16:9 kutu hâlâ duruyor mu? Samsung '100%'e döndürdüyse yeniden istenir.
  function checkWindow() {
    if (shownPort === null || !acceptedRect || !rectTrusted) return;
    readRect(function (now) {
      var rect = parseRect(now);
      if (rect && acceptedRect && !sameRect(rect, acceptedRect)) rewindow('reset ' + rectText(now));
    });
  }

  function watchWindow() {
    if (watchTimer !== null) return;
    try {
      watchTimer = setInterval(checkWindow, WATCH_INTERVAL);
    } catch (e) {
      watchTimer = false;
    }
  }

  // Sinyal değişince (PS5 menü → oyun) gelen çözünürlük bildirimi: app.js'nin gösterdiği değer ve pencerenin yenilenmesi.
  function onResolution(info) {
    if (resolutionCallback) {
      try { resolutionCallback(info || null); } catch (e) {}
    }
    var key = resolutionKey(info);
    if (key === lastResolution) return;
    lastResolution = key;
    scheduleRewindow('signal ' + key);
  }

  function resolutionKey(info) {
    return info ? [info.width, info.height, info.frequency, info.type].join('/') : '-';
  }

  function listenResolution() {
    if (resolutionListener !== null) return;
    try {
      resolutionListener = tizen.tvwindow.addVideoResolutionChangeListener(onResolution, 'MAIN');
    } catch (e) {
      resolutionListener = false;
    }
  }

  // Ekranın fiziksel ölçüsü '100%' penceresinin alanından belirgin büyükse (4K Samsung: scr 3840x2160, sayfa ve alan
  // 1920x1080, visualViewport 2) o ölçü; değilse null. Böyle TV'lerde '100%' penceresi sayfanın CSS ölçüsüne göre
  // çiziliyor, TV ise koordinatı fiziksel pikselde okuyor: PS5 görüntüsü sol üst çeyrekte küçük kalıyordu.
  function screenArea(area) {
    try {
      var width = window.screen && window.screen.width;
      var height = window.screen && window.screen.height;
      if (!(width > 0) || !(height > 0)) return null;
      return width > area[2] * 1.05 && height > area[3] * 1.05 ? [0, 0, width, height] : null;
    } catch (e) {
      return null;
    }
  }

  function wholeRect(area) {
    return [Math.round(area[0]) + 'px', Math.round(area[1]) + 'px', Math.floor(area[2]) + 'px', Math.floor(area[3]) + 'px'];
  }

  // Pencereyi '100%' açar; geniş alanda seçime göre 16:9 kutuya küçültür. Ekran '100%' alanından büyükse önce ekranın
  // fiziksel ölçüsünde istenir (Samsung sınır dışını reddeder; reddederse alan ölçüsüne düşülür). Hepsi reddedilirse
  // '100%' kalır.
  // why: yeniden istemenin nedeni (tanı satırının başına yazılır; ilk açılışta yok).
  function showWindow(done, failed, why) {
    var mode = pictureMode();
    var prefix = why ? why + ' → ' : '';
    tizen.tvwindow.show(function () {
      readRect(function (full) {
        var area = parseRect(full) || [0, 0, window.innerWidth, window.innerHeight];
        var line = prefix + reportedSizes() + ' · 100% ok · area ' + (parseRect(full) ? '' : 'page ') + rectText(area) + ' · ' + mode;
        var targets = [];
        var physical = physicalRejected ? null : screenArea(area);
        if (physical) targets.push(pictureRect(physical, mode) || wholeRect(physical));
        var boxed = pictureRect(area, mode);
        if (boxed) targets.push(boxed);
        if (!targets.length) {
          acceptedRect = null;
          notePicture(line);
          return done();
        }
        var tried = [];
        var finish = function (target, result) {
          acceptedRect = result === 'ok' ? parseRect(target) : null;
          readRect(function (now) {
            var reported = parseRect(now);
            if (result === 'ok' && reported) rectTrusted = sameRect(reported, parseRect(target));
            notePicture(line + ' ' + tried.join(' ') + (now ? ' · now ' + rectText(now) : ''));
            done();
          });
        };
        var attempt = function (index, lastError) {
          if (index >= targets.length) {
            // Yalnız fiziksel ölçü reddedildiyse pencere zaten '100%'.
            if (physical && targets.length === 1) return finish(null, 'fail ' + errorText(lastError));
            // Reddedilen kutudan sonra pencere '100%' kalsın (Samsung son başarılı ölçüyü korur; yine de yeniden iste).
            var fail = 'fail ' + errorText(lastError);
            try {
              tizen.tvwindow.show(function () { finish(null, fail); }, function () { finish(null, fail); },
                FULL_SCREEN, 'MAIN', 'BEHIND');
            } catch (e2) {
              finish(null, fail);
            }
            return;
          }
          var target = targets[index];
          var rejected = function (e) {
            if (physical && index === 0) physicalRejected = true;
            tried.push(rectText(target) + ' fail ' + errorText(e));
            attempt(index + 1, e);
          };
          try {
            tizen.tvwindow.show(function () {
              tried.push(rectText(target) + ' ok');
              finish(target, 'ok');
            }, rejected, target, 'MAIN', 'BEHIND');
          } catch (e) {
            rejected(e);
          }
        };
        attempt(0, null);
      });
    }, function (e) {
      notePicture(prefix + reportedSizes() + ' · 100% fail ' + errorText(e));
      failed(e);
    }, FULL_SCREEN, 'MAIN', 'BEHIND');
  }

  // Samsung ağ API'sindeki IPv4 adresi (izin: network.public); API yoksa ya da adres boşsa null.
  function samsungIp() {
    try {
      var ip = webapis.network.getIp();
      return /^\d+\.\d+\.\d+\.\d+$/.test(ip || '') && ip !== '0.0.0.0' ? ip : null;
    } catch (e) {
      return null;
    }
  }

  function hdmiSources(callback) {
    try {
      tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (info) {
        var isHdmi = function (source) { return source.type === 'HDMI'; };
        callback((info.connected || []).filter(isHdmi), (info.disconnected || []).filter(isHdmi));
      }, function () { callback([], []); });
    } catch (e) {
      callback([], []);
    }
  }

  // CouchSubs uygulaması TV uygulamasını açarken parametreleri PAYLOAD içinde verir.
  function paramsOf(appControl) {
    var data = (appControl && appControl.data) || [];
    for (var i = 0; i < data.length; i++) {
      if (data[i].key !== 'PAYLOAD' || !data[i].value || !data[i].value.length) continue;
      try {
        var payload = JSON.parse(data[i].value[0]);
        return payload && payload.values !== undefined ? payload.values : payload;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function requestedParams() {
    try {
      return paramsOf(tizen.application.getCurrentApplication().getRequestedAppControl().appControl);
    } catch (e) {
      return null;
    }
  }

  // app.js yerleşimi ölçmeden önce; platform.js ondan önce yüklenir.
  fitWideScreen();

  window.COUCHSUBS_PLATFORM = {
    backKey: 10009,

    // Birim testi için (scripts/tv-tizen.test.js).
    viewportFor: viewportFor,
    samsungIp: samsungIp,
    pictureRect: pictureRect,

    // HDMI penceresi denemelerinin sonucu ve TV'nin bildirdiği ölçüler (#304); app.js bilgi panelinde gösterir.
    pictureDiagnostics: function (callback) {
      pictureListener = callback;
      if (pictureLog) callback(pictureLog);
    },

    // Geniş ekranda (21:9, 32:9) HDMI görüntüsü: 'fit' 16:9 tam yükseklik, 'fill' ekranı doldurur (gerer). Sarı tuş
    // değiştirir (app.js); 16:9 TV'de yoktur.
    pictureModes: function () {
      return viewportFor(window.innerWidth, window.innerHeight) ? pictureMode() : null;
    },
    togglePicture: function (onStatus) {
      var next = pictureMode() === 'fill' ? 'fit' : 'fill';
      try { window.localStorage.setItem(PICTURE_KEY, next); } catch (e) {}
      if (shownPort !== null) {
        var failed = function () { if (onStatus) onStatus('inputError'); };
        try {
          showWindow(function () { if (onStatus) onStatus('playing'); }, failed);
        } catch (e) {
          failed();
        }
      }
      return next;
    },

    // Anynet+ (HDMI-CEC) ya da Otomatik Kaynak Değiştirme TV'yi kendiliğinden HDMI'ya geçirirse uygulama ipucu
    // gösterir (app.js). Menü adları Samsung'unkiler; başka TV'lerde gösterilmez.
    sourceSwitchTip: true,
    // HDMI girişi açılamazsa app.js nedenini ve giriş seçimini gösterir.
    noPictureHelp: true,
    // Arka plana düşen uygulama bağlantıyı kapatır: Samsung önplandaki uygulamayı söylemediği için bilgisayar
    // uygulamayı ancak bağlantı yoksa yeniden açar (TvKeeper).
    closeWhenHidden: true,

    init: function () {
      // Renk ve sayı tuşları istenmezse TV kendisi kullanır.
      for (var i = 0; i < KEYS.length; i++) {
        try { tizen.tvinputdevice.registerKey(KEYS[i]); } catch (e) {}
      }
      // Oyun TV kumandasına dokunmadan oynanır; TV boşta sanıp ekran koruyucuyu açmasın (Samsung AppCommon API).
      // Eski TV'lerde API yoksa sessizce geçilir.
      try {
        webapis.appcommon.setScreenSaver(webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
      } catch (e) {}
    },

    launchParams: requestedParams,

    onRelaunch: function (callback) {
      window.addEventListener('appcontrol', function () {
        var params = requestedParams();
        if (params) callback(params);
      });
    },

    // onStatus: 'loading' | 'ready' | 'playing' | 'inputError' | 'sourceError'
    showHdmi: function (port, host, onStatus) {
      onStatus('loading');
      hdmiSources(function (connected, disconnected) {
        var all = connected.concat(disconnected);
        var source = all.filter(function (s) { return s.number === port; })[0];
        if (!source) return onStatus('sourceError');
        var failed = function () { onStatus('inputError'); };
        try {
          tizen.tvwindow.setSource(source, function () {
            shownPort = port;
            showWindow(function () { onStatus('playing'); }, failed);
            listenResolution();
            watchWindow();
          }, failed);
        } catch (e) {
          failed();
        }
      });
    },

    // TV'nin ağ adresi; bilgisayarı aramak için.
    localAddress: function (callback) {
      function read(property, otherwise) {
        try {
          tizen.systeminfo.getPropertyValue(property, function (info) {
            if (info && info.ipAddress) callback(info.ipAddress); else otherwise();
          }, otherwise);
        } catch (e) {
          otherwise();
        }
      }
      // Tizen'in sistem bilgisi adres vermezse Samsung'un ağ API'si (webapis.network.getIp) sorulur; o da yoksa null.
      // Adres bilinmeyince app.js yaygın ev ağlarını tarar (#484).
      read('ETHERNET_NETWORK', function () {
        read('WIFI_NETWORK', function () { callback(samsungIp()); });
      });
    },

    // Tek bağlı HDMI varsa odur; birden çoksa TV'nin o anki girişi tercih edilir. Tizen girişteki cihazın adını
    // vermez, bu yüzden birden çok bağlı girişte seçim tahmindir: üçüncü değer bağlı HDMI sayısıdır, app.js bu
    // durumda kullanıcıya girişi sorar. Bilgisayar da TV'ye HDMI ile bağlıyken TV'nin o anki girişi bilgisayarınki
    // oluyordu; TV uygulaması Xbox yerine bilgisayarın ekranını gösteriyor, altyazı oyunun üstüne çıkmıyordu (#360).
    findConsolePort: function (callback) {
      hdmiSources(function (connected) {
        var pick = connected.length === 1 ? connected[0] : null;
        if (!pick && connected.length > 1) {
          try {
            var current = tizen.tvwindow.getSource();
            pick = connected.filter(function (s) { return s.number === current.number && current.type === 'HDMI'; })[0] || null;
          } catch (e) {}
        }
        callback(pick ? pick.number : null, pick ? 'HDMI ' + pick.number : null, connected.length);
      });
    },

    // HDMI görüntüsünün çözünürlüğü ve yenileme hızı (TVWindow API: getVideoResolution). İlk değer hemen, sonrakiler
    // değiştikçe callback'e gelir; dinleyici bir kez kurulur. API yoksa ya da hata verirse callback(null): gösterilmez.
    videoResolution: function (callback) {
      resolutionCallback = callback;
      var report = function (info) {
        // İlk değer pencereyi yenilemez; yalnız sonraki değişiklik yeniler.
        if (lastResolution === null && info) lastResolution = resolutionKey(info);
        if (resolutionCallback) resolutionCallback(info || null);
      };
      var fail = function () { report(null); };
      listenResolution();
      try {
        var result = tizen.tvwindow.getVideoResolution(report, fail, 'MAIN');
        // Eski sürümler sonucu doğrudan döndürür.
        if (result && result.width) report(result);
      } catch (e) {
        fail();
      }
    },

    exit: function () {
      try { tizen.application.getCurrentApplication().exit(); } catch (e) {}
    }
  };
})();
