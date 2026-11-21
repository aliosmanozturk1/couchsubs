// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.tv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** #794: HDR devreye girince, PS5 açılınca ya da bildirim gelince TV kendi HDMI ekranına geçiyordu. */
public class ScreenReclaimTest {
    @Test
    public void takeoverRightAfterASignalChangeIsReclaimed() {
        ScreenReclaim reclaim = new ScreenReclaim();
        reclaim.signal(60_000, 0);
        assertTrue(reclaim.shouldReclaim(61_500, true));
        // Aynı olay ikinci kez geri aldırmaz.
        assertFalse(reclaim.shouldReclaim(62_000, true));
    }

    @Test
    public void userLeavingWithoutASignalChangeIsNotReclaimed() {
        ScreenReclaim reclaim = new ScreenReclaim();
        assertFalse(reclaim.shouldReclaim(60_000, true));
        reclaim.signal(60_000, 0);
        assertFalse(reclaim.shouldReclaim(60_000 + ScreenReclaim.SIGNAL_WINDOW_MS + 1, true));
    }

    @Test
    public void eventsOfOurOwnTuningAndScreensWithoutPictureAreNotReclaimed() {
        ScreenReclaim reclaim = new ScreenReclaim();
        reclaim.signal(10_500, 10_000);
        assertFalse(reclaim.shouldReclaim(11_000, true));
        reclaim.signal(60_000, 10_000);
        assertFalse(reclaim.shouldReclaim(60_500, false));
    }

    @Test
    public void atMostThreeTimesAMinute() {
        ScreenReclaim reclaim = new ScreenReclaim();
        int done = 0;
        for (long t = 100_000; t < 160_000; t += 5_000) {
            reclaim.signal(t, 0);
            if (reclaim.shouldReclaim(t + 500, true)) done++;
        }
        assertTrue(done == ScreenReclaim.MAX_PER_MINUTE);
        // Hak dolunca devralma yine tanınır (katmana geçilsin); olay yoksa hiçbir şey yapılmaz.
        reclaim.signal(157_000, 0);
        assertEquals(ScreenReclaim.Action.GIVE_UP, reclaim.onTakenAway(157_500, true));
        assertEquals(ScreenReclaim.Action.NONE, reclaim.onTakenAway(158_000, true));
        reclaim.signal(200_000, 0);
        assertTrue(reclaim.shouldReclaim(200_500, true));
    }
}
