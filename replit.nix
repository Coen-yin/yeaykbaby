{pkgs}: {
  deps = [
    pkgs.libgbm
    pkgs.gtk3
    pkgs.mesa
    pkgs.libxkbcommon
    pkgs.xorg.libxcb
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXext
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.xorg.libX11
    pkgs.pango
    pkgs.cairo
    pkgs.at-spi2-atk
    pkgs.atk
    pkgs.alsa-lib
    pkgs.expat
    pkgs.dbus
    pkgs.cups
    pkgs.nspr
    pkgs.nss
    pkgs.glib
    pkgs.unzip
  ];
}
