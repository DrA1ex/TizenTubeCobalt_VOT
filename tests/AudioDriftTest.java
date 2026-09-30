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
        System.out.println("AudioDrift: 7 checks passed");
    }
}
