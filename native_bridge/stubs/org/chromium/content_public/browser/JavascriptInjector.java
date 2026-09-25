package org.chromium.content_public.browser;

import java.lang.annotation.Annotation;
import java.util.List;

public interface JavascriptInjector {
    static JavascriptInjector fromWebContents(WebContents webContents) { return null; }
    void setAllowInspection(boolean allow);
    List<String> addPossiblyUnsafeInterface(
            Object object,
            String name,
            Class<? extends Annotation> annotation,
            List<String> originAllowlist
    );
}
