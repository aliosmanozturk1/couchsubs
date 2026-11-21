// SPDX-License-Identifier: AGPL-3.0-only

using System.ComponentModel;
using System.Windows;
using System.Windows.Interop;
using CouchSubs.App.Services;
using CouchSubs.App.Views;
using CouchSubs.Shell;
using CouchSubs.Core;
using Microsoft.Win32;

namespace CouchSubs.App;

/// <summary>Uygulamanın tek penceresi: kurulum bitmediyse sihirbaz, bittiyse ana ekran.</summary>
public partial class ShellWindow : Window
{
    private readonly AppController controller;
    private bool showingMain;
    private GlobalHotkeys? hotkeys;

    public ShellWindow(AppController controller)
    {
        this.controller = controller;
        InitializeComponent();
        controller.PropertyChanged += OnChanged;
        controller.TvPairingRequested += OnTvPairing;
        // Bilgisayar uykudan uyanınca bağlantılar hemen yenilenir.
        SystemEvents.PowerModeChanged += OnPowerModeChanged;
        // Kısayollar (varsayılan Num 0, 1, 2, 3, 5, 7, 8, 9 ve Ctrl+Shift+rakam; Ayarlar › Kısayollar'da değişir) yalnız
        // çeviri sürerken tutulur.
        SourceInitialized += (_, _) =>
        {
            hotkeys = new GlobalHotkeys(new WindowInteropHelper(this).Handle, OnHotkey);
            ApplyHotkeys();
        };
        // Bilgisayarda gösterilecek çeviriler küçük, üstte duran bir kutuda çıkar.
        controller.PcResultReady += PcResultWindow.Display;
        // Bilgisayar ekranındaki altyazı penceresi (altyazı yokken gizli). Kurulamazsa uygulama onsuz açılır.
        SubtitleOverlayWindow? overlay = null;
        try
        {
            overlay = SubtitleOverlayWindow.Attach(controller);
        }
        catch (Exception error)
        {
            StartupGuard.Log("Altyazı penceresi kurulamadı", error);
            StartupGuard.Show(Application.Current, StartupGuard.OverlayFailedMessage(error));
        }
        Closed += (_, _) =>
        {
            controller.PcResultReady -= PcResultWindow.Display;
            overlay?.Detach();
            hotkeys?.Dispose();
            SystemEvents.PowerModeChanged -= OnPowerModeChanged;
            controller.TvPairingRequested -= OnTvPairing;
            controller.Dispose();
        };
        ShowScreen(force: true);
    }

    private bool pairingShown;

    /// <summary>
    /// "Bu TV eşleşsin mi?" penceresi. Pencere açıkken gelen yeni istek (TV'de Tamam ile yeniden denendi, TV uygulaması
    /// yeniden açıldı) ikinci pencere açmaz; pencere kapanınca bekleyen istek yeni koduyla gösterilir. Eskiden eski koddan
    /// verilen onay "süresi doldu" deyip bitiyordu, TV'nin bekleyen yeni isteği bilgisayarda hiç görünmüyordu (Mac ile aynı).
    /// </summary>
    private void OnTvPairing(SubtitlePairing.Ticket ticket)
    {
        if (pairingShown) return;
        pairingShown = true;
        try
        {
            var text = Localizer.Current;
            for (var current = ticket; ;)
            {
                var message = text.Format("TV code: %@. You don't type this code anywhere: if your TV shows the same code, approve it here.", current.Code);
                var approved = MessageBox.Show(this, message, text["Pair this TV?"], MessageBoxButton.YesNo,
                    MessageBoxImage.Question, MessageBoxResult.No) == MessageBoxResult.Yes;
                var resolved = controller.ResolveTvPairing(current.Id, approved);
                if (controller.PendingTvPairing is { } next && next.Id != current.Id) { current = next; continue; }
                if (!resolved && approved)
                    MessageBox.Show(this, text["The pairing request expired. Try again on the TV."], "CouchSubs");
                break;
            }
        }
        finally { pairingShown = false; }
    }

    private void OnChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(AppController.Step) or nameof(AppController.DemoMode)) ShowScreen();
        if (e.PropertyName is nameof(AppController.IsRunning) or nameof(AppController.HotkeysPaused) or nameof(AppController.Settings))
            ApplyHotkeys();
    }

    /// <summary>Kısayol tablosu ayarlardan gelir; Ayarlar'da yeni tuş beklenirken kısayollar bırakılır.</summary>
    private void ApplyHotkeys()
    {
        if (hotkeys is null) return;
        hotkeys.Bindings = HotkeyTable.Resolve(controller.Settings.Hotkeys);
        hotkeys.Enabled = controller.IsRunning && !controller.HotkeysPaused;
    }

    private void OnHotkey(HotkeyAction action)
    {
        switch (action)
        {
            case HotkeyAction.ExtraRegion1: _ = controller.TranslateExtraRegionAsync(1); break;
            case HotkeyAction.ExtraRegion2: _ = controller.TranslateExtraRegionAsync(2); break;
            case HotkeyAction.ExtraRegion3: _ = controller.TranslateExtraRegionAsync(3); break;
            case HotkeyAction.PauseSubtitles: controller.ToggleSubtitles(); break;
            case HotkeyAction.Snapshot: controller.RequestSnapshot(); break;
            case HotkeyAction.FreeArea: FreeAreaWindow.Open(controller); break;
            case HotkeyAction.Screen: _ = controller.TranslateScreenAsync(); break;
            case HotkeyAction.ClickThrough: controller.ToggleClickThrough(); break;
        }
    }

    private void ShowScreen(bool force = false)
    {
        // Deneme modunda kurulum bitmemiş olsa da ana ekran gösterilir; çıkınca kalınan adıma dönülür.
        var main = controller.Step == OnboardingStep.Done || controller.DemoMode;
        if (!force && main == showingMain) return;
        showingMain = main;
        Host.Content = main ? new MainView(controller) : new OnboardingView(controller);
    }

    private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.Resume) Dispatcher.Invoke(controller.SystemResumed);
    }
}
