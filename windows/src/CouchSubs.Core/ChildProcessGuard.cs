// SPDX-License-Identifier: AGPL-3.0-only

using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace CouchSubs.Core;

/// <summary>
/// CouchSubs'ın başlattığı yardımcı süreçler (CTranslate2 çeviri işçisi, Xbox köprüsü, seslendirme motoru, kısa
/// komutlar). Windows'ta hepsi bir iş nesnesine (Job Object, KILL_ON_JOB_CLOSE) bağlanır: CouchSubs kapanınca ya da
/// çökünce onlar da kapanır; torunları (python.exe'nin açtıkları) da iş nesnesindedir. Güncellemeden önce
/// <see cref="StopAll"/> hepsini kapatır ve bekler; açık kalan bir süreç kurulum klasörünü kilitlerse Velopack
/// güncellemeyi uygulayamaz ve eski sürüm yeniden açılır. Başka sistemlerde iş nesnesi yoktur, izleme yine çalışır.
/// </summary>
public static partial class ChildProcessGuard
{
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint KillOnJobClose = 0x2000;
    private static readonly Lazy<nint> Job = new(CreateJob);
    private static readonly object Gate = new();
    private static readonly List<Process> Tracked = [];

    public static void Attach(Process process)
    {
        lock (Gate)
        {
            Tracked.RemoveAll(IsGone);
            Tracked.Add(process);
        }
        if (!OperatingSystem.IsWindows() || Job.Value == 0) return;
        try { AssignProcessToJobObject(Job.Value, process.Handle); }
        catch (Exception error) when (error is InvalidOperationException or Win32Exception) { /* kapandı */ }
    }

    /// <summary>Hâlâ açık izlenen süreç sayısı.</summary>
    internal static int RunningCount
    {
        get { lock (Gate) { Tracked.RemoveAll(IsGone); return Tracked.Count; } }
    }

    /// <summary>
    /// Bütün yardımcı süreçleri (ağaçlarıyla) kapatır ve en çok <paramref name="timeout"/> kadar kapanmalarını bekler.
    /// Kapanmayan süreç sayısını döndürür.
    /// </summary>
    public static int StopAll(TimeSpan timeout)
    {
        Process[] processes;
        lock (Gate)
        {
            processes = [.. Tracked];
            Tracked.Clear();
        }
        if (OperatingSystem.IsWindows() && Job.IsValueCreated && Job.Value != 0) TerminateJobObject(Job.Value, 1);
        foreach (var process in processes)
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (Exception error) when (error is InvalidOperationException or Win32Exception or NotSupportedException) { }
        }
        var clock = Stopwatch.StartNew();
        var running = 0;
        foreach (var process in processes)
        {
            var left = timeout - clock.Elapsed;
            try { if (!process.WaitForExit(left > TimeSpan.Zero ? left : TimeSpan.Zero)) running++; }
            catch (Exception error) when (error is InvalidOperationException or Win32Exception) { }
        }
        return running;
    }

    private static bool IsGone(Process process)
    {
        try { return process.HasExited; }
        catch (Exception error) when (error is InvalidOperationException or Win32Exception or NotSupportedException) { return true; }
    }

    private static nint CreateJob()
    {
        var job = CreateJobObject(0, null);
        if (job == 0) return 0;
        var info = new ExtendedLimitInformation { BasicLimitInformation = new BasicLimitInformation { LimitFlags = KillOnJobClose } };
        var size = Marshal.SizeOf<ExtendedLimitInformation>();
        var pointer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, pointer, false);
            return SetInformationJobObject(job, JobObjectExtendedLimitInformation, pointer, (uint)size) ? job : 0;
        }
        finally
        {
            Marshal.FreeHGlobal(pointer);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public nuint MinimumWorkingSetSize;
        public nuint MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public nuint Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public nuint ProcessMemoryLimit;
        public nuint JobMemoryLimit;
        public nuint PeakProcessMemoryUsed;
        public nuint PeakJobMemoryUsed;
    }

    [LibraryImport("kernel32.dll", EntryPoint = "CreateJobObjectW", StringMarshalling = StringMarshalling.Utf16)]
    private static partial nint CreateJobObject(nint attributes, string? name);

    [LibraryImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool SetInformationJobObject(nint job, int infoClass, nint info, uint length);

    [LibraryImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool AssignProcessToJobObject(nint job, nint process);

    [LibraryImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool TerminateJobObject(nint job, uint exitCode);
}
