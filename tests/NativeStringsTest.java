import io.gh.reisxd.tizentube.vot.NativeStrings;
import java.util.Locale;

public class NativeStringsTest {
    public static void main(String[] args) {
        Locale previous = Locale.getDefault();
        try {
            Locale.setDefault(Locale.forLanguageTag("ru-RU"));
            if (!"Вход в Яндекс".equals(NativeStrings.text("signInToYandex"))) throw new AssertionError("Russian locale");
            Locale.setDefault(Locale.forLanguageTag("en-US"));
            if (!"Sign in to Yandex".equals(NativeStrings.text("signInToYandex"))) throw new AssertionError("English locale");
            Locale.setDefault(Locale.forLanguageTag("fr-FR"));
            if (!"Sign in to Yandex".equals(NativeStrings.text("signInToYandex"))) throw new AssertionError("Fallback locale");
        } finally { Locale.setDefault(previous); }
        System.out.println("Native locale: 3 assertions passed");
    }
}
