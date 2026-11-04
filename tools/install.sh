#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
	echo "Usage: sh tools/install.sh /path/to/luci-app-wifi-lab-<version>.apk" >&2
	exit 2
fi
if [ "$(id -u)" -ne 0 ] || [ ! -f /etc/openwrt_release ]; then
	echo "Run this script as root on OpenWrt." >&2
	exit 1
fi
case "$1" in /*) package=$1;; *) package=$PWD/$1;; esac
apk add --allow-untrusted "$package"
