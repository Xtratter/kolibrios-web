# KolibriOS in the browser

[Русский](README.md) | **English**

A website that drops every visitor into [KolibriOS](https://kolibrios.org) running in the
[v86](https://github.com/copy/v86) emulator right in their browser. The server only serves
static files, so its load barely depends on the number of visitors.

## Features

- **Russian and English interface.** The installer asks which language to use as the
  default; visitors can switch it in the menu.
- **Phone-friendly.** The screen fits the window; fullscreen mode rotates to landscape.
- **Two touch modes.**
  - *Direct:* tap clicks exactly at that point, long press is a right click, sliding a
    finger drags, two fingers scroll.
  - *Touchpad:* a finger moves the cursor and a tap clicks. The whole page area works as the
    pad, including the space above and below the guest screen. At the bottom there are LMB,
    2× (double click) and RMB buttons that can be held down.
- **Android soft keyboard** plus a bar with Esc, Tab, Ctrl, Alt, arrows and F1–F12. Russian
  and Latin letters can be typed interchangeably: the layout inside KolibriOS switches by
  itself.
- **Desktop mouse** works right away, without pointer capture.
- **Machine state** can be saved in the browser or to a file and restored from either.
- **Media pack.** An optional disk with the `/kolibrios` folder of the full distribution:
  players, games, 3D, development tools. It is loaded in parts, only as files are opened.
- **Automatic updates.** Once a day the server installs the latest build from
  builds.kolibrios.org and keeps the last three for rollback. There is a password-protected
  admin page.

## How it works

| Path | What it is |
|---|---|
| `web/index.html`, `web/app.js` | The page: emulator startup, screen, touch input, menu, saved states |
| `web/kmouse.js` | Exact (absolute) cursor positioning on top of a relative PS/2 mouse |
| `web/kkeys.js` | Text input via scancodes with automatic keyboard layout switching |
| `web/i18n.js` | Russian and English UI strings for the page and the admin page |
| `web/admin/` | Update admin page |
| `install.sh` | Interactive installer for the whole site on Debian/Ubuntu |
| `server/kolibri-update` | Downloads a build, checks SHA-256, builds the images, publishes them |
| `server/kolibri-admin.py` | Admin page API (127.0.0.1 only, behind the nginx password) |
| `server/systemd/`, `server/nginx/` | Units and an example nginx configuration |
| `tests/` | Runs KolibriOS in Node.js without a browser; checks mouse and keyboard |

A few KolibriOS and v86 quirks the input handling is built on:

- **Mouse acceleration** in the kernel (`hid/mousedrv.inc`) turns a delta `d` into
  `((|d|+3)²−1 >> 4) + 1` pixels. v86 sends every delta as a separate packet. So the cursor
  can be parked in a corner and walked to any pixel with known steps.
- **Button press and release** must be about 50 ms apart: programs poll the button state and
  miss the click otherwise.
- **The layout is owned by `@taskbar`.** Alt+2 always selects Russian, while Ctrl+Shift
  toggles by an internal counter. So to get English, after Ctrl+Shift the page checks the
  "En/Ru" taskbar indicator directly in video memory.
- **Console programs** drop keys that arrive more often than once per 100 ms.
- **A CD-ROM hangs KolibriOS under v86.** That is why the media pack is a FAT32 disk; the
  `/kolibrios` folder on it is found by `SEARCHAP`.

## Installation

You need a Debian or Ubuntu server with root access and about 600 MB of free space.
Everything else (nginx, 7-Zip, FAT tools, Python, optionally certbot) is installed by the
installer.

```sh
git clone https://github.com/Xtratter/kolibrios-web
cd kolibrios-web
sudo ./install.sh
```

Or with one command, without cloning by hand (the script downloads the project to
`/opt/kolibrios-web` itself):

```sh
sudo bash -c "$(curl -fsSL https://raw.githubusercontent.com/Xtratter/kolibrios-web/main/install.sh)"
```

The installer asks questions (each has a default; Enter accepts it):

- **Language** of the installer and the default language of the site (Russian or English).
- **Domain.** If left empty, the site opens at the server's IP address over HTTP.
- **How to connect to nginx.**
  - *Separate site:* the installer creates the `server { }` block itself and can obtain a
    free Let's Encrypt HTTPS certificate.
  - *Add to an existing site:* the installer creates
    `/etc/nginx/snippets/kolibrios.conf`, and you add it to your `server { }` with an
    `include` line.
- **Path on the site and the directory for files.** For example `/` or `/kolibri/`.
- **KolibriOS build language:** Russian, English, Spanish, Italian or Estonian.
- **Admin page login and password.** An empty password means a random one is generated.

Then it shows a summary and, once confirmed, does everything itself:

- installs packages and places the site files;
- downloads v86 and the first KolibriOS build;
- configures nginx and HTTPS;
- enables daily updates and the admin page.

At the end it prints the addresses and the password; the password is also saved to
`/root/kolibrios-admin.txt`.

- **Update an installation** (new project version, different settings): run `install.sh`
  again. Previous answers become the defaults; downloaded builds and the password are kept.
- **Without questions:** `sudo ./install.sh --yes`. Answers can be given as environment
  variables: `UI_LANG` (`ru`/`en`), `DOMAIN`, `NGINX_MODE` (`site`/`snippet`), `PREFIX`, `WEBROOT`, `HTTPS`,
  `LE_EMAIL`, `KOLIBRI_LANG`, `ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_PORT`.
- **Uninstall:** `sudo ./install.sh --uninstall`. The directory with downloaded builds is
  removed only after a separate confirmation.

For HTTPS the domain must point to the server and port 80 must be open. Without systemd
(for example in a container) the site is installed, but updates and the admin backend have
to be started by hand; the installer prints the commands.

<details>
<summary>Manual installation</summary>

```sh
sudo apt install nginx curl 7zip dosfstools mtools fdisk python3
sudo mkdir -p /var/www/html/kolibri
sudo cp -r web/* /var/www/html/kolibri/
sudo scripts/fetch-v86.sh /var/www/html/kolibri
sudo install -m 755 server/kolibri-update /usr/local/bin/
sudo install -D -m 644 server/kolibri-admin.py /usr/local/lib/kolibri/kolibri-admin.py
sudo cp server/systemd/* /etc/systemd/system/
sudo install -d -o www-data -g www-data /var/lib/kolibri-update /var/www/html/kolibri/os
sudo chown -R www-data:www-data /var/www/html/kolibri
sudo systemctl daemon-reload
sudo systemctl start kolibri-update.service
sudo systemctl enable --now kolibri-update.timer kolibri-admin.service
```

Then add the blocks from `server/nginx/kolibri.conf` to your nginx HTTPS server, create the
password file (the command is in a comment in that file) and reload nginx. The directory,
build language, admin port and message language are set with the `KOLIBRI_ROOT`,
`KOLIBRI_LANG`, `KOLIBRI_ADMIN_PORT` and `KOLIBRI_UI_LANG` (`ru`/`en`) variables; the
page's default language is `data-default-lang` on `<html>` in `index.html` and
`admin/index.html`.

</details>

## Tests

The tests run real KolibriOS in v86 under Node.js 22 and read frames straight from video
memory. They need the v86 files and at least one build in `web/os/`, or point
`KOLIBRI_WEB` at a working site:

```sh
KOLIBRI_WEB=/var/www/html/kolibri node tests/mouse.test.js     # cursor lands on exact pixels
KOLIBRI_WEB=/var/www/html/kolibri node tests/keyboard.test.js  # tests/shots/keyboard.png
```

The emulator with the guest system needs about 300 MB of memory.

## Limitations

- **The guest system has no internet access.** v86 can only reach the network through a
  relay on the server, which would turn the server into an open proxy.
- **Soft keyboard input** is about 5 characters per second; otherwise console programs drop
  keystrokes.
- **A saved state restores** only into the same build with the same set of disks. When
  needed, the page restarts itself with the matching configuration.
- **ISO checksum.** The `sha256sums.txt` on builds.kolibrios.org has been seen with a stale
  checksum for the ISO. Such an archive is accepted if it passes `7z t` and is flagged on the
  admin page. The floppy image with the system itself is accepted only with a matching
  checksum.

## License

The project code is MIT, see [LICENSE](LICENSE). v86 is distributed under BSD-2-Clause,
SeaBIOS under LGPLv3, KolibriOS under GPLv2. They are downloaded separately and are not part
of this repository.
