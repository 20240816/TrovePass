-dontobfuscate

-keepclassmembers class dev.trovepass.MainActivity$NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class dev.trovepass.MainActivity$NativeBridge { *; }
