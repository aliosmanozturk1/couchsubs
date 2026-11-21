// SPDX-License-Identifier: AGPL-3.0-only

using System.Globalization;
using System.Text.RegularExpressions;
using CouchSubs.Core;

namespace CouchSubs.Shell;

/// <summary>
/// Xbox oturumunun canlı tutma isteği (30 sn'de bir). Eskiden oynatıcı sayfası tek bir başarısız isteği bağlantı hatası
/// sayıyor ve görüntü sorunsuz akarken oturumu kapatıyordu ("uzaktan oynatma başlıyor ama duruyor"). Artık yalnız
/// <see cref="MaxFailures"/> ardışık hata (yaklaşık 90 sn yanıt yok) oturumu bitirir; arada başarılı bir istek sayacı sıfırlar.
/// </summary>
public sealed class XboxKeepalive
{
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);
    public const int MaxFailures = 3;

    public int Failures { get; private set; }

    public void Succeeded() => Failures = 0;

    /// <returns>Oturum bitirilmeli mi.</returns>
    public bool Failed() => ++Failures >= MaxFailures;
}

/// <summary>
/// Kopmadan sonra yeniden denenir mi, ne kadar sonra (Android/CouchSubsCore XboxSessionMachine.fail ile aynı kurallar).
/// Hata ya da kopmada 5, 15, 45 sn sonra baştan denenir; yayın <see cref="HealthyStreamMs"/> ayakta kaldıysa sayaç
/// sıfırlanır. Xbox'tan hiç görüntü gelmeyen bağlantılar ayrıca sayılır: <see cref="MaxNoPictureAttempts"/> ardışık
/// bağlantıda ilk kare gelmezse yeniden denenmez. Eskiden her biri Xbox'ta "uzaktan oynatma başlatıldı / durduruldu"
/// bildirimiyle dört kez (yaklaşık beş dakika) açılıp kapanıyor, ekranda yalnız "WebRTC bağlantısı kesildi" görünüyordu (#403).
/// </summary>
public sealed class XboxRetryPlan
{
    public static readonly int[] DelaysMs = [5000, 15000, 45000];
    public const long HealthyStreamMs = 60_000;
    public const int MaxNoPictureAttempts = 2;

    private int noPicture;

    /// <summary>Ardışık başarısız deneme (1…3).</summary>
    public int Failures { get; private set; }

    /// <summary>İlk kare geldi: görüntüsüz bağlantı dizisi biter.</summary>
    public void PictureArrived() => noPicture = 0;

    /// <param name="permanent">Konsol yayını reddetti (Failed ya da errorDetails).</param>
    /// <param name="noFirstFrame">Bağlantı kuruldu ama Xbox'tan tek kare gelmeden bitti.</param>
    /// <param name="streamedMs">İlk kareden bu yana geçen süre (görüntü hiç gelmediyse null).</param>
    /// <returns>Bekleme süresi; null ise yeniden denenmez.</returns>
    public int? Failed(bool permanent, bool noFirstFrame, long? streamedMs)
    {
        if (streamedMs >= HealthyStreamMs) Failures = 0;
        Failures++;
        if (noFirstFrame) noPicture++;
        if (permanent || Failures > DelaysMs.Length || noPicture >= MaxNoPictureAttempts) return null;
        return DelaysMs[Failures - 1];
    }
}

/// <summary>Yayının neden durduğu (kullanıcıya gösterilen metni seçer).</summary>
public enum XboxStopKind { Busy, ConsoleUnavailable, NoPicture, Other }

/// <summary>Xbox yayını durunca günlük satırı ve kullanıcıya gösterilen metin. Android'deki XboxSessionMachine.classifyFailure ile aynı kurallar.</summary>
public static partial class XboxStop
{
    /// <summary>Kullanıcı metninde gösterilen ham nedenin en çok uzunluğu (Xbox hizmeti 500 karakterlik JSON dönebilir).</summary>
    public const int ReasonLimit = 120;

    /// <param name="noFirstFrame">Son bağlantı Xbox'tan tek kare gelmeden bitti.</param>
    public static XboxStopKind Classify(string? reason, bool noFirstFrame = false)
    {
        if (noFirstFrame) return XboxStopKind.NoPicture;
        var text = reason ?? "";
        bool Has(string word) => text.Contains(word, StringComparison.OrdinalIgnoreCase);
        if (Has("InUse") || Has("Busy") || Has("AlreadyStreaming")) return XboxStopKind.Busy;
        if (Has("Offline") || Has("NotFound") || Has("Unavailable") || Has("PowerOff") || Has("StreamingDisabled"))
            return XboxStopKind.ConsoleUnavailable;
        return XboxStopKind.Other;
    }

    /// <summary>Denemeler bitince ya da konsol yayını reddedince gösterilen metin.</summary>
    public static string Message(Localizer text, string? reason, bool noFirstFrame = false) => Classify(reason, noFirstFrame) switch
    {
        XboxStopKind.NoPicture => text[NoPictureStopped],
        XboxStopKind.Busy => text["Your Xbox is streaming to another device (the Xbox app, a phone or a PC). Close that session, then start translation again."],
        XboxStopKind.ConsoleUnavailable => text["Can't reach your Xbox. Make sure it's on and remote play is enabled in Settings › Devices & connections › Remote features, then start translation again."],
        _ => text.Format("The Xbox stream stopped (%@). Start translation again; if it keeps stopping, restart the Xbox.", Shorten(reason)),
    };

    /// <summary>Xbox'tan görüntü hiç gelmedi, denemeler bitti (Mac/iPhone XboxText.stopped, Android xbox_stopped_no_picture).</summary>
    public const string NoPictureStopped = "No picture came from the Xbox, so translation stopped. On the Xbox, check that remote play is on in Settings › Devices & connections › Remote features, connect the Xbox with a network cable if you can (or restart it), then start translation again.";

    /// <summary>Bağlantıda görüntü gelmedi, bir kez daha deneniyor (Android xbox_error_no_first_frame).</summary>
    public const string NoPictureRetrying = "No picture came from the Xbox. Trying once more…";

    public static string Shorten(string? reason, int limit = ReasonLimit)
    {
        var line = string.IsNullOrWhiteSpace(reason) ? "?" : Whitespace().Replace(reason.Trim(), " ");
        return line.Length <= limit ? line : line[..(limit - 1)] + "…";
    }

    /// <summary>
    /// Bağlantı bitince yazılan özet (Android'deki <c>summarize</c> ile aynı biçim): neden, okumaya giden kare sayısı ve
    /// ilk kareden sonra kaç saniye sürdüğü. "Görüntü hiç gelmedi" ile "görüntü geldi, sonra kesildi" bu satırla ayrılır.
    /// </summary>
    public static string Summary(string? reason, long frames, TimeSpan? sinceFirstFrame) =>
        string.Create(CultureInfo.InvariantCulture,
            $"bağlantı bitti: {(string.IsNullOrWhiteSpace(reason) ? "durduruldu" : reason)}; kare {frames}, ilk kareden sonra {(sinceFirstFrame is { } lived ? $"{(long)lived.TotalSeconds} sn" : "ilk kare yok")}");

    /// <summary>Xbox köprüsünün (node) hata çıktısındaki uzun belirteç benzeri dizileri gizler; satırı kısaltır.</summary>
    public static string RedactBridgeOutput(string? output, int limit = 300)
    {
        if (string.IsNullOrWhiteSpace(output)) return "";
        var lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var tail = string.Join(" | ", lines.TakeLast(3));
        tail = TokenLike().Replace(tail, "[gizlendi]");
        return tail.Length <= limit ? tail : "…" + tail[^(limit - 1)..];
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"[A-Za-z0-9_\-\.=+/]{40,}")]
    private static partial Regex TokenLike();
}
