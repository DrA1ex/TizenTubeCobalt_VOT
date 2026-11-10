import io.gh.reisxd.tizentube.vot.AudioDrift;
public class AudioDriftTest {
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    static boolean near(float a, float b) { return Math.abs(a - b) < 0.0001f; }
    public static void main(String[] args) {
        AudioDrift drift = new AudioDrift();
        check(near(drift.speed(1.5f, 30), 1.5f)); // within the dead band
        check(near(drift.speed(1.5f, 130), 1.56f)); // speech is behind: catch up
        check(near(drift.speed(1.5f, 80), 1.56f)); // hysteresis keeps correcting
        check(near(drift.speed(1.5f, 40), 1.5f)); // aligned again
        check(near(drift.speed(1f, -700), 0.92f)); // speech is ahead: slow down
        check(Float.isNaN(drift.speed(1f, 1200))); // large jump: seek
        check(near(drift.speed(1f, 100), 1f)); // seek resets the correction
        check(drift.seekTarget(30000, true) == 30000); // nothing learned yet
        drift.seekCompleted(600, 1f); // the video moved 600 ms during the seek
        check(drift.seekTarget(30000, true) == 30300);
        drift.seekCompleted(600, 1f);
        check(drift.seekTarget(30000, true) == 30450); // converges on the seek time
        check(drift.seekTarget(30000, false) == 30000); // a paused video does not move
        drift.seekCompleted(5000, 2f); // a stalled network seek is capped
        check(drift.seekLeadMs() <= 800); // below the 1 s seek threshold
        drift.reset();
        check(drift.seekLeadMs() > 0); // reset keeps the device seek time
        System.out.println("AudioDrift: 14 checks passed");
    }
}
