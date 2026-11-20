// SPDX-License-Identifier: AGPL-3.0-only

using CouchSubs.Shell;

namespace CouchSubs.Shell.Tests;

/// <summary>Eski "Ekranı çevir" tuşu: önce bir kez bilgi, sonra otomatik ekran yazısını aç/kapa.</summary>
public class ScreenKeyTests
{
    [Fact]
    public void FirstPressOnlyTellsThenTheKeyToggles()
    {
        using var controller = AppControllerTests.Make();
        Assert.True(controller.Settings.AutoScreenText);
        controller.ScreenKeyPressed();
        Assert.True(controller.Settings.AutoScreenText);
        Assert.True(controller.Settings.ScreenKeyNoticeShown);
        controller.ScreenKeyPressed();
        Assert.False(controller.Settings.AutoScreenText);
        controller.ScreenKeyPressed();
        Assert.True(controller.Settings.AutoScreenText);
    }

    [Fact]
    public void WithAutomaticTextOffTheFirstPressTurnsItOn()
    {
        var settings = new MemorySettings();
        settings.Save(new UserSettings { AutoScreenText = false });
        using var controller = AppControllerTests.Make(settings: settings);
        controller.ScreenKeyPressed();
        Assert.True(controller.Settings.AutoScreenText);
    }
}
