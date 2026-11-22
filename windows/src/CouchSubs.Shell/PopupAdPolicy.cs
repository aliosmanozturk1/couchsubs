// SPDX-License-Identifier: AGPL-3.0-only

namespace CouchSubs.Shell;

/// <summary>Açılır reklamın gösterilebileceği an.</summary>
public enum PopupAdMoment { AppLaunch, TranslationStopped }

/// <summary>
/// Açılır reklam kuralları (design/yeni-arayuz/METINLER.md › Reklam kuralları; Mac ile aynı): günde en fazla bir kez;
/// yalnız uygulama açılışında ya da çeviri durunca; çeviri sürerken, kurulumda, görüntü (yayın) penceresi açıkken asla;
/// gösterilecek görsel yoksa hiç.
/// </summary>
public static class PopupAdPolicy
{
    public static bool ShouldShow(PopupAdMoment moment, DateTime now, DateTime? lastShown, bool running, bool setupDone, bool streamWindowOpen, bool hasAd)
    {
        if (!hasAd || running || !setupDone || streamWindowOpen) return false;
        _ = moment;
        return lastShown is not { } last || last.ToLocalTime().Date != now.ToLocalTime().Date;
    }
}
