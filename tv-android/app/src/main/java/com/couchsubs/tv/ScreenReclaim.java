// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.tv;

/**
 * HDMI sinyali değişirken TV'nin kendi giriş ekranı CouchSubs'ı önden itince ekranın geri alınıp alınmayacağı (#794).
 *
 * GitHub #794 (birden çok Android TV): "uygulamayı açtık; PlayStation açılınca, TV'de HDR devreye girince ya da kenarda bir
 * bildirim gelince normal HDMI girişine geçiyor, uygulamaya yeniden girmek gerekiyor". PS5 açılınca ya da görüntü biçimi
 * (HDR, çözünürlük) değişince TV sistemi kendi HDMI oynatıcısını öne çekiyor (tahmin: HDMI-CEC "etkin kaynak" ya da
 * üreticinin giriş uygulaması; TV'den TV'ye değişiyor). Bu, kullanıcının çıkması değildir: görüntü uygulamada zaten
 * gelmişse ve ekran sinyal olayından hemen sonra önden çekildiyse CouchSubs kısa süre sonra kendini yeniden öne getirir.
 *
 * Kullanıcının kendisi çıkmasıyla karışmasın diye:
 * - yalnız TvView'in sinyal olayından (görüntü geldi/gitti, bağlantı koptu) en çok {@link #SIGNAL_WINDOW_MS} sonra;
 * - CouchSubs'ın kendi açtığı girişin ilk {@link #AFTER_TUNE_MS}'sindeki olaylar sayılmaz (açılışta Ana tuşu);
 * - dakikada en çok {@link #MAX_PER_MINUTE} kez (TV ile sonsuz itişme olmasın).
 *
 * Android'e bağlı değildir; zaman dışarıdan verilir (bkz. ScreenReclaimTest).
 */
final class ScreenReclaim {
    static final long SIGNAL_WINDOW_MS = 3_000;
    static final long AFTER_TUNE_MS = 3_000;
    static final int MAX_PER_MINUTE = 3;
    /** Ekran önden çekildikten sonra geri alınmadan önce beklenen süre (TV'nin ekranı açılmasını bitirsin). */
    static final long DELAY_MS = 800;

    private long lastSignal = -1;
    private final long[] reclaims = new long[MAX_PER_MINUTE];
    private int next;

    ScreenReclaim() {
        java.util.Arrays.fill(reclaims, -1);
    }

    /** TvView bir sinyal olayı bildirdi; tunedAt: CouchSubs girişi en son ne zaman açtı (-1: açmadı). */
    void signal(long now, long tunedAt) {
        if (tunedAt >= 0 && now - tunedAt < AFTER_TUNE_MS) return;
        lastSignal = now;
    }

    /** Ekran önden çekilince ne yapılacağı. */
    enum Action {
        /** Devralma değil (kullanıcı çıktı ya da sinyal olayı yok): eski davranış. */
        NONE,
        /** CouchSubs ekranı geri öne getirilir. */
        RECLAIM,
        /**
         * Devralma ama dakikadaki geri alma hakkı doldu (TV sürekli geri itiyor): izin varsa katmana geçilir. Yoksa
         * CouchSubs arkada kalır; altyazı bağlantısı açık olduğundan bilgisayar/telefon TV'yi "bağlı" görür ama
         * yazı görünmeyen ekrana çizilir (bkz. MainActivity.onStop).
         */
        GIVE_UP
    }

    /**
     * Ekran önden çekildi (onPause anı, pausedAt): ne yapılsın. played: görüntü bu açılışta uygulamada geldi mi.
     * RECLAIM dönerse geri alma sayılır.
     */
    Action onTakenAway(long pausedAt, boolean played) {
        if (!played || lastSignal < 0 || pausedAt < lastSignal || pausedAt - lastSignal > SIGNAL_WINDOW_MS) return Action.NONE;
        // Aynı sinyal olayı ikinci kez sayılmaz.
        lastSignal = -1;
        long oldest = reclaims[next];
        if (oldest >= 0 && pausedAt - oldest < 60_000) return Action.GIVE_UP;
        reclaims[next] = pausedAt;
        next = (next + 1) % MAX_PER_MINUTE;
        return Action.RECLAIM;
    }

    boolean shouldReclaim(long pausedAt, boolean played) {
        return onTakenAway(pausedAt, played) == Action.RECLAIM;
    }
}
