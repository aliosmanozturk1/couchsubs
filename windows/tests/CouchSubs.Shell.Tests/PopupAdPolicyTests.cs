// SPDX-License-Identifier: AGPL-3.0-only

namespace CouchSubs.Shell.Tests;

/// <summary>Açılır reklam: günde bir, yalnız açılışta ya da çeviri durunca; çeviride, kurulumda, yayın penceresinde asla.</summary>
public class PopupAdPolicyTests
{
    private static readonly DateTime Now = new(2026, 11, 22, 15, 0, 0, DateTimeKind.Local);

    [Fact]
    public void ShownOncePerDay()
    {
        Assert.True(PopupAdPolicy.ShouldShow(PopupAdMoment.AppLaunch, Now, null, false, true, false, true));
        Assert.False(PopupAdPolicy.ShouldShow(PopupAdMoment.TranslationStopped, Now, Now.AddHours(-2), false, true, false, true));
        Assert.True(PopupAdPolicy.ShouldShow(PopupAdMoment.AppLaunch, Now, Now.AddDays(-1), false, true, false, true));
    }

    [Fact]
    public void NeverWhileTranslatingInSetupOrStreamWindowOrWithoutAd()
    {
        Assert.False(PopupAdPolicy.ShouldShow(PopupAdMoment.AppLaunch, Now, null, running: true, true, false, true));
        Assert.False(PopupAdPolicy.ShouldShow(PopupAdMoment.AppLaunch, Now, null, false, setupDone: false, false, true));
        Assert.False(PopupAdPolicy.ShouldShow(PopupAdMoment.AppLaunch, Now, null, false, true, streamWindowOpen: true, true));
        Assert.False(PopupAdPolicy.ShouldShow(PopupAdMoment.AppLaunch, Now, null, false, true, false, hasAd: false));
    }
}
