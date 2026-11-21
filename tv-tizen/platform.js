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
    return parts.join(' ') + panelNote;
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

  // '100%'ten başka bir pencere gerekiyor mu: geniş ekran, ekranın fiziksel ölçüsünde kabul edilmiş pencere ya da
  // ölçeklenmiş 16:9 sayfa (4K).
  function customWindow() {
    return isWide() || acceptedRect !== null || scaledScreen();
  }

  // --- 4K Samsung: ölçeklenmiş 16:9 sayfa ---
  // X'te bildirilen 4K/8K Samsung'lar (QE75QN900A, Tizen 6.0): 'scr 3840x2160 dpr 1 page 1920x1080 vv 2 · 100% ok ·
  // area 0,0,1920,1080 · fit 0,0,3840,2160 fail NotSupportedError · now 0,0,1920,1080'. Paketin "width=device-width"
  // görünümü ve base_screen_resolution=fullscreen bu TV'de uygulama yüzeyini 3840x2160 açıyor; platform.js görünümü
  // 1920'ye çekince Chromium sayfayı 2 kat büyütüyor (visualViewport 2). TVWindow ise dikdörtgeni sayfanın CSS
  // pikselinde sınırlıyor (3840x2160 reddediliyor, '100%' = 1920x1080) ama yüzeye büyütmeden çiziyor: PS5 görüntüsü
  // sol üst çeyrekte kalıyor. Ultra geniş G8'de 0.9.32'deki "her yönde %75" küçülme de aynı orandı (1080/1440).
  // Bu çıkarım kanıta dayanıyor ama gerçek TV'de denenmedi; bu yüzden pencere sırayla şu yollarla istenir, her
  // denemenin sonucu Pencere satırına yazılır, Sarı tuş sıradakine geçer ve seçim saklanır:
  //   physical: ekranın fiziksel ölçüsünde px dikdörtgen (0.9.39; bu TV reddediyor, reddedilirse bir daha denenmez)
  //   hold: görünüm kısa süre ekran genişliğine (device-width) açılır, '100%' o ölçüde istenir, görünüm 1920'ye döner
  //         (Samsung pencereyi istendiği andaki ölçüde tutarsa sayfa değişmeden görüntü ekranı doldurur)
  //   zoom: görünüm ekran genişliğinde kalır, sayfa CSS zoom ile 1920'lik ölçüye büyütülür, '100%' istenir
  //   page: eski davranış, 1920'lik görünümde '100%'
  // 8K Samsung (0.9.54, X'te QE75QN900A 7680x4320: "üç yöntemde de görüntü sol üst köşede küçük"). Bu TV 0.9.46'da
  // 'scr 3840x2160 ... vv 2' bildirmişti: uygulama yüzeyi 4K, panel 8K. İki olasılık (ikisi de gerçek TV'de denenmedi):
  //   a) device-width görünümü bu TV'de çalışma anında genişlemiyor (vw 1920 kalıyor): hold ve zoom reddedilip page'e
  //      düşüyor, üç yöntem aynı görünüyor. hold/zoom artık device-width genişlemezse açık 'width=3840' ile de dener
  //      ve ikinci kez bekler.
  //   b) TVWindow pikseli 8K görüntü düzleminde okuyor: 3840'lık '100%' panelin çeyreği. hold8/zoom8 görünümü panelin
  //      16:9 genişliğinde (7680) açar, '100%' o ölçüde istenir.
  // 8K panel Samsung'un belgeli webapis.productinfo.is8KPanelSupported() (Tizen 4.0+) ya da DISPLAY ölçüsünden
  // anlaşılır. Belgede panel çözünürlüğünü veren bir yöntem yok (yalnız evet/hayır); AVPlay.setDisplayRect belgede
  // 1920x1080 tabanlı, TVWindow.show için belgede taban ölçü yazmıyor (yalnız "görüntü alanının sınırı içinde").
  var SCALED_KEY = 'couchsubs.picture4k';
  var SCALED_MODES = ['hold', 'zoom', 'page'];
  var SCALED_MODES_8K = ['hold', 'hold8', 'zoom', 'zoom8', 'page'];
  var EIGHT_K = [7680, 4320];
  // Görünüm değişikliğinden sonra innerWidth'in yenilenmesi için beklenen süre (ms).
  var VIEWPORT_DELAY = 300;
  var zoomFactor = 1;
  // Son başlatılan deneme dizisi: görünüm beklemesi sürerken yenisi başlarsa (sinyal, Sarı) eskisi bırakılır.
  var scaledRun = 0;

  // --- Panelin gerçek ölçüsü (#304) ---
  // Ultra geniş Samsung monitör (0.9.49, Odyssey G8 türü): 'scr 1920x1080 dpr 1 page 1920x1080 vv 1 · 100% ok · area
  // 0,0,1920,1080 · fit'. Uygulamaya ekran 1920x1080 bildiriliyor, sayfa panelin ortasında tam yükseklikte 16:9 kutuda
  // (fotoğrafta bilgi paneli o kutunun sol üstünde), PS5 görüntüsü de kutudan da küçük. Samsung belgesine göre
  // base_screen_resolution ("extensive") yalnız 23TV_PREMIUM2 model grubunda (ve 32:9 için 23_OSCARS_GMT9) geçerli; bu
  // monitörde yüzey 16:9 kalıyor, ekranın bildirdiği ölçüye bakan geniş ekran ve 4K yolları devreye girmiyordu.
  // Panel bu yüzden başka kaynaklardan okunur, en büyüğü alınır:
  //   dsp: Tizen SystemInfo DISPLAY resolutionWidth/Height (piksel) ve physicalWidth/Height (milimetre)
  //   cap: tizen.systeminfo.getCapability screen.width/screen.height
  //   model: webapis.productinfo getRealModel/getModel; Samsung monitörlerinde boy model adında (LS34…: 21:9 3440x1440,
  //          LS49…: 32:9 5120x1440, LS57…: 32:9 7680x2160)
  // Piksel ölçüsü 1920x1080 kalıp yalnız milimetre oranı genişse panel 1440 yükseklikte varsayılır ('~' ile yazılır).
  var panel = null;
  var panelNote = '';
  var panelReading = null;
  var PANEL_WAIT = 1000;
  var MONITOR_PANELS = { '34': [3440, 1440], '49': [5120, 1440], '57': [7680, 2160] };

  function modelPanel(name) {
    var match = /(?:^|[^0-9A-Z])L?[SC](34|49|57)[A-Z]/i.exec(String(name || ''));
    return match ? MONITOR_PANELS[match[1]] : null;
  }

  function productModel() {
    try {
      var info = webapis.productinfo;
      var real = typeof info.getRealModel === 'function' ? info.getRealModel() : '';
      return real || (typeof info.getModel === 'function' ? info.getModel() : '') || '';
    } catch (e) {
      return '';
    }
  }

  function capabilitySize() {
    try {
      var w = Number(tizen.systeminfo.getCapability('http://tizen.org/feature/screen.width'));
      var h = Number(tizen.systeminfo.getCapability('http://tizen.org/feature/screen.height'));
      return w > 0 && h > 0 ? [w, h] : null;
    } catch (e) {
      return null;
    }
  }

  function screenSize() {
    try {
      var w = window.screen && window.screen.width;
      var h = window.screen && window.screen.height;
      return w > 0 && h > 0 ? [w, h] : null;
    } catch (e) {
      return null;
    }
  }

  function sizeText(size) {
    return size ? size[0] + 'x' + size[1] : '-';
  }

  // display: DISPLAY özelliği (yoksa null). Sonuç {w, h, ratio, from} ya da null; panelNote tanı satırına yazılır.
  function computePanel(display) {
    var dsp = display && display.resolutionWidth > 0 && display.resolutionHeight > 0 ?
      [Number(display.resolutionWidth), Number(display.resolutionHeight)] : null;
    var mm = display && display.physicalWidth > 0 && display.physicalHeight > 0 ?
      [Math.round(display.physicalWidth), Math.round(display.physicalHeight)] : null;
    var cap = capabilitySize();
    var model = productModel();
    var candidates = [['scr', screenSize()], ['dsp', dsp], ['cap', cap], ['model', modelPanel(model)],
      ['8k', productSays8K() ? EIGHT_K : null]];
    var best = null;
    var from = '';
    for (var i = 0; i < candidates.length; i++) {
      var size = candidates[i][1];
      if (size && (!best || size[0] * size[1] > best[0] * best[1] * 1.05)) {
        best = size;
        from = candidates[i][0];
      }
    }
    if (mm && best && mm[0] / mm[1] >= WIDE_RATIO && best[0] / best[1] < WIDE_RATIO) {
      // Piksel ölçüsü 16:9 bildiriliyor ama panel geniş: yükseklik 1440 varsayılır.
      var height = Math.max(best[1], 1440);
      best = [Math.round(height * mm[0] / mm[1]), height];
      from = '~mm';
    }
    panelNote = ' · panel ' + (best ? sizeText(best) + ' ' + (best[0] / best[1]).toFixed(2) + ' ' + from : '-') +
      ' (dsp ' + sizeText(dsp) + (mm ? ' ' + mm[0] + 'x' + mm[1] + 'mm' : '') + ' cap ' + sizeText(cap) +
      (model ? ' ' + String(model).slice(0, 20) : '') + ')' + udText();
    return best ? { w: best[0], h: best[1], ratio: best[0] / best[1], from: from } : null;
  }

  // DISPLAY bir kez okunur (zaman aşımında onsuz); callback panel bilindikten sonra çağrılır.
  function readPanel(callback) {
    if (panel !== null) return callback(panel);
    if (panelReading) return panelReading.push(callback);
    panelReading = [callback];
    var settled = false;
    var settle = function (display) {
      if (settled) return;
      settled = true;
      panel = computePanel(display) || false;
      var waiting = panelReading;
      panelReading = null;
      for (var i = 0; i < waiting.length; i++) {
        try { waiting[i](panel); } catch (e) {}
      }
    };
    try {
      tizen.systeminfo.getPropertyValue('DISPLAY', function (info) { settle(info); }, function () { settle(null); });
    } catch (e) {
      settle(null);
    }
    if (!settled) later(function () { settle(null); }, PANEL_WAIT);
  }

  // Panel okunmadıysa ekranın bildirdiği ölçü.
  function knownPanel() {
    if (panel) return panel;
    var size = screenSize();
    return size ? { w: size[0], h: size[1], ratio: size[0] / size[1], from: 'scr' } : null;
  }

  // Sayfa (16:9, 1920x1080) panelde kaç kat büyütülüyor: panelin içine sığan 16:9 kutunun 1920'ye oranı
  // (4K: 2, 3440x1440: 1,33 → 2560x1440 kutu).
  function panelScale() {
    var p = knownPanel();
    return p ? Math.min(p.w / NARROW_WIDTH, p.h / PAGE_HEIGHT) : 1;
  }

  // Sayfa 16:9 (geniş değil) ama panel 1920x1080'den belirgin büyük ya da geniş: 4K Samsung (ekran 3840x2160 bildirir)
  // ve ekranı 1920x1080 bildiren ultra geniş monitör. Pencere yöntemleri sırayla denenir, Sarı sıradakine geçer.
  function scaledScreen() {
    var p = knownPanel();
    if (!p) return false;
    return p.w > NARROW_WIDTH * 1.05 || p.h > PAGE_HEIGHT * 1.05;
  }

  // Sarı tuşla seçilen yöntem; seçilmemişse null (önce physical, reddedilirse hold).
  function scaledMode() {
    try {
      var stored = window.localStorage.getItem(SCALED_KEY);
      return modeList().indexOf(stored) >= 0 ? stored : null;
    } catch (e) {
      return null;
    }
  }

  function setViewport(content) {
    try {
      var meta = document.querySelector('meta[name="viewport"]');
      if (meta) meta.setAttribute('content', content);
    } catch (e) {}
  }

  function setZoom(factor) {
    zoomFactor = factor > 1 ? factor : 1;
    // app.js yerleşim ölçülerini buna böler.
    window.COUCHSUBS_ZOOM = zoomFactor;
    try {
      document.documentElement.style.zoom = zoomFactor > 1 ? String(zoomFactor) : '';
    } catch (e) {}
  }

  // Sayfa 1920'lik görünüme ve zoom'suz hâline döner.
  function pageViewport() {
    if (zoomFactor > 1) setZoom(1);
    setViewport('width=' + NARROW_WIDTH);
  }

  // Samsung ürün bilgisi: panel 8K mı (webapis.productinfo.is8KPanelSupported, Tizen 4.0+; yoksa false).
  function productSays8K() {
    try {
      var info = webapis.productinfo;
      return typeof info.is8KPanelSupported === 'function' && info.is8KPanelSupported() === true;
    } catch (e) {
      return false;
    }
  }

  // 8K panel: ürün bilgisi ya da okunan panel ölçüsü (7680x4320).
  function eightK() {
    var p = knownPanel();
    return productSays8K() || !!(p && p.w >= EIGHT_K[0] * 0.95 && p.h >= EIGHT_K[1] * 0.95);
  }

  // Bu TV'de Sarı'nın sırayla geçtiği yöntemler.
  function modeList() {
    return eightK() ? SCALED_MODES_8K : SCALED_MODES;
  }

  // Webapis ürün bilgisi: panel 4K/8K mı (tanı satırı için; API yoksa boş).
  function udText() {
    try {
      var info = webapis.productinfo;
      if (typeof info.is8KPanelSupported === 'function' && info.is8KPanelSupported()) return ' 8k';
      if (typeof info.isUdPanelSupported === 'function' && info.isUdPanelSupported()) return ' 4k';
    } catch (e) {}
    return '';
  }

  function showFull(ok, fail) {
    try {
      tizen.tvwindow.show(ok, fail, FULL_SCREEN, 'MAIN', 'BEHIND');
    } catch (e) {
      fail(e);
    }
  }

  // hold ve zoom'un görünümü: ekran genişliği (4K: device-width 3840) ya da ekran 1920 bildirip panel büyükse panelin
  // içindeki 16:9 kutunun genişliği (3440x1440: 2560). İkincisi tahmin: sayfa o genişlikte açılınca '100%' penceresi
  // kutunun tamamında çizilir mi, gerçek monitörde denenmedi; Sarı sıradakine geçer, sonuç Pencere satırında.
  function wideViewport() {
    var size = screenSize();
    if (size && size[0] > NARROW_WIDTH * 1.05) return 'width=device-width';
    var scale = panelScale();
    return scale > 1.05 ? 'width=' + Math.round(NARROW_WIDTH * scale) : 'width=device-width';
  }

  // line: tanı satırının başı. Sırayla denenen yöntemler: seçilmişse o (reddedilirse sıradakiler), yoksa physical
  // (bir kez reddedildiyse atlanır) ve hold. Her biri tried listesine yazılır; biri kabul edilince durulur.
  // Bir yöntemin sırayla denenen görünümleri. hold/zoom: wideViewport; o device-width ise ve TV görünümü genişletmezse
  // açık ekran genişliği (8K QN900A olasılık a). hold8/zoom8: 8K panelin 16:9 genişliği (olasılık b).
  function viewportsFor(mode) {
    if (mode === 'hold8' || mode === 'zoom8') {
      var scale = panelScale();
      return ['width=' + Math.round(NARROW_WIDTH * (scale >= 3 ? scale : EIGHT_K[0] / NARROW_WIDTH))];
    }
    var first = wideViewport();
    var list = [first];
    var size = screenSize();
    if (first === 'width=device-width' && size && size[0] > NARROW_WIDTH * 1.05) list.push('width=' + size[0]);
    return list;
  }

  function viewportWidth(content) {
    var match = /^width=(\d+)$/.exec(content);
    return match ? Number(match[1]) : 0;
  }

  function showScaled(line, done) {
    var modes = modeList();
    var chosen = scaledMode();
    var order = chosen ? modes.slice(modes.indexOf(chosen)).concat(modes.slice(0, modes.indexOf(chosen)))
      : (physicalRejected ? [] : ['physical']).concat(modes);
    var tried = [];
    var run = ++scaledRun;
    acceptedRect = null;
    var finish = function () {
      readRect(function (now) {
        // Fiziksel kutu kabul edildiyse TV'nin bildirdiği ölçü onunla karşılaştırılır (16:9 kutu yolundaki gibi): TV
        // ölçüyü başka koordinatta söylüyorsa (4K'da sayfanın 1920x1080'i) 5 sn'lik sınama pencereyi boşuna yeniden
        // istiyordu; her istek HDMI görüntüsünü yeniden kurup parlaklığı bir an oynatıyordu.
        var reported = parseRect(now);
        if (acceptedRect && reported) rectTrusted = sameRect(reported, acceptedRect);
        notePicture(line + ' · ' + tried.join(' ') + (now ? ' · now ' + rectText(now) : '') +
          ' · vw ' + window.innerWidth + (zoomFactor > 1 ? ' zoom ' + zoomFactor : ''));
        done();
      });
    };
    var attempt = function (index) {
      if (index >= order.length) {
        // Hepsi reddedildi: eski '100%' penceresi.
        pageViewport();
        return showFull(finish, finish);
      }
      var mode = order[index];
      var next = function (e) {
        tried.push(mode + ' fail ' + errorText(e));
        attempt(index + 1);
      };
      if (mode === 'physical') {
        pageViewport();
        // Panelin piksel ölçüsünde; geniş panelde PS5'in 16:9 görüntüsü tam yükseklikte ortada.
        var p = knownPanel();
        var whole = [0, 0, Math.floor(p.w), Math.floor(p.h)];
        var rect = pictureRect(whole, 'fit') || wholeRect(whole);
        try {
          tizen.tvwindow.show(function () {
            acceptedRect = parseRect(rect);
            tried.push('physical ' + rectText(rect) + ' ok');
            finish();
          }, function (e) {
            physicalRejected = true;
            tried.push('physical ' + rectText(rect) + ' fail ' + errorText(e));
            attempt(index + 1);
          }, rect, 'MAIN', 'BEHIND');
        } catch (e) {
          physicalRejected = true;
          next(e);
        }
        return;
      }
      if (mode === 'page') {
        pageViewport();
        return showFull(function () { tried.push('page ok'); finish(); }, next);
      }
      // hold ve zoom (8K: hold8, zoom8): görünüm ekran genişliğinde açılır, yenilenmesi beklenir (zoom açıkken
      // innerWidth değişmez). Genişlemezse bir kez daha beklenir, sonra sıradaki görünüm denenir.
      var zooms = mode === 'zoom' || mode === 'zoom8';
      var views = viewportsFor(mode);
      if (zoomFactor > 1 && !zooms) setZoom(1);
      var view = function (v, waited) {
        if (v >= views.length) {
          // Görünüm genişlemedi: bu yöntem bu TV'de anlamsız.
          var narrow = window.innerWidth;
          pageViewport();
          return next({ name: 'vw ' + narrow });
        }
        if (!waited) setViewport(views[v]);
        later(function () {
          if (run !== scaledRun) return done();
          var width = window.innerWidth;
          // 8K yöntemi görünüm panel genişliğine yaklaşmadıysa (TV 3840'ta tuttu) hold/zoom'dan farkı yok.
          var need = mode === 'hold8' || mode === 'zoom8' ? viewportWidth(views[v]) * 0.95 : NARROW_WIDTH * 1.05;
          if (!(width >= need) || !(width > NARROW_WIDTH * 1.05)) {
            if (!waited) return view(v, true);
            return view(v + 1, false);
          }
          if (zooms) setZoom(width / NARROW_WIDTH);
          showFull(function () {
            tried.push(mode + ' vw ' + width + ' ok');
            if (!zooms) pageViewport();
            finish();
          }, function (e) {
            pageViewport();
            next(e);
          });
        }, waited ? VIEWPORT_DELAY * 2 : VIEWPORT_DELAY);
      };
      view(0, false);
    };
    attempt(0);
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

  // Kabul edilen 16:9 kutu hâlâ duruyor mu? Samsung '100%'e döndürdüyse yeniden istenir. Her yeniden istek HDMI
  // görüntüsünü yeniden çizdirir (bazı TV'lerde parlaklık bir an oynar): dakikada RESET_LIMIT kezden fazla bozuluyorsa
  // sınama bırakılır, sinyal değişince ya da giriş yeniden açılınca yeniden başlar.
  var RESET_LIMIT = 3;
  var resetTimes = [];
  var watchOff = false;

  function checkWindow() {
    if (shownPort === null || !acceptedRect || !rectTrusted || watchOff) return;
    readRect(function (now) {
      var rect = parseRect(now);
      if (!rect || !acceptedRect || sameRect(rect, acceptedRect)) return;
      var time = new Date().getTime();
      while (resetTimes.length && time - resetTimes[0] >= 60000) resetTimes.shift();
      if (resetTimes.length >= RESET_LIMIT) {
        watchOff = true;
        notePicture(pictureLog + ' · watch off');
        return;
      }
      resetTimes.push(time);
      rewindow('reset ' + rectText(now));
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
    resetTimes = [];
    watchOff = false;
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
        if (!isWide() && scaledScreen()) return showScaled(line.slice(0, line.length - mode.length) + (scaledMode() || 'auto'), done);
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
  // Panel ölçüsü erkenden okunur: app.js tuş listesinde Sarı'yı ona göre gösterir.
  readPanel(function () {});

  window.COUCHSUBS_PLATFORM = {
    backKey: 10009,

    // Birim testi için (scripts/tv-tizen.test.js).
    viewportFor: viewportFor,
    samsungIp: samsungIp,
    modelPanel: modelPanel,
    pictureRect: pictureRect,

    // HDMI penceresi denemelerinin sonucu ve TV'nin bildirdiği ölçüler (#304); app.js bilgi panelinde gösterir.
    pictureDiagnostics: function (callback) {
      pictureListener = callback;
      if (pictureLog) callback(pictureLog);
    },

    // Geniş ekranda (21:9, 32:9) HDMI görüntüsü: 'fit' 16:9 tam yükseklik, 'fill' ekranı doldurur (gerer). Sarı tuş
    // değiştirir (app.js); 16:9 TV'de yoktur.
    // 4K Samsung'da (ölçeklenmiş 16:9 sayfa) Sarı tuş sıradaki pencere yöntemine geçer: 'hold' | 'zoom' | 'page'.
    pictureModes: function () {
      if (!isWide() && scaledScreen()) return scaledMode() || 'hold';
      return viewportFor(window.innerWidth, window.innerHeight) ? pictureMode() : null;
    },
    // Sayfanın CSS zoom oranı (zoom yönteminde ekran genişliği / 1920, yoksa 1); app.js aynı değeri
    // window.COUCHSUBS_ZOOM'dan okur.
    // Sarı'nın sırayla geçtiği pencere yöntemleri (4K: 3, 8K: 5); app.js "yöntem 2/5" yazar. Geniş ekranda null.
    pictureModeList: function () {
      return !isWide() && scaledScreen() ? modeList().slice() : null;
    },
    pageZoom: function () {
      return zoomFactor;
    },
    togglePicture: function (onStatus) {
      var next;
      if (!isWide() && scaledScreen()) {
        var modes = modeList();
        next = modes[(modes.indexOf(scaledMode() || 'hold') + 1) % modes.length];
        try { window.localStorage.setItem(SCALED_KEY, next); } catch (e) {}
      } else {
        next = pictureMode() === 'fill' ? 'fit' : 'fill';
        try { window.localStorage.setItem(PICTURE_KEY, next); } catch (e) {}
      }
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
        // Pencere yöntemi panelin gerçek ölçüsüne göre seçilir; okunmadıysa önce okunur.
        readPanel(function () {
          try {
            tizen.tvwindow.setSource(source, function () {
              shownPort = port;
              resetTimes = [];
              watchOff = false;
              showWindow(function () { onStatus('playing'); }, failed);
              listenResolution();
              watchWindow();
            }, failed);
          } catch (e) {
            failed();
          }
        });
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
