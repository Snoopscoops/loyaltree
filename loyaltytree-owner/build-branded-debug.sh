#!/bin/sh
# Reuse the checked-in 512px original ring icon (the artwork in brand book p.6).
# The Android build files/resources are supplied by the existing local project.
set -eu
cd "$(dirname "$0")"
test -f ../frontend/public/favicon.png
test -f app/src/main/AndroidManifest.xml
test -f gradlew
res=app/src/main/res
mkdir -p "$res/drawable" "$res/drawable-v26"
cp ../frontend/public/favicon.png "$res/drawable/lt_mark.png"
cat > "$res/drawable/ic_launcher.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle">
            <size android:width="108dp" android:height="108dp"/>
            <corners android:radius="24dp"/>
            <solid android:color="#FFFFFF"/>
        </shape>
    </item>
    <item android:left="12dp" android:top="12dp" android:right="12dp" android:bottom="12dp" android:drawable="@drawable/lt_mark"/>
</layer-list>
XML
cat > "$res/drawable/lt_launcher_foreground.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@drawable/lt_mark" android:inset="24dp"/>
XML
cat > "$res/drawable-v26/ic_launcher.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@android:color/white"/>
    <foreground android:drawable="@drawable/lt_launcher_foreground"/>
</adaptive-icon>
XML
# Keep the existing manifest and signing identity; check that it uses this icon.
if ! grep -q '@drawable/ic_launcher' app/src/main/AndroidManifest.xml; then
    echo "Manifest icon is not @drawable/ic_launcher. Check its icon reference before building." >&2
    exit 1
fi
./gradlew assembleDebug --no-daemon
