# Kiosk da TV no Raspberry Pi 3 — GP Rotation (Spin Gaming)

Procedimento para transformar um **Raspberry Pi 3** num player dedicado da TV de
rotação: liga, loga sozinho, gira a tela para **retrato (90° horário)** e abre a
rotação em tela cheia. Se o Chromium cair, reabre em ~3s; se o X cair, reinicia.

> **Por que Lite e X mínimo?** No Pi 3 o desktop (LXDE/Wayland) é pesado e pode
> engasgar com a matriz grande. Uma sessão X mínima sem desktop é bem mais fluida.

## 1. Gravar o cartão (no seu PC)

Use o **Raspberry Pi Imager** (raspberrypi.com/software):

- **OS**: Raspberry Pi OS (other) → **Raspberry Pi OS Lite (Legacy, 32-bit / Bullseye)**.
  - É o **Lite** (sem desktop) e **Legacy/Bullseye** (X11), não o Bookworm.
- Antes de gravar, clique na engrenagem (⚙ configurações avançadas) e defina:
  - **Hostname**: ex. `sg-tv-estudio`
  - **Habilitar SSH** (senha) — para administrar sem teclado.
  - **Usuário/senha** (ex.: `pi` / sua senha).
  - **Wi-Fi** (ou use cabo de rede, mais estável para a TV).
  - **Locale**: fuso `America/Sao_Paulo`, teclado br.
- Grave e coloque o cartão no Pi.

## 2. Primeiro boot e acesso

- Ligue o Pi conectado à TV e à rede. Aguarde ~1–2 min no primeiro boot.
- Acesse por SSH do seu PC (ou abra um terminal no próprio Pi):
  ```bash
  ssh pi@sg-tv-estudio.local      # ou ssh pi@<IP-do-Pi>
  ```

## 3. Rodar o instalador

Copie o `setup-kiosk-rpi.sh` para o Pi (via SSH/`scp` ou pendrive) e:

```bash
chmod +x setup-kiosk-rpi.sh
sudo ./setup-kiosk-rpi.sh
sudo reboot
```

Após o reboot, o Pi deve logar sozinho, girar a tela e mostrar a rotação em tela cheia.

## 4. O que o instalador faz
- Instala o **X mínimo** (sem desktop) + **Chromium** + utilitários.
- Configura **autologin no console** (tty1).
- No login, inicia o **X** automaticamente (e reinicia o X se ele cair).
- A sessão X (`.xinitrc`): desliga descanso de tela, **gira para retrato via `xrandr`**,
  esconde o cursor e roda o **Chromium em kiosk** num **loop de reinício** (watchdog).
- Ajusta `gpu_mem=128` e `disable_overscan` no `config.txt` (ajuda o Chromium no Pi 3).

## 5. Ajustes (editar no Pi)
- **URL / rotação**: topo do `setup-kiosk-rpi.sh` **antes** de rodar, ou depois em
  `~/.xinitrc`:
  - `TV_URL="http://172.16.20.10/tv/"` (para rolagem: `.../tv/?autoscroll=1`)
  - `ROTATE="right"` (90° horário) | `left` (anti-horário) | `inverted` (180°)
- Após editar o `.xinitrc`, basta reiniciar o X: `pkill chromium` (o loop reabre) ou
  `sudo reboot`.

## 6. Manutenção (via SSH)
- **Ver se está rodando**: `ps aux | grep -i chromium`
- **Sair do kiosk** (volta ao console): `pkill chromium; pkill -f startx`
- **Reabrir**: faça logout/login na tty1 ou `sudo reboot`
- **Logs do boot**: `journalctl -b`

## 7. Desempenho no Pi 3 (expectativa honesta)
O Pi 3 dá conta da TV, mas é modesto. Se notar engasgo na rolagem ou na renderização:
- Prefira **cabo de rede** a Wi-Fi (menos variação).
- Mantenha a TV em **modo Matriz** (a autoescala já encaixa tudo; evite `autoscroll`,
  que força repaint contínuo).
- Garanta `gpu_mem=128` (o instalador já põe).
- Se ainda assim travar, um **Pi 4** elimina o problema (rotação acelerada por hardware)
  com exatamente este mesmo procedimento.

## 8. Rotação não funcionou?
Se a tela não girar, o nome da saída de vídeo pode diferir. Veja as saídas:
```bash
DISPLAY=:0 xrandr
```
Procure a linha com `connected` (ex.: `HDMI-1`, `HDMI-A-1`). O instalador detecta
automaticamente a primeira conectada; se houver mais de uma, fixe a correta no
`~/.xinitrc` na linha do `xrandr --output ... --rotate right`.
