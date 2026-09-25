package io.gh.reisxd.tizentube.vot;

/** Reject delayed commands from earlier pages and out-of-order HTTP requests. */
public final class PlaybackOrder {
    private long epoch = -1;
    private long sequence = -1;
    public boolean accept(long nextEpoch, long nextSequence) {
        if (nextEpoch < epoch || (nextEpoch == epoch && nextSequence <= sequence)) return false;
        epoch = nextEpoch;
        sequence = nextSequence;
        return true;
    }
}
