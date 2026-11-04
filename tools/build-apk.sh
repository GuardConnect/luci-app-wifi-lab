#!/bin/sh
set -eu

source_dir=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
output=${1:-"$source_dir/luci-app-wifi-lab-0.1.0-r38.apk"}
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
cp -R "$source_dir/root/." "$stage/"
mkdir -p "$stage/www"
cp -R "$source_dir/htdocs/." "$stage/www/"
find "$stage" -type d -exec chmod 755 {} +
find "$stage" -type f -exec chmod 644 {} +
chmod 755 "$stage/usr/libexec/rpcd/luci.wifilab"
"${APK_TOOL:-apk}" mkpkg --compat 3.0.0 --files "$stage" \
	--info name:luci-app-wifi-lab --info version:0.1.0-r38 --info arch:noarch \
	--info 'description:Wi-Fi survey, WPS inspection and test captures for LuCI' \
	--info 'depends:luci-base rpcd jshn jsonfilter iw-full aircrack-ng airmon-ng mount-utils usbutils flock coreutils-timeout coreutils-base64 coreutils-od coreutils-sleep' \
	--script post-install:"$source_dir/tools/post-install.sh" \
	--script post-upgrade:"$source_dir/tools/post-install.sh" --output "$output"
