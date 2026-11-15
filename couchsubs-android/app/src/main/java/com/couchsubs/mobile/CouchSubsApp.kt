// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile

import android.app.Application
import android.content.Context
import android.util.Log
import com.couchsubs.mobile.account.Backend
import com.couchsubs.mobile.account.MeasurementPolicy
import com.couchsubs.mobile.account.Meta
import com.couchsubs.mobile.core.GamePackLibrary
import com.couchsubs.mobile.packs.HttpPackServer
import com.couchsubs.mobile.packs.PackStore
import com.couchsubs.mobile.settings.AppSettings
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.io.File

/** Uygulama açılınca: Firebase ve Meta (varsa) ve paket yenilemesi. Hesap ve reklam yok; uygulama ve paketler ücretsiz. */
class CouchSubsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Services.init(this)
    }
}

/** Uygulama genelindeki hizmetler. */
object Services {
    private const val TAG = "CouchSubsServices"
    lateinit var settings: AppSettings
        private set
    lateinit var packStore: PackStore
        private set
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    /** Paket listesi değişince (indirme) artar; ekranlar yeniden okur. */
    val packsVersion = MutableStateFlow(0)

    /** Bu ve önceki oturumlarda çevrilen son 200 altyazı (history.json; "Geçmiş" ekranı, iPhone ile aynı). */
    var history = com.couchsubs.mobile.core.SubtitleHistory()
        private set
    /** Geçmiş değişince artar; ekran yeniden okur. */
    val historyVersion = MutableStateFlow(0)
    private var historyFile: File? = null
    private val historyWriter = java.util.concurrent.Executors.newSingleThreadExecutor { Thread(it, "CouchSubs history").apply { isDaemon = true } }

    fun addToHistory(source: String, translation: String, origin: String) {
        history.add(source, translation, origin)
        historyChanged()
    }

    fun clearHistory() {
        history.clear()
        historyChanged()
    }

    private fun historyChanged() {
        historyVersion.value++
        val file = historyFile ?: return
        historyWriter.execute { runCatching { history.save(file) } }
    }

    fun init(app: Application) {
        historyFile = File(app.filesDir, "history.json").also { file ->
            historyWriter.execute {
                history = com.couchsubs.mobile.core.SubtitleHistory.load(file)
                historyVersion.value++
            }
        }
        settings = AppSettings(app)
        Backend.init(app)
        Meta.init(app)
        applyMeasurement()
        packStore = PackStore(File(app.filesDir, "packs-remote"), HttpPackServer(BuildConfig.PACKS_URL.trimEnd('/')))
        // Açılışta (haftada bir) yeni ve güncellenen paketlere bakılır.
        refreshPacks(force = false)
        reportPreviousExits(app)
    }

    /**
     * Önceki kapanış yerel çökme, bellek yetmemesi ya da ANR idiyse raporlanır (Crashlytics bunları kendisi görmez;
     * bkz. ExitReport). Süreç yeni açıldığı için çeviri hizmeti çalışmıyor: "translating" kaldıysa süreç çeviri
     * sürerken ölmüştür.
     */
    private fun reportPreviousExits(app: Application) {
        val duringTranslation = settings.translating
        settings.translating = false
        scope.launch(Dispatchers.IO) {
            settings.lastExitReportAt = Backend.reportPreviousExits(app, settings.lastExitReportAt, duringTranslation)
        }
    }

    /** Profil › Kullanım verisi değişince ya da karşılama geçilince (iPhone'daki gibi). */
    fun applyMeasurement() {
        val flags = MeasurementPolicy.flags(settings.usageData, settings.welcomeSeen)
        Backend.apply(flags)
        Meta.apply(flags)
    }

    fun setUsageData(enabled: Boolean) {
        settings.usageData = enabled
        applyMeasurement()
    }

    fun refreshPacks(force: Boolean) {
        if (BuildConfig.PACKS_URL.isBlank()) return
        scope.launch(Dispatchers.IO) {
            try {
                val result = packStore.refresh(force)
                if (!result.skipped) packsVersion.value++
            } catch (error: Exception) {
                Log.w(TAG, "paketler", error)
            }
        }
    }

    /** Paket ekranında gösterilen oyun; [installed] false ise sunucuda var ama henüz inmedi. */
    data class CatalogEntry(val id: String, val title: String, val entries: Int, val installed: Boolean)

    /** Bu telefondaki paketler ve sunucuda olup henüz inmemiş olanlar (bloklar). */
    fun catalog(context: Context): List<CatalogEntry> {
        val local = packLibrary(context).infos
        val remote = if (BuildConfig.PACKS_URL.isBlank()) emptyList()
        else runCatching { HttpPackServer(BuildConfig.PACKS_URL.trimEnd('/')).list() }.getOrDefault(emptyList())
        return local.map { CatalogEntry(it.id, it.title, it.entries, true) } +
            remote.filter { pack -> local.none { it.id == pack.id } }.map { CatalogEntry(it.id, it.title, it.entries, false) }
    }

    /**
     * Okuma hattının paket kitaplığı: uygulamayla gelen paketler, üstüne sunucudan inmiş yeni ya da güncel sürümler
     * (aynı kimlikte indirilen kazanır).
     */
    fun packLibrary(context: Context): GamePackLibrary {
        val bundled: () -> List<Pair<String, () -> ByteArray>> = {
            (context.assets.list("packs") ?: emptyArray()).map { name -> name to { context.assets.open("packs/$name").use { s -> s.readBytes() } } }
        }
        return GamePackLibrary(bundled, packStore.files().firstOrNull()?.parentFile).also { it.setDisabled(settings.disabledPacks) }
    }
}
