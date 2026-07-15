#!/usr/bin/env bash
#
# setup-kiosk-rpi.sh — Kiosk da TV de Rotação (Spin Gaming) no Raspberry Pi 3
# ---------------------------------------------------------------------------
# Alvo : Raspberry Pi 3 + Raspberry Pi OS Lite (Bullseye), tela em RETRATO.
# Como : sessão X mínima (sem desktop) que gira a tela e roda o Chromium em
#        kiosk, com loop de reinício (watchdog) + reinício do X se cair.
# Por  : no Pi 3 o desktop LXDE/Wayland é pesado; X mínimo é mais fluido.
#
# Rodar UMA VEZ, com sudo, no usuário do Pi (ex.: 'pi'):
#   chmod +x setup-kiosk-rpi.sh
#   sudo ./setup-kiosk-rpi.sh
#
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
#  CONFIGURAÇÃO  (ajuste se necessário)
# ─────────────────────────────────────────────────────────────────────────────
TV_URL="http://172.16.20.10/tv/"     # URL da TV (modo Matriz; a autoescala resolve a altura)
KIOSK_USER="${SUDO_USER:-pi}"         # usuário do Pi que roda o kiosk
ROTATE="right"                        # right = 90° horário | left = 90° anti-horário | inverted = 180°
# ─────────────────────────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]]; then echo "Rode com sudo: sudo ./setup-kiosk-rpi.sh"; exit 1; fi
USER_HOME="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
echo "== Kiosk GP Rotation (Raspberry Pi 3 / Lite) =="
echo "   Usuário: $KIOSK_USER ($USER_HOME) | URL: $TV_URL | rotação: $ROTATE"

# ── 1) Pacotes: X mínimo + Chromium (sem desktop) ────────────────────────────
echo "[1/5] Instalando pacotes (pode demorar)..."
apt-get update -y
apt-get install -y --no-install-recommends \
  xserver-xorg xinit x11-xserver-utils xserver-xorg-legacy \
  chromium-browser unclutter

# permite iniciar o X a partir do console (necessário p/ startx via autologin)
if [[ -f /etc/X11/Xwrapper.config ]]; then
  sed -i 's/^allowed_users=.*/allowed_users=anybody/' /etc/X11/Xwrapper.config
  grep -q '^needs_root_rights' /etc/X11/Xwrapper.config \
    && sed -i 's/^needs_root_rights=.*/needs_root_rights=yes/' /etc/X11/Xwrapper.config \
    || echo 'needs_root_rights=yes' >> /etc/X11/Xwrapper.config
else
  printf 'allowed_users=anybody\nneeds_root_rights=yes\n' > /etc/X11/Xwrapper.config
fi

# ── 2) Memória de vídeo + sem overscan (ajuda o Chromium no Pi 3) ────────────
echo "[2/5] Ajustando /boot/config.txt..."
BOOTCFG="/boot/config.txt"; [[ -f /boot/firmware/config.txt ]] && BOOTCFG="/boot/firmware/config.txt"
sed -i '/^# GP Rotation kiosk/,+2d' "$BOOTCFG" 2>/dev/null || true
{
  echo ""
  echo "# GP Rotation kiosk"
  echo "gpu_mem=128"
  echo "disable_overscan=1"
} >> "$BOOTCFG"
# Obs.: a ROTAÇÃO é feita por xrandr no .xinitrc (no Bullseye/KMS o display_rotate
# do config.txt é ignorado pela sessão gráfica).

# ── 3) Autologin no console (tty1) para o usuário do kiosk ───────────────────
echo "[3/5] Configurando autologin no console..."
raspi-config nonint do_boot_behaviour B2 || true   # B2 = console autologin
# garante o autologin no getty da tty1 (reforço, caso o raspi-config não cubra)
install -d /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KIOSK_USER --noclear %I \$TERM
EOF

# ── 4) .bash_profile: ao logar na tty1, inicia o X (com loop se o X cair) ─────
echo "[4/5] Configurando início do X no login..."
PROFILE="$USER_HOME/.bash_profile"
sed -i '/# GP Rotation kiosk start/,+3d' "$PROFILE" 2>/dev/null || true
cat >> "$PROFILE" <<'EOF'

# GP Rotation kiosk start
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = "/dev/tty1" ]; then
  while true; do startx -- -nocursor; sleep 3; done
fi
EOF
chown "$KIOSK_USER:$KIOSK_USER" "$PROFILE"

# ── 5) .xinitrc: gira a tela, esconde cursor e roda o Chromium em loop ───────
echo "[5/5] Criando sessão X (.xinitrc) com Chromium kiosk..."
cat > "$USER_HOME/.xinitrc" <<EOF
#!/bin/sh
# energia/descanso desligados
xset -dpms; xset s off; xset s noblank

# rotação RETRATO: detecta a saída conectada e gira ($ROTATE = 90° horário)
OUT=\$(xrandr | awk '/ connected/{print \$1; exit}')
[ -n "\$OUT" ] && xrandr --output "\$OUT" --rotate $ROTATE

# esconde o cursor do mouse
unclutter -idle 0.5 -root &

PROFILE=$USER_HOME/.config/gp-kiosk
mkdir -p "\$PROFILE"
CHROME=\$(command -v chromium-browser || command -v chromium)

# loop de watchdog: se o Chromium fechar/travar, reabre em 3s
while true; do
  # limpa marca de "saiu sujo" pra não aparecer o balão de restaurar sessão
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' \
    "\$PROFILE/Default/Preferences" 2>/dev/null || true
  "\$CHROME" \\
    --kiosk "$TV_URL" \\
    --user-data-dir="\$PROFILE" \\
    --noerrdialogs \\
    --disable-infobars \\
    --disable-session-crashed-bubble \\
    --disable-features=Translate,TranslateUI \\
    --check-for-update-interval=31536000 \\
    --overscroll-history-navigation=0 \\
    --disable-pinch \\
    --autoplay-policy=no-user-gesture-required \\
    --start-fullscreen
  sleep 3
done
EOF
chown "$KIOSK_USER:$KIOSK_USER" "$USER_HOME/.xinitrc"
chmod +x "$USER_HOME/.xinitrc"

systemctl daemon-reload
echo ""
echo "Concluido! Reinicie:   sudo reboot"
echo "  - O Pi loga sozinho na tty1, sobe o X, gira a tela e abre a TV em kiosk."
echo "  - Se o Chromium cair, reabre em ~3s. Se o X cair, reinicia sozinho."
echo ""
echo "Manutencao (via SSH):"
echo "  Sair do kiosk:   pkill chromium; pkill -f startx     (volta ao console)"
echo "  Ver processos:   ps aux | grep -i chromium"
echo "  Editar URL/rot.: $USER_HOME/.xinitrc"
