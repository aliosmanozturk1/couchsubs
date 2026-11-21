// SPDX-License-Identifier: AGPL-3.0-only

namespace CouchSubs.Core.LgTv;

/// <summary>
/// Çeviri başlayınca TV uygulamasını kendiliğinden açma neden olmadı (bekçinin son denemesi). Ana ekranda TV uygulaması
/// bağlı değilken tek satırla söylenir. Mac/iPhone (TVOpenProblem) ve Android telefondaki (TvOpenProblem) ile aynı.
/// Eskiden açma sessizce başarısız oluyordu: kullanıcı TV'de CouchSubs'ı kendisinin açması gerektiğini bilmiyordu.
/// </summary>
public enum TvOpenProblem
{
    /// <summary>LG/Samsung: TV yanıt vermedi (kapalı, başka ağda ya da açmayı reddetti).</summary>
    Unreachable,
    /// <summary>LG/Samsung: bu cihazın TV'den aldığı izin (anahtar) yok; TV'ye yeniden bağlanılmalı.</summary>
    NotPaired,
    /// <summary>Android TV: ADB portuna ulaşılamadı (TV kapalı ya da ağ üzerinden hata ayıklama kapalı).</summary>
    DebugOff,
    /// <summary>Android TV: TV bu cihazın hata ayıklama iznini onaylamamış (ADB eşleşmesi yok).</summary>
    DebugNotApproved,
}

/// <summary>TV uygulaması bağlı değilken ana ekranda görünen yönlendirme metinleri (Localizable.xcstrings anahtarları).</summary>
public static class TvOpenText
{
    /// <summary>
    /// Bekçinin bildirdiği sorun, ekranda gösterilecek olana çevrilir: LG/Samsung'da kayıtlı anahtar yokken yanıt vermeyen
    /// TV "izin yok" sayılır (TV'nin izin sorusu yanıtlanmamış).
    /// </summary>
    public static TvOpenProblem? Shown(TvOpenProblem? reported, TvBrand brand, bool hasKey) =>
        reported == TvOpenProblem.Unreachable && brand != TvBrand.AndroidTv && !hasKey ? TvOpenProblem.NotPaired : reported;

    /// <summary>TV markasına göre tek cümle: CouchSubs TV'de nerede bulunur.</summary>
    public static string OpenOnTv(TvBrand brand) => brand == TvBrand.AndroidTv
        ? "If CouchSubs didn't open on the TV by itself, open it on the TV: on Android TV it's under Apps."
        : "If CouchSubs didn't open on the TV by itself, open it on the TV: it's in the TV's app list.";

    /// <summary>Otomatik açmanın neden olmadığı (bilinmiyorsa null).</summary>
    public static string? Reason(TvOpenProblem? problem) => problem switch
    {
        TvOpenProblem.Unreachable => "Couldn't open it automatically: the TV didn't answer. Is the TV on and on the same Wi-Fi as this device?",
        TvOpenProblem.NotPaired => "Couldn't open it automatically: this device has no permission from the TV yet. Connect the TV again and allow it on the TV.",
        TvOpenProblem.DebugOff => "Couldn't open it automatically: the TV can't be reached for debugging. Is the TV on, with network debugging on in Developer options?",
        TvOpenProblem.DebugNotApproved => "Couldn't open it automatically: the TV hasn't allowed debugging from this device. Reinstall the TV app and allow it on the TV.",
        _ => null,
    };

    public const string TryButton = "Try opening automatically";

    /// <summary>Kurulum sihirbazının son adımı (TV seçildiyse).</summary>
    public const string WizardNote = "Every time you start translating, CouchSubs tries to open the TV app by itself. If it doesn't open, open CouchSubs on the TV.";
}

/// <summary>
/// Android TV'de CouchSubs TV'yi bilgisayarın adresiyle açar ve bağlı değilken en çok <c>relaunchInterval</c>'da bir
/// yeniden açar (ADB açıksa; iPhone'daki AndroidTVKeeper ve Android telefondaki keepAndroidTvOpen ile aynı). Eskiden
/// bilgisayar Android TV'ye hiç dokunmuyordu: çeviri başlayınca TV uygulaması kendiliğinden açılmıyordu. ADB kapalıysa ya
/// da TV bu bilgisayarı onaylamadıysa sessizce geçilir; nedeni ana ekranda söylenir.
/// </summary>
/// <param name="open">Uygulamayı açar (TV onay sorarsa beklemeden hata verir); çıktısı günlüğe yazılır.</param>
/// <param name="classify">Açma hatasının ana ekrandaki karşılığı.</param>
public sealed class AndroidTvKeeper(Func<Task<string>> open, Func<bool> appConnected, Func<Exception, TvOpenProblem> classify,
                                    Action<TvOpenProblem?>? onOpenResult = null, Action<string>? log = null,
                                    TimeSpan? relaunchInterval = null, Func<DateTime>? clock = null) : IDisposable
{
    public static readonly TimeSpan DefaultRelaunchInterval = TimeSpan.FromSeconds(30);
    private readonly Func<DateTime> now = clock ?? (() => DateTime.UtcNow);
    private readonly SemaphoreSlim tickLock = new(1, 1);
    private CancellationTokenSource? loop;
    private DateTime? lastLaunch;
    private string? lastResult;

    /// <summary>Bir kontrol: TV uygulaması bağlı değilse ve son açılıştan <c>relaunchInterval</c> geçtiyse açar.</summary>
    public async Task TickAsync()
    {
        if (appConnected()) return;
        await tickLock.WaitAsync();
        try
        {
            var time = now();
            if (lastLaunch is { } last && time - last < (relaunchInterval ?? DefaultRelaunchInterval)) return;
            lastLaunch = time;
            string result;
            try
            {
                result = "açıldı: " + (await open()).Trim();
                onOpenResult?.Invoke(null);
            }
            catch (Exception error)
            {
                result = "açılamadı: " + error.Message;
                onOpenResult?.Invoke(classify(error));
            }
            // Aynı sonuç her denemede yeniden yazılmaz.
            if (result != lastResult) log?.Invoke($"Android TV bilgisayarın adresiyle {result}");
            lastResult = result;
        }
        finally
        {
            tickLock.Release();
        }
    }

    public void Start(TimeSpan interval)
    {
        loop?.Cancel();
        var cancellation = new CancellationTokenSource();
        loop = cancellation;
        _ = Task.Run(async () =>
        {
            while (!cancellation.IsCancellationRequested)
            {
                await TickAsync();
                try { await Task.Delay(interval, cancellation.Token); } catch (OperationCanceledException) { }
            }
        });
    }

    /// <summary>Uykudan dönüşte ya da "Otomatik açmayı dene"de: bir sonraki kontrol beklemeden açar.</summary>
    public void Reconnect() => lastLaunch = null;

    public void Stop()
    {
        loop?.Cancel();
        loop = null;
    }

    public void Dispose() => Stop();
}
