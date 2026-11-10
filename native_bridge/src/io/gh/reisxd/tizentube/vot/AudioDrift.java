package io.gh.reisxd.tizentube.vot;

/**
 * Keeps translated speech on the video clock. Small drift is corrected by
 * briefly playing a few percent faster or slower; a seek (an audible gap) is
 * reserved for large jumps such as a user seek or a resumed pause.
 */
public final class AudioDrift {
    static final int SEEK_MS = 1000;
    /** Below SEEK_MS, so an overshooting lead is trimmed by speed, not another seek. */
    static final int MAX_SEEK_LEAD_MS = 800;
    private int trim;
    private int seekLeadMs;

    /** Speed for a drift of desired minus actual position, or NaN to seek. */
    public float speed(float rate, int driftMs) {
        int size = Math.abs(driftMs);
        if (size > SEEK_MS) {
            trim = 0;
            return Float.NaN;
        }
        // MediaPlayer positions are coarse on TV devices; keep a dead band and
        // hysteresis so jitter does not toggle the speed on every heartbeat.
        if (size < 50) trim = 0;
        else if (size > 100) trim = Integer.signum(driftMs) * (size > 500 ? 2 : 1);
        return rate * (1f + 0.04f * trim);
    }

    /**
     * Seek target for playing speech. The video keeps moving while MediaPlayer
     * seeks (a network range request for an unbuffered position), so seeking
     * to the current position would land behind by the seek time.
     */
    public int seekTarget(int desiredMs, boolean playing) {
        return playing ? desiredMs + seekLeadMs : desiredMs;
    }

    /** Learn how far the video moves during a seek on this device and network. */
    public void seekCompleted(long elapsedMs, float rate) {
        int observed = (int) Math.max(0, Math.min(MAX_SEEK_LEAD_MS, elapsedMs * (double) rate));
        seekLeadMs = (seekLeadMs + observed) / 2;
    }

    public int seekLeadMs() {
        return seekLeadMs;
    }

    /** Clears the speed correction. The learned seek lead describes the device and is kept. */
    public void reset() {
        trim = 0;
    }
}
