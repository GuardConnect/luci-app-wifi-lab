#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
	echo "Usage: sh tools/publish-release.sh OWNER/REPOSITORY /path/to/package.apk" >&2
	exit 2
fi
repo=$1
package=$2
name=${package##*/}
case "$name" in luci-app-wifi-lab-*.apk) ;; *) exit 2;; esac
version=${name#luci-app-wifi-lab-}
tag=v${version%.apk}
case "$package" in /*) ;; *) package=$PWD/$package;; esac
[ -f "$package" ]
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
(cd "$(dirname "$package")" && sha256sum "$name") > "$stage/SHA256SUMS"
gh release create "$tag" "$package" "$stage/SHA256SUMS" --repo "$repo" --verify-tag \
	--latest --title "Wi-Fi Lab ${tag#v}" --notes-file RELEASE.md
