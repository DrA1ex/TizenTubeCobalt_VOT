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
        check(drift.seekTarget(30000, true) == 30400); // default margin before any seek
        check(drift.seekTarget(30000, false) == 30000); // a paused video does not move
        drift.seekCompleted(600, 1f); // the video moved 600 ms during the seek
        check(drift.seekMarginMs() == 1050); // 1.5 x 600 + 150
        drift.seekCompleted(20, 1f); // a buffered seek
        check(drift.seekMarginMs() == 250); // floor
        drift.seekCompleted(5000, 2f); // a stalled network seek
        check(drift.seekMarginMs() == 3000); // cap
        drift.reset();
        check(drift.seekMarginMs() == 3000); // reset keeps the device seek time
        check(AudioDrift.startWait(31000, 30400) == 600); // held ahead: wait
        check(AudioDrift.startWait(31000, 31060) == 0); // slightly late: start now
        check(AudioDrift.startWait(31000, 31200) == -1); // the video passed it: seek again
        System.out.println("AudioDrift: 18 checks passed");
    }
}
