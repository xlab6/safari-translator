#!/usr/bin/env bash
#
# Build, sign, notarize and package Safari Translator as a DMG.
#
# Requirements:
#   - A paid Apple Developer Program membership
#   - "Developer ID Application" certificate in the login keychain
#   - notarytool credentials stored in a keychain profile
#
# Example:
#   xcrun notarytool store-credentials "safari-translator-notary" \
#     --apple-id "you@example.com" --team-id "TEAMID" --password "app-specific-password"
#
#   DEVELOPMENT_TEAM=TEAMID \
#   DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)" \
#   NOTARY_PROFILE=safari-translator-notary \
#   npm run release:dmg
#
set -euo pipefail

APP_NAME="Safari Translator"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
XCODE_DIR="$ROOT/xcode/$APP_NAME"
PROJECT="$XCODE_DIR/$APP_NAME.xcodeproj"
SCHEME="$APP_NAME"
BUILD="$XCODE_DIR/build"
DIST="$ROOT/dist"
VERSION="${VERSION:-$(/usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$ROOT/extension/manifest.json")}"
IDENTITY="${DEVELOPER_ID_APPLICATION:-}"
TEAM_ID="${DEVELOPMENT_TEAM:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-safari-translator-notary}"
NOTARIZE="${NOTARIZE:-1}"

die() {
    printf 'error: %s\n' "$*" >&2
    exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || die "this script must run on macOS"
[[ -d "$PROJECT" ]] || die "Xcode project not found: $PROJECT"
[[ -n "$VERSION" ]] || die "could not read the extension version"

if [[ -z "$IDENTITY" ]]; then
    IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
        | sed -n 's/.*"\(Developer ID Application:.*\)"/\1/p' \
        | head -n 1)"
fi

[[ -n "$IDENTITY" ]] || die \
    "no 'Developer ID Application' certificate found. A free Personal Team cannot create one; enroll in the Apple Developer Program first."
[[ "$IDENTITY" == "Developer ID Application:"* ]] || die \
    "expected a 'Developer ID Application' identity, got: $IDENTITY"
[[ -n "$TEAM_ID" ]] || die \
    "set DEVELOPMENT_TEAM to your 10-character Apple Developer Team ID"

if [[ "$NOTARIZE" == "1" ]]; then
    xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1 || die \
        "notarytool profile '$NOTARY_PROFILE' is missing. Create it with 'xcrun notarytool store-credentials'."
fi

echo "==> Building $APP_NAME $VERSION"
rm -rf "$BUILD/dd" "$BUILD/products" "$BUILD/obj" "$BUILD/dmg"
mkdir -p "$DIST"

cd "$XCODE_DIR"
xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration Release \
    -derivedDataPath "$BUILD/dd" \
    SYMROOT="$BUILD/products" \
    OBJROOT="$BUILD/obj" \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE=Manual \
    CODE_SIGN_IDENTITY="$IDENTITY" \
    PROVISIONING_PROFILE_SPECIFIER="" \
    OTHER_CODE_SIGN_FLAGS="--timestamp" \
    build

APP="$BUILD/products/Release/$APP_NAME.app"
[[ -d "$APP" ]] || die "built app not found: $APP"

echo "==> Verifying signature"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -dvv "$APP" 2>&1 | grep -E "Authority=|TeamIdentifier=" || true
spctl --assess --type execute --verbose=4 "$APP" || true

if [[ "$NOTARIZE" == "1" ]]; then
    APP_ZIP="$DIST/$APP_NAME-$VERSION.zip"
    echo "==> Notarizing app"
    ditto -c -k --keepParent "$APP" "$APP_ZIP"
    xcrun notarytool submit "$APP_ZIP" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$APP"
    xcrun stapler validate "$APP"
    rm -f "$APP_ZIP"
fi

echo "==> Creating DMG"
STAGE="$BUILD/dmg"
mkdir -p "$STAGE"
ditto "$APP" "$STAGE/$APP_NAME.app"
ln -s /Applications "$STAGE/Applications"

DMG="$DIST/$APP_NAME-$VERSION.dmg"
rm -f "$DMG"
hdiutil create \
    -volname "$APP_NAME" \
    -srcfolder "$STAGE" \
    -ov -format UDZO \
    "$DMG" >/dev/null

echo "==> Signing DMG"
codesign --force --sign "$IDENTITY" --timestamp "$DMG"

if [[ "$NOTARIZE" == "1" ]]; then
    echo "==> Notarizing DMG"
    xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$DMG"
    xcrun stapler validate "$DMG"
    spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG" \
        || die "Gatekeeper rejected the DMG"
fi

shasum -a 256 "$DMG" > "$DMG.sha256"
echo
echo "Created: $DMG"
cat "$DMG.sha256"
