// SPDX-License-Identifier: AGPL-3.0-only

using CouchSubs.Core;

namespace CouchSubs.Shell.Tests;

/// <summary>Xbox yayınının canlı tutulması, durunca gösterilen metin ve günlük özeti.</summary>
public class XboxSessionHealthTests
{
    [Fact]
    public void SingleKeepaliveFailureDoesNotEndTheStream()
    {
        // Eskiden oynatıcıdaki tek başarısız canlı tutma isteği görüntü akarken oturumu kapatıyordu.
        var keepalive = new XboxKeepalive();
        Assert.False(keepalive.Failed());
        Assert.False(keepalive.Failed());
        keepalive.Succeeded();
        Assert.Equal(0, keepalive.Failures);
        Assert.False(keepalive.Failed());
    }

    [Fact]
    public void ThreeConsecutiveKeepaliveFailuresEndTheStream()
    {
        var keepalive = new XboxKeepalive();
        Assert.False(keepalive.Failed());
        Assert.False(keepalive.Failed());
        Assert.True(keepalive.Failed());
        Assert.Equal(XboxKeepalive.MaxFailures, keepalive.Failures);
    }

    [Theory]
    [InlineData("{\"code\":\"ServerInUse\"}", XboxStopKind.Busy)]
    [InlineData("AlreadyStreaming", XboxStopKind.Busy)]
    [InlineData("{\"code\":\"ConsoleOffline\"}", XboxStopKind.ConsoleUnavailable)]
    [InlineData("StreamingDisabled", XboxStopKind.ConsoleUnavailable)]
    [InlineData("Xbox WebRTC failed", XboxStopKind.Other)]
    [InlineData(null, XboxStopKind.Other)]
    public void StopIsClassifiedFromTheReason(string? reason, XboxStopKind kind) => Assert.Equal(kind, XboxStop.Classify(reason));

    [Fact]
    public void BusyMessageTellsTheUserToCloseTheOtherSession()
    {
        var text = XboxStop.Message(Localizer.ForLanguage("tr"), "{\"code\":\"ServerInUse\"}");
        Assert.Contains("başka bir cihaza yayın yapıyor", text);
        Assert.DoesNotContain("ServerInUse", text);
    }

    [Fact]
    public void OtherMessageShowsAShortReason()
    {
        var reason = "Xbox service HTTP 500: " + new string('x', 600);
        var text = XboxStop.Message(Localizer.ForLanguage("en"), reason);
        Assert.StartsWith("The Xbox stream stopped (Xbox service HTTP 500: ", text);
        Assert.True(text.Length < 250, text);
        Assert.Contains("…)", text);
    }

    [Fact]
    public void NoPictureMessageNamesTheXboxSettingAndCable()
    {
        // #403 / X: Xbox görüntü göndermeyince ekranda yalnız "WebRTC bağlantısı kesildi" görünüyordu.
        var tr = XboxStop.Message(Localizer.ForLanguage("tr"), "Xbox WebRTC bağlantısı kesildi", noFirstFrame: true);
        Assert.Contains("görüntü gelmedi", tr);
        Assert.Contains("Ayarlar › Cihazlar ve bağlantılar › Uzak özellikler", tr);
        Assert.Contains("kablo", tr);
        Assert.DoesNotContain("WebRTC", tr);
        var en = XboxStop.Message(Localizer.ForLanguage("en"), null, noFirstFrame: true);
        Assert.Contains("Settings › Devices & connections › Remote features", en);
        Assert.Equal("Xbox'tan görüntü gelmedi. Bir kez daha deneniyor…", Localizer.ForLanguage("tr")[XboxStop.NoPictureRetrying]);
        Assert.Equal(XboxStopKind.NoPicture, XboxStop.Classify("ServerInUse", noFirstFrame: true));
    }

    [Fact]
    public void ConnectionsWithoutPictureStopAfterTwoAttempts()
    {
        // Eskiden görüntüsüz her bağlantı ~60 sn sürüp dört kez açılıp kapanıyordu (Xbox'ta "uzaktan oynatma başlatıldı / durduruldu").
        var plan = new XboxRetryPlan();
        Assert.Equal(5000, plan.Failed(permanent: false, noFirstFrame: true, streamedMs: null));
        Assert.Null(plan.Failed(permanent: false, noFirstFrame: true, streamedMs: null));
    }

    [Fact]
    public void PictureResetsTheNoPictureStreakButNotOtherFailures()
    {
        var plan = new XboxRetryPlan();
        Assert.Equal(5000, plan.Failed(false, noFirstFrame: true, streamedMs: null));
        plan.PictureArrived();
        // Görüntü geldi, 10 sn sonra kesildi: sıradan kopma, ikinci deneme.
        Assert.Equal(15000, plan.Failed(false, noFirstFrame: false, streamedMs: 10_000));
        Assert.Equal(45000, plan.Failed(false, noFirstFrame: true, streamedMs: null));
        Assert.Null(plan.Failed(false, noFirstFrame: false, streamedMs: null));
    }

    [Fact]
    public void OtherFailuresKeepThreeRetriesAndHealthyStreamResets()
    {
        var plan = new XboxRetryPlan();
        Assert.Equal(5000, plan.Failed(false, false, null));
        Assert.Equal(15000, plan.Failed(false, false, null));
        // Bir dakikadan uzun süren yayın: yeni dizi.
        Assert.Equal(5000, plan.Failed(false, false, XboxRetryPlan.HealthyStreamMs));
        Assert.Equal(15000, plan.Failed(false, false, null));
        Assert.Equal(45000, plan.Failed(false, false, null));
        Assert.Null(plan.Failed(false, false, null));
        Assert.Null(new XboxRetryPlan().Failed(permanent: true, noFirstFrame: false, streamedMs: null));
    }

    [Fact]
    public void SummarySeparatesNoPictureFromPictureThenDrop()
    {
        Assert.Equal("bağlantı bitti: WebRTC failed; kare 0, ilk kareden sonra ilk kare yok", XboxStop.Summary("WebRTC failed", 0, null));
        Assert.Equal("bağlantı bitti: durduruldu; kare 1200, ilk kareden sonra 95 sn", XboxStop.Summary(null, 1200, TimeSpan.FromSeconds(95.4)));
    }

    [Fact]
    public void BridgeOutputHidesTokenLikeValues()
    {
        var token = new string('A', 30) + "." + new string('b', 30);
        var output = "line one\nError: invalid_grant " + token + "\n    at handle (bridge.cjs:12)";
        var line = XboxStop.RedactBridgeOutput(output);
        Assert.DoesNotContain(token, line);
        Assert.Contains("[gizlendi]", line);
        Assert.Contains("invalid_grant", line);
        Assert.Equal("", XboxStop.RedactBridgeOutput("  "));
    }
}
