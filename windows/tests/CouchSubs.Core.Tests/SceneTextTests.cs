// SPDX-License-Identifier: AGPL-3.0-only

using System.Text.Json;
using CouchSubs.Core;
using Xunit;

namespace CouchSubs.Core.Tests;

/// <summary>
/// Altyazı alanına düşen tabela ve tişört yazısı çevrilmez (X bildirimleri, beta.73, GTA 6). Örnekler ortak deneme
/// dosyasından (core/Tests/CouchSubsCoreTests/Fixtures/scene-text.json; Mac SceneTextTests.swift ve Android
/// SceneTextTest.kt aynı dosyayı okur).
/// </summary>
public class SceneTextTests
{
    private sealed record Case(string Name, Reading Reading, string Subtitle);

    private static TextBox Box(JsonElement element)
    {
        var b = element.EnumerateArray().Select(v => v.GetDouble()).ToArray();
        return new TextBox(b[0], b[1], b[2], b[3]);
    }

    private static (TextBox Area, List<Case> Cases) Vectors()
    {
        using var fixture = JsonDocument.Parse(File.ReadAllText(PackFixtures.Path("scene-text.json")));
        var root = fixture.RootElement;
        var cases = root.GetProperty("cases").EnumerateArray().Select(vector => new Case(
            vector.GetProperty("name").GetString()!,
            new Reading(vector.GetProperty("lines").EnumerateArray().Select(line => new TextLine(
                line.GetProperty("text").GetString()!,
                Box(line.GetProperty("box")),
                line.TryGetProperty("confidence", out var confidence) ? confidence.GetDouble() : null,
                line.TryGetProperty("words", out var words)
                    ? [.. words.EnumerateArray().Select(word => new TextWord(word.GetProperty("text").GetString()!, Box(word.GetProperty("box"))))]
                    : null)).ToList()),
            vector.GetProperty("subtitle").GetString()!)).ToList();
        return (Box(root.GetProperty("area")), cases);
    }

    [Fact]
    public void SharedVectors()
    {
        var (area, cases) = Vectors();
        foreach (var vector in cases)
            Assert.True(vector.Subtitle == vector.Reading.SubtitleBlock(area).Text,
                $"{vector.Name}: {vector.Reading.SubtitleBlock(area).Text}");
    }
}
