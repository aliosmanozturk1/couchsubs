// SPDX-License-Identifier: AGPL-3.0-only

using System.Net;
using System.Net.Sockets;
using System.Text;
using CouchSubs.Core.LgTv;

namespace CouchSubs.Core.Tests;

public class LgDiscoveryTests
{
    private const string TvResponse =
        "HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.153:1990/abc/description.xml\r\nST: urn:lge-com:service:webos-second-screen:1\r\n\r\n";

    private static UdpReceiveResult Reply(string text) =>
        new(Encoding.ASCII.GetBytes(text), new IPEndPoint(IPAddress.Parse("192.168.1.153"), 1900));

    /// <summary>Sırayla verilen yanıtları ya da hataları döner; bitince süre dolmuş gibi iptal eder.</summary>
    private static Func<CancellationToken, ValueTask<UdpReceiveResult>> Script(params object[] steps)
    {
        var queue = new Queue<object>(steps);
        return token =>
        {
            if (queue.Count == 0) throw new OperationCanceledException(token);
            return queue.Dequeue() switch
            {
                Exception error => throw error,
                string text => ValueTask.FromResult(Reply(text)),
                _ => throw new InvalidOperationException(),
            };
        };
    }

    // Windows'ta portu kapalı bir adresten gelen ICMP yanıtı sonraki okumada 10054 olarak gelir; uygulama çöküyordu (#556).
    [Fact]
    public async Task ConnectionResetDuringSearchIsSkippedAndSearchContinues()
    {
        var hosts = await LgDiscovery.ReceiveHosts(
            Script(new SocketException((int)SocketError.ConnectionReset), new SocketException((int)SocketError.ConnectionReset), TvResponse),
            LgDiscovery.SearchTarget, CancellationToken.None);
        Assert.Equal(["192.168.1.153"], hosts);
    }

    [Fact]
    public async Task OtherSocketErrorEndsSearchWithHostsFoundSoFar()
    {
        var hosts = await LgDiscovery.ReceiveHosts(
            Script(TvResponse, new SocketException((int)SocketError.NetworkDown), TvResponse),
            LgDiscovery.SearchTarget, CancellationToken.None);
        Assert.Equal(["192.168.1.153"], hosts);
    }

    [Fact]
    public async Task DeadlineEndsSearchWithoutError()
    {
        var hosts = await LgDiscovery.ReceiveHosts(Script(), LgDiscovery.SearchTarget, CancellationToken.None);
        Assert.Empty(hosts);
    }
}
