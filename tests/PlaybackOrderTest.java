import io.gh.reisxd.tizentube.vot.PlaybackOrder;
public class PlaybackOrderTest {
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) {
        PlaybackOrder order = new PlaybackOrder();
        check(order.accept(100, 1)); // start
        check(order.accept(100, 4)); // stop overtakes seek and resume
        check(!order.accept(100, 2));
        check(!order.accept(100, 3));
        check(!order.accept(100, 4)); // duplicate
        check(order.accept(101, 1)); // new page
        check(!order.accept(100, 999)); // late old-page response
        System.out.println("PlaybackOrder: 7 checks passed");
    }
}
