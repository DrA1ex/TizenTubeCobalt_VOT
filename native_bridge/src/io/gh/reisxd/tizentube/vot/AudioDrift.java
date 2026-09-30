package io.gh.reisxd.tizentube.vot;

/**
 * Keeps translated speech on the video clock. Small drift is corrected by
 * briefly playing a few percent faster or slower; a seek (an audible gap) is
 * reserved for large jumps such as a user seek or a resumed pause.
 */
public final class AudioDrift {
    static final int SEEK_MS = 1000;
    private int trim;

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

    public void reset() {
        trim = 0;
    }
}
