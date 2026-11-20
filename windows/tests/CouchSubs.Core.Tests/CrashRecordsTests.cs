// SPDX-License-Identifier: AGPL-3.0-only

using CouchSubs.Core;

namespace CouchSubs.Core.Tests;

/// <summary>Çökme kaydı: özetin okunması, en son üç kaydın tutulması, önceki çökmenin algılanması ve özetin tamamlanması.</summary>
public sealed class CrashRecordsTests : IDisposable
{
    private readonly string folder = Path.Combine(Path.GetTempPath(), "couchsubs-cokme-" + Guid.NewGuid().ToString("N"));

    public CrashRecordsTests() => Directory.CreateDirectory(folder);

    public void Dispose()
    {
        try { Directory.Delete(folder, recursive: true); } catch (IOException) { }
    }

    /// <summary>Yerel işleyicinin yazdığı biçim (windows/native/couchsubs_crash.c).</summary>
    private static string Summary(string time = "2026-11-20 04:46:44", int pid = 4321, bool unhandled = false, string module = "modül yok (adres yüklü hiçbir modüle düşmüyor)") =>
        "CouchSubs çökme kaydı\r\n" +
        "Bu dosya ve yanındaki .dmp yalnız bu bilgisayarda durur; CouchSubs bunları hiçbir yere göndermez.\r\n" +
        CrashRecords.Header("0.1.0-beta.66", "Microsoft Windows 10.0.26100 (X64)", ".NET 10.0.0") +
        $"Zaman: {time}\r\n" +
        $"Süreç: {pid}\r\n" +
        "İş parçacığı: 9876\r\n" +
        "İstisna kodu: 0xC0000005 (erişim ihlali)\r\n" +
        "İstisna adresi: 0x000001F2A3B4C5D6\r\n" +
        $"Modül: {module}\r\n" +
        "Erişim: yürütme 0x000001F2A3B4C5D6\r\n" +
        "Aşama: ilk şans\r\n" +
        "Yazmaçlar:\r\n  RIP=0x000001F2A3B4C5D6 RSP=0x000000A1B2C3D4E0 RBP=0x0000000000000000 RAX=0x0000000000000001\r\n" +
        "Yığındaki modül adresleri:\r\n  user32.dll+0x0001A2B3\r\n  CouchSubs.dll+0x00004455\r\n" +
        "Yüklü modüller:\r\n" +
        "  0x00007FF600000000 0x00030000 C:\\Users\\Furkan\\AppData\\Local\\CouchSubs\\current\\CouchSubs.exe\r\n" +
        "  0x00007FFA10000000 0x001A0000 C:\\Windows\\System32\\user32.dll\r\n" +
        "Döküm: cokme-20261120-044644-4321-0.dmp\r\n" +
        "Döküm durumu: yazıldı\r\n" +
        (unhandled ? "İşlenmedi: evet\r\n" : "");

    private string Write(string name, string text, int dumpBytes = 16)
    {
        var path = Path.Combine(folder, name + ".txt");
        File.WriteAllText(path, text);
        if (dumpBytes > 0) File.WriteAllBytes(Path.ChangeExtension(path, ".dmp"), new byte[dumpBytes]);
        return path;
    }

    [Fact]
    public void SummaryWrittenByTheNativeHandlerIsParsed()
    {
        var record = CrashRecords.Parse(Write("cokme-20261120-044644-4321-0", Summary(unhandled: true)))!;
        Assert.Equal(new DateTime(2026, 11, 20, 4, 46, 44), record.Time);
        Assert.Equal(4321, record.ProcessId);
        Assert.Equal("0xC0000005 (erişim ihlali)", record.Code);
        Assert.Equal("0x000001F2A3B4C5D6", record.Address);
        Assert.StartsWith("modül yok", record.Module);
        Assert.True(record.Unhandled);
        Assert.False(record.Completed);
        Assert.NotNull(record.DumpPath);
        Assert.Equal("cokme-20261120-044644-4321-0", record.Name);
    }

    [Fact]
    public void RecordWithoutADumpAndFilesThatAreNotRecords()
    {
        var record = CrashRecords.Parse(Write("cokme-20261120-044644-4321-0", Summary(), dumpBytes: 0))!;
        Assert.Null(record.DumpPath);
        Assert.False(record.Unhandled);
        Assert.Null(CrashRecords.Parse(Write("cokme-bozuk", "bu bir kayıt değil\r\n", dumpBytes: 0)));
        Assert.Null(CrashRecords.Parse(Path.Combine(folder, "yok.txt")));
    }

    [Fact]
    public void OnlyTheLastThreeRecordsAreKept()
    {
        for (var day = 11; day <= 15; day++) Write($"cokme-202611{day}-120000-10-0", Summary(time: $"2026-11-{day} 12:00:00", pid: 10));
        File.WriteAllBytes(Path.Combine(folder, "cokme-20261101-120000-9-0.dmp"), new byte[8]); // özeti olmayan döküm
        File.WriteAllText(Path.Combine(folder, "oturum.txt"), "10|2026-11-15 11:00:00");

        CrashRecords.Rotate(folder);

        var names = CrashRecords.All(folder).Select(record => record.Name).ToList();
        Assert.Equal(["cokme-20261115-120000-10-0", "cokme-20261114-120000-10-0", "cokme-20261113-120000-10-0"], names);
        Assert.Equal(3, Directory.GetFiles(folder, "*.dmp").Length);
        Assert.True(File.Exists(Path.Combine(folder, "oturum.txt")));
    }

    [Fact]
    public void OversizedDumpIsRemovedButItsSummaryStays()
    {
        var path = Write("cokme-20261120-044644-4321-0", Summary(), dumpBytes: 0);
        using (var dump = new FileStream(Path.ChangeExtension(path, ".dmp"), FileMode.Create))
            dump.SetLength(CrashRecords.MaxDumpBytes + 1);

        CrashRecords.Rotate(folder);

        Assert.True(File.Exists(path));
        Assert.False(File.Exists(Path.ChangeExtension(path, ".dmp")));
    }

    [Fact]
    public void SessionMarkerTellsWhetherThePreviousRunClosedNormally()
    {
        var start = new DateTime(2026, 11, 20, 4, 16, 25);
        Assert.Null(CrashRecords.BeginSession(folder, 100, start, _ => false));
        // Olağan kapanış: işaret silinir, sonraki açılış önceki çalışmayı görmez.
        CrashRecords.EndSession(folder, 100);
        Assert.Null(CrashRecords.BeginSession(folder, 101, start.AddHours(1), _ => false));
        // İşaret silinmeden yeni açılış: önceki çalışma olağan biçimde kapanmadı.
        var previous = CrashRecords.BeginSession(folder, 102, start.AddHours(2), _ => false);
        Assert.Equal(new CrashSession(101, start.AddHours(1)), previous);
    }

    [Fact]
    public void SecondCopyDoesNotTakeOverTheRunningCopysMarker()
    {
        var start = new DateTime(2026, 11, 20, 4, 16, 25);
        CrashRecords.BeginSession(folder, 100, start, _ => false);
        Assert.Null(CrashRecords.BeginSession(folder, 200, start.AddMinutes(1), pid => pid == 100));
        // İkinci kopyanın kapanışı birincinin işaretine dokunmaz.
        CrashRecords.EndSession(folder, 200);
        Assert.Equal(new CrashSession(100, start), CrashRecords.BeginSession(folder, 300, start.AddMinutes(2), _ => false));
    }

    [Fact]
    public void FirstChanceRecordCountsOnlyIfThatRunDidNotCloseNormally()
    {
        Write("cokme-20261120-044644-4321-0", Summary(pid: 4321));
        // Önceki çalışma olağan biçimde kapandı: hata işlenmiş, uygulama sürmüş; çökme değil.
        Assert.Null(CrashRecords.Pending(folder, previous: null));
        // Başka bir çalışma olağan biçimde kapanmadı (ör. elektrik kesildi): bu kayıt onun değil.
        Assert.Null(CrashRecords.Pending(folder, new CrashSession(7, new DateTime(2026, 11, 20, 5, 0, 0))));
        // Kaydı yazan çalışma olağan biçimde kapanmadı: çökme.
        Assert.NotNull(CrashRecords.Pending(folder, new CrashSession(4321, new DateTime(2026, 11, 20, 4, 16, 25))));
    }

    [Fact]
    public void UnhandledRecordAlwaysCountsAndIsShownOnce()
    {
        Write("cokme-20261119-120000-1-0", Summary(time: "2026-11-19 12:00:00", pid: 1, unhandled: true));
        Write("cokme-20261120-044644-4321-0", Summary(unhandled: true));

        var pending = CrashRecords.Pending(folder, previous: null)!;
        Assert.Equal("cokme-20261120-044644-4321-0", pending.Name);
        CrashRecords.MarkShown(folder, pending);

        // En yenisi gösterildi: ne o ne eskileri yeniden bildirilir.
        Assert.Null(CrashRecords.Pending(folder, previous: null));
        // Sonraki çökme yeniden bildirilir.
        Write("cokme-20261121-010000-55-0", Summary(time: "2026-11-21 01:00:00", pid: 55, unhandled: true));
        Assert.Equal("cokme-20261121-010000-55-0", CrashRecords.Pending(folder, previous: null)!.Name);
    }

    [Fact]
    public void CompletedSummaryHasVersionsLogTailAndEventLogWithoutTheUserName()
    {
        var record = CrashRecords.Parse(Write("cokme-20261120-044644-4321-0", Summary(unhandled: true)))!;
        var details = new CrashDetails(
            path => path.EndsWith("user32.dll", StringComparison.OrdinalIgnoreCase) ? "10.0.26100.1" : null,
            [("altyazi.log", ["[2026-11-20 04:46:44.721] #553 \"Oh yeah, hey!\" → paket:gta-6"]), ("remoteplay.log", [])],
            ["[2026-11-20 04:46:45] Application Error:\nFaulting application name: CouchSubs.exe\nFaulting application path: C:\\Users\\Furkan\\AppData\\Local\\CouchSubs\\current\\CouchSubs.exe"],
            @"C:\Users\Furkan", "Furkan");

        var text = CrashRecords.Complete(record, details);

        Assert.Equal(text, File.ReadAllText(record.SummaryPath));
        Assert.Contains("İstisna kodu: 0xC0000005 (erişim ihlali)", text);
        Assert.Contains(@"C:\Windows\System32\user32.dll  [10.0.26100.1]", text);
        Assert.Contains("Son günlük satırları (altyazi.log):\r\n  [2026-11-20 04:46:44.721] #553", text);
        Assert.Contains("Son günlük satırları (remoteplay.log):\r\n  (yok)", text);
        Assert.Contains("Windows olay günlüğü:\r\n  [2026-11-20 04:46:45] Application Error:\r\n  Faulting application name: CouchSubs.exe", text);
        Assert.Contains(@"%USERPROFILE%\AppData\Local\CouchSubs\current\CouchSubs.exe", text);
        Assert.DoesNotContain("Furkan", text);
        Assert.Contains("hiçbir yere göndermez", text);

        // Tamamlanmış özet yeniden işlenmez (ikinci kez sürüm ya da günlük eklenmez).
        var again = CrashRecords.Parse(record.SummaryPath)!;
        Assert.True(again.Completed);
        Assert.Equal(text, CrashRecords.Complete(again, details));
    }

    [Fact]
    public void LogTailStopsAtTheCrashAndKeepsTheLastLines()
    {
        var lines = Enumerable.Range(0, 80).Select(second => $"[2026-11-20 04:{45 + second / 60:00}:{second % 60:00}.000] satır {second}").ToList();
        lines.Insert(11, "   devam satırı (zamansız)");
        lines.Add("[2026-11-20 04:48:20.223] oturum başladı: sonraki çalışma");

        var tail = CrashRecords.LogTail(lines, new DateTime(2026, 11, 20, 4, 46, 19), 50);

        Assert.Equal(50, tail.Count);
        Assert.EndsWith("satır 79", tail[^1]);
        Assert.DoesNotContain(tail, line => line.Contains("sonraki çalışma"));
        // Zamansız satır bir öncekinin devamıdır.
        Assert.Contains("   devam satırı (zamansız)", CrashRecords.LogTail(lines, new DateTime(2026, 11, 20, 4, 45, 15), 50));
        Assert.DoesNotContain("   devam satırı (zamansız)", CrashRecords.LogTail(lines, new DateTime(2026, 11, 20, 4, 45, 5), 50));
    }

    [Fact]
    public void ReadEndSkipsTheCutLineAndNulBytes()
    {
        var path = Path.Combine(folder, "altyazi.log");
        File.WriteAllText(path, string.Concat(Enumerable.Range(0, 100).Select(i => $"[2026-11-20 04:00:{i % 60:00}.000] satır {i}\n")) + "\0\0\0");

        var lines = CrashRecords.ReadEnd(path, maxBytes: 400);

        Assert.All(lines.Where(line => line.Length > 0), line => Assert.StartsWith("[2026-11-20", line));
        Assert.Contains(lines, line => line.EndsWith("satır 99"));
        Assert.Empty(CrashRecords.ReadEnd(Path.Combine(folder, "yok.log")));
    }

    [Fact]
    public void RecordIsBuiltFromWindowsEventLogWhenTheHandlerLeftNone()
    {
        var session = new CrashSession(777, new DateTime(2026, 11, 20, 4, 16, 25));
        string[] entries = ["[2026-11-20 04:46:45] Application Error:\nHatalı uygulama adı: CouchSubs.exe\nÖzel durum kodu: 0xc0000409"];

        var record = CrashRecords.WriteFromEventLog(folder, session, new DateTime(2026, 11, 20, 4, 46, 45), CrashRecords.Header("0.1.0", "Windows", ".NET"), entries)!;

        Assert.Equal("cokme-20261120-044645-777-olay", record.Name);
        Assert.StartsWith("0xC0000409", record.Code);
        Assert.True(record.Unhandled);
        Assert.Null(record.DumpPath);
        Assert.Equal(record.Name, CrashRecords.Pending(folder, session)!.Name);
        Assert.Equal("0xC0000005", CrashRecords.EventLogCode(["Exception code: 0xc0000005\nFault offset: 0x1"]));
        Assert.Null(CrashRecords.EventLogCode(["no code here"]));
    }
}
