package io.gh.reisxd.tizentube.vot;

import java.util.Locale;

/** Native dialog strings follow Android locale; other languages use English. */
public final class NativeStrings {
    private NativeStrings() {}

    public static String text(String key) {
        boolean russian = "ru".equalsIgnoreCase(Locale.getDefault().getLanguage());
        switch (key) {
            case "invalidOAuthTokenFormat": return russian ? "Некорректный формат OAuth-токена" : "Invalid OAuth token format";
            case "couldNotSaveTheToken": return russian ? "Не удалось сохранить токен" : "Could not save the token";
            case "couldNotOpenSignInEnter": return russian ? "Не удалось открыть вход. Используйте ввод токена." : "Could not open sign-in. Enter the token instead.";
            case "yandexOAuthToken": return russian ? "OAuth-токен Яндекса" : "Yandex OAuth token";
            case "yandexSignInExpressiveVoices": return russian ? "Авторизация Яндекса · живые голоса" : "Yandex sign-in \u00b7 expressive voices";
            case "pasteYourOAuthTokenFromVOT": return russian ? "Вставьте OAuth-токен из VOT / Яндекс. Можно использовать клавиатуру Android TV или вставку из буфера. Токен хранится зашифрованным в приложении и отправляется только Яндексу. Сохранение не проверяет срок действия токена." : "Paste your OAuth token from VOT / Yandex. Use the Android TV keyboard or paste from the clipboard. The token is stored encrypted in the app and sent only to Yandex. Saving it does not verify its expiration.";
            case "save": return russian ? "Сохранить" : "Save";
            case "cancel": return russian ? "Отмена" : "Cancel";
            case "removeToken": return russian ? "Удалить токен" : "Remove token";
            case "tokenRemoved": return russian ? "Токен удалён" : "Token removed";
            case "tokenSavedSelectExpressiveVoiceIn": return russian ? "Токен сохранён. Выберите «Живой голос» в VOT." : "Token saved. Select Expressive voice in VOT.";
            case "checkTheTokenPasteOnlyIts": return russian ? "Проверьте токен: вставьте только значение, без ссылки." : "Check the token: paste only its value, without a link.";
            case "addAnOAuthTokenInVOT": return russian ? "Добавьте OAuth-токен в настройках VOT" : "Add an OAuth token in VOT settings";
            case "androidMediaPlayerError": return russian ? "Ошибка Android MediaPlayer" : "Android MediaPlayer error";
            case "couldNotSynchronizeAudio": return russian ? "Не удалось синхронизировать аудио" : "Could not synchronize audio";
            case "seekCompletionError": return russian ? "Ошибка завершения перемотки" : "Seek completion error";
            case "theSignInPageRedirectedTo": return russian ? "Страница входа перенаправила на неподдерживаемый адрес" : "The sign-in page redirected to an unsupported address";
            case "webviewIsUnavailableOnThisDevice": return russian ? "На этой приставке недоступен WebView. Используйте пункт «Вставить токен вручную»." : "WebView is unavailable on this device. Use Paste token manually.";
            case "unsupportedSignInAddressEnterThe": return russian ? "Неподдерживаемый адрес входа. Используйте ручной ввод токена." : "Unsupported sign-in address. Enter the token manually.";
            case "yandexSignedIn": return russian ? "Яндекс: вход выполнен" : "Yandex: signed in";
            case "signInToYandex": return russian ? "Вход в Яндекс" : "Sign in to Yandex";
            case "close": return russian ? "Закрыть" : "Close";
            case "invalidSignInAddress": return russian ? "Неверный адрес входа" : "Invalid sign-in address";
            case "duplicateAuthorizationParameter": return russian ? "Повтор параметра авторизации" : "Duplicate authorization parameter";
            case "signInVerificationDidNotMatch": return russian ? "Не совпало подтверждение входа. Попробуйте ещё раз." : "Sign-in verification did not match. Try again.";
            case "signInWasCancelledOrRejected": return russian ? "Вход отменён или отклонён Яндексом" : "Sign-in was cancelled or rejected by Yandex";
            case "yandexDidNotReturnAToken": return russian ? "Яндекс не вернул токен" : "Yandex did not return a token";
            case "tokenExpirationIsMissing": return russian ? "Нет срока действия токена" : "Token expiration is missing";
            case "invalidTokenExpiration": return russian ? "Неверный срок действия токена" : "Invalid token expiration";
            default: throw new IllegalArgumentException("Unknown native translation key: " + key);
        }
    }
}
