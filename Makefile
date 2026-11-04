include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-wifi-lab
PKG_VERSION:=0.1.0
PKG_RELEASE:=38

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-wifi-lab
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=Wi-Fi Lab for LuCI
  PKGARCH:=all
  DEPENDS:=+luci-base +rpcd +jshn +jsonfilter +iw-full +aircrack-ng +airmon-ng +mount-utils +usbutils +flock +coreutils-timeout +coreutils-base64 +coreutils-od +coreutils-sleep
endef

define Build/Compile
endef

define Package/luci-app-wifi-lab/install
	$(INSTALL_DIR) $(1)/usr/libexec/rpcd $(1)/usr/share/rpcd/acl.d $(1)/usr/share/luci/menu.d $(1)/www/luci-static/resources/view
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/luci.wifilab $(1)/usr/libexec/rpcd/
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/*.json $(1)/usr/share/rpcd/acl.d/
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/*.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DIR) $(1)/usr/share/wifi-lab
	$(INSTALL_DATA) ./root/usr/share/wifi-lab/wps.awk $(1)/usr/share/wifi-lab/
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/*.js $(1)/www/luci-static/resources/view/
endef

define Package/luci-app-wifi-lab/postinst
#!/bin/sh
[ -z "$$IPKG_INSTROOT" ] || exit 0
rm -f /tmp/luci-indexcache /tmp/luci-indexcache.*
/etc/init.d/rpcd reload
exit 0
endef

$(eval $(call BuildPackage,luci-app-wifi-lab))
