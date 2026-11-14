package io.gh.reisxd.tizentube.vot;

/**
 * Keeps translated speech on the video clock. Small drift is corrected by
 * briefly playing a few percent faster or slower; a seek (an audible gap) is
 * reserved for large jumps such as a user seek or a resumed pause.
 *
 * The video keeps moving while MediaPlayer seeks, and how long a seek takes
 * (a network range request or a buffered jump) is not known in advance. A
 * seek during playback therefore lands ahead of the video by a margin; the
 * speech is held there and started when the video clock reaches it.
 *
 * start() itself takes a moment before sound is heard. That delay is learned
 * and start() is issued early; right after a start speech is never sped up to
 * cover a delay, it skips ahead instead.
 */
public final class AudioDrift {
    static final int SEEK_MS = 1000;
    /** A held start this far behind the video still starts; later ones seek again. */
    static final int LATE_MS = 100;
    static final int MIN_MARGIN_MS = 250;
    static final int MAX_MARGIN_MS = 3000;
    /** After start() no speed correction runs for this long. */
    static final int START_SETTLE_MS = 2500;
    /** Output latency is measured once speech has had this long to start. */
    static final int START_PROBE_MS = 300;
    static final int START_SKIP_MS = 150;
    static final int MAX_START_LEAD_MS = 600;
    private int trim;
    private int seekMarginMs = 400;
    private int startLeadMs;

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
     * Seek target: exact while paused. While playing it is ahead by the seek
     * margin plus the start lead, because the held start is issued that much
     * before the video reaches the landed position.
     */
    public int seekTarget(int desiredMs, boolean playing) {
        return playing ? desiredMs + seekMarginMs + startLeadMs : desiredMs;
    }

    /**
     * Learn from a finished seek. The next margin covers 1.5 times the video
     * time this seek took plus start-up slack. Overshooting only lengthens the
     * silence the seek causes anyway; a late landing costs another seek.
     */
    public void seekCompleted(long elapsedMs, float rate) {
        int next = (int) Math.min(MAX_MARGIN_MS, elapsedMs * (double) rate * 1.5 + 150);
        seekMarginMs = Math.max(MIN_MARGIN_MS, next);
    }

    public int seekMarginMs() {
        return seekMarginMs;
    }

    /**
     * Video time to wait before starting speech held at heldMs: positive to
     * wait, 0 to start now, -1 when the video already passed it (seek again).
     * start() is issued early by the learned output latency, so the first
     * sound is heard when the video reaches the held position.
     */
    public int startWait(int heldMs, int desiredMs) {
        int ahead = heldMs - startLeadMs - desiredMs;
        if (ahead > 0) return ahead;
        return -ahead <= LATE_MS ? 0 : -1;
    }

    /**
     * Learn from the drift measured shortly after a held start. MediaPlayer
     * reports the held position until its first frame is rendered, so speech
     * that is still behind means start() was not issued early enough.
     */
    public void heldStartMeasured(int driftMs) {
        startLeadMs = Math.max(0, Math.min(MAX_START_LEAD_MS, startLeadMs + driftMs / 2));
    }

    public int startLeadMs() {
        return startLeadMs;
    }

    /**
     * Right after start() speech must not be sped up to cover the start-up
     * delay. Speech this far behind skips ahead instead; smaller drift waits
     * until the settle window ends.
     */
    public static boolean skipAfterStart(int driftMs) {
        return driftMs > START_SKIP_MS;
    }

    /** Clears the speed correction. The learned seek margin and start lead describe the device and are kept. */
    public void reset() {
        trim = 0;
    }
}
