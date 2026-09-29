#!/bin/bash
# Interactive installer: sets up a KolibriOS-in-the-browser site on a
# Debian/Ubuntu server (nginx + v86 + daily KolibriOS updates + admin page).
#
#   sudo ./install.sh              ask questions, then install or update
#   sudo ./install.sh --yes        take defaults / environment values, no questions
#   sudo ./install.sh --uninstall  remove what the installer created
#
# Every answer can be preset in the environment: UI_LANG (ru|en), DOMAIN,
# NGINX_MODE (site|snippet), PREFIX, WEBROOT, HTTPS (yes|no), LE_EMAIL,
# KOLIBRI_LANG, ADMIN_USER, ADMIN_PASSWORD, ADMIN_PORT. Running it again updates
# an existing install and keeps downloaded builds and the admin password
# (unless a new one is given).
set -euo pipefail

REPO_URL=https://github.com/Xtratter/kolibrios-web
CONF=/etc/kolibrios-web.conf        # answers of the last run, reused as defaults
STATE=/var/lib/kolibri-update
CREDS=/root/kolibrios-admin.txt
ASSUME_YES=0
SAVED_KEYS='UI_LANG|DOMAIN|NGINX_MODE|PREFIX|WEBROOT|HTTPS|LE_EMAIL|KOLIBRI_LANG|ADMIN_USER|ADMIN_PORT'

# ---------------------------------------------------------------- helpers

if [ -t 1 ]; then B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' N=$'\e[0m'; else B= G= Y= R= N=; fi

# T "русский" "english": text in the installer's language.
T() { if [ "${UI_LANG:-en}" = ru ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%s%s%s %s\n' "$R" "$(T "Ошибка:" "Error:")" "$N" "$*" >&2; exit 1; }

# ask VAR "question" default — keeps a preset $VAR, otherwise prompts (or takes the default with --yes)
ask() {
    local var=$1 question=$2 def=${3:-} answer
    if [ -n "${!var:-}" ]; then return; fi
    if [ $ASSUME_YES = 1 ] || [ ! -t 0 ]; then printf -v "$var" '%s' "$def"; return; fi
    read -r -p "$question${def:+ [$def]}: " answer
    printf -v "$var" '%s' "${answer:-$def}"
}

# choose VAR "question" default "value|label"... — numbered menu, stores the chosen value
choose() {
    local var=$1 question=$2 def=$3; shift 3
    if [ -n "${!var:-}" ]; then return; fi
    if [ $ASSUME_YES = 1 ] || [ ! -t 0 ]; then printf -v "$var" '%s' "$def"; return; fi
    say "$question"
    local i=1 opt defn=1
    for opt in "$@"; do
        say "  $i) ${opt#*|}"
        [ "${opt%%|*}" = "$def" ] && defn=$i
        i=$((i + 1))
    done
    local n
    while true; do
        read -r -p "$(T "Выбор" "Choice") [$defn]: " n
        n=${n:-$defn}
        if [[ $n =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le $# ]; then
            opt=${!n}
            printf -v "$var" '%s' "${opt%%|*}"
            return
        fi
    done
}

yesno() { case "${1,,}" in y|yes|д|да|1|true) return 0;; *) return 1;; esac; }
YES() { T "да" "yes"; }
NO()  { T "нет" "no"; }
YN()  { T "(да/нет)" "(yes/no)"; }
have_systemd() { [ -d /run/systemd/system ]; }

# ---------------------------------------------------------------- arguments & defaults

UNINSTALL=0
for arg in "$@"; do
    case $arg in
        -y|--yes) ASSUME_YES=1 ;;
        --uninstall) UNINSTALL=1 ;;
        -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]:-install.sh}" 2>/dev/null | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "$(T "неизвестный параметр" "unknown option") $arg" ;;
    esac
done

# Answers from a previous run become defaults (environment still wins).
if [ -f "$CONF" ]; then
    while IFS='=' read -r k v; do
        [[ $k =~ ^($SAVED_KEYS)$ ]] || continue
        [ -n "${!k:-}" ] || printf -v "PREV_$k" '%s' "$v"
    done < "$CONF"
fi
prev() { local v="PREV_$1"; printf '%s' "${!v:-$2}"; }

# Installer language until asked: previous run, else the system locale.
DEFAULT_UI=$(prev UI_LANG "$(case "${LC_ALL:-${LANG:-}}" in ru*) echo ru;; *) echo en;; esac)")
UI_LANG_PRESET=${UI_LANG:-}
UI_LANG=${UI_LANG:-$DEFAULT_UI}

[ "$(id -u)" = 0 ] || die "$(T "запустите через sudo" "run it with sudo")"
command -v apt-get >/dev/null || die "$(T "поддерживаются только Debian и Ubuntu (нужен apt-get)" "only Debian and Ubuntu are supported (apt-get is required)")"

# ---------------------------------------------------------------- uninstall

if [ $UNINSTALL = 1 ]; then
    WEBROOT=${WEBROOT:-$(prev WEBROOT /var/www/kolibrios)}; PREFIX=${PREFIX:-$(prev PREFIX /)}
    SITE_DIR=${WEBROOT%/}${PREFIX%/}
    step "$(T "Удаление KolibriOS-сайта" "Removing the KolibriOS site")"
    say "$(T "Будут удалены: сервисы kolibri-*, /usr/local/bin/kolibri-update, /usr/local/lib/kolibri," \
             "To be removed: kolibri-* services, /usr/local/bin/kolibri-update, /usr/local/lib/kolibri,")"
    say "$(T "конфигурация nginx этого сайта, $STATE, $CONF." "this site's nginx configuration, $STATE, $CONF.")"
    say "$(T "Каталог сайта $SITE_DIR (со скачанными сборками) удаляется отдельно по вашему выбору." \
             "The site directory $SITE_DIR (with downloaded builds) is removed only if you choose so.")"
    ask CONFIRM "$(T "Продолжить?" "Continue?") $(YN)" "$([ $ASSUME_YES = 1 ] && YES || NO)"
    yesno "$CONFIRM" || { say "$(T "Отменено." "Cancelled.")"; exit 0; }
    if have_systemd; then
        systemctl disable --now kolibri-update.timer kolibri-admin.service 2>/dev/null || true
    fi
    rm -f /etc/systemd/system/kolibri-{update.service,update.timer,admin.service}
    have_systemd && systemctl daemon-reload
    rm -f /usr/local/bin/kolibri-update /etc/nginx/snippets/kolibrios.conf /etc/nginx/kolibri-admin.htpasswd
    rm -f /etc/nginx/sites-enabled/kolibrios /etc/nginx/sites-available/kolibrios
    rm -rf /usr/local/lib/kolibri "$STATE" "$CONF"
    ask REMOVE_SITE "$(T "Удалить и каталог сайта $SITE_DIR?" "Also remove the site directory $SITE_DIR?") $(YN)" "$(NO)"
    yesno "$REMOVE_SITE" && rm -rf "$SITE_DIR"
    if nginx -t 2>/dev/null; then
        have_systemd && systemctl reload nginx || nginx -s reload 2>/dev/null || true
    else
        warn "$(T "nginx -t сообщает об ошибке: если вы подключали snippet вручную, уберите строку include." \
                  "nginx -t reports an error: if you included the snippet by hand, remove that include line.")"
    fi
    ok "$(T "Удалено. Пакеты (nginx, 7zip и др.) и сертификаты Let's Encrypt оставлены." \
            "Removed. Packages (nginx, 7zip, ...) and Let's Encrypt certificates are kept.")"
    exit 0
fi

# ---------------------------------------------------------------- source files

SRC=$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)
if [ ! -f "$SRC/web/app.js" ]; then
    # Run via "bash -c $(curl ...)" or copied alone: fetch the project.
    command -v git >/dev/null || apt-get install -y -qq git >/dev/null </dev/null
    SRC=/opt/kolibrios-web
    if [ -d $SRC/.git ]; then git -C $SRC pull -q; else git clone -q --depth 1 $REPO_URL $SRC; fi
    ok "$(T "Файлы проекта" "Project files"): $SRC"
fi

# ---------------------------------------------------------------- questions

UI_LANG=$UI_LANG_PRESET
choose UI_LANG "Язык / Language:" "$DEFAULT_UI" "ru|Русский" "en|English"

step "$(T "Настройка" "Setup")"
say "$(T "Нажмите Enter, чтобы принять значение в скобках." "Press Enter to accept the value in brackets.")"
say

ask DOMAIN "$(T "Домен сайта (пусто — открывать по IP-адресу, без HTTPS)" "Site domain (empty: open by IP address, no HTTPS)")" "$(prev DOMAIN "")"
DOMAIN=${DOMAIN,,}
[ -z "$DOMAIN" ] || [[ $DOMAIN =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "$(T "некорректный домен" "invalid domain"): $DOMAIN"

choose NGINX_MODE "$(T "Как подключить к nginx?" "How to connect to nginx?")" "$(prev NGINX_MODE site)" \
    "site|$(T "Отдельный сайт для этого домена (установщик создаст server {} сам)" "Separate site for this domain (the installer creates the server {} block)")" \
    "snippet|$(T "Добавить к уже настроенному сайту (вы подключите файл include сами)" "Add to an existing site (you include the generated file yourself)")"

if [ "$NGINX_MODE" = site ]; then
    ask PREFIX "$(T "Путь на сайте" "Path on the site")" "$(prev PREFIX /)"
    ask WEBROOT "$(T "Каталог для файлов сайта" "Directory for the site files")" "$(prev WEBROOT /var/www/kolibrios)"
else
    ask PREFIX "$(T "Путь на сайте (не занятый другим содержимым)" "Path on the site (not used by other content)")" "$(prev PREFIX /kolibri/)"
    ask WEBROOT "$(T "Значение root в вашем server {} (корень сайта)" "The root of your server {} block (site root)")" "$(prev WEBROOT /var/www/html)"
fi
PREFIX="/${PREFIX#/}"; PREFIX="${PREFIX%/}/"; PREFIX=${PREFIX//\/\//\/}
[[ $PREFIX =~ ^/[A-Za-z0-9._/-]*$ ]] || die "$(T "некорректный путь" "invalid path"): $PREFIX"
WEBROOT=${WEBROOT%/}
SITE_DIR=$WEBROOT${PREFIX%/}

if [ "$NGINX_MODE" = site ] && [ -n "$DOMAIN" ]; then
    ask HTTPS "$(T "Получить бесплатный HTTPS-сертификат Let's Encrypt?" "Get a free Let's Encrypt HTTPS certificate?") $(YN)" "$(prev HTTPS "$(YES)")"
    if yesno "$HTTPS"; then
        ask LE_EMAIL "$(T "Email для Let's Encrypt (уведомления об истечении сертификата)" "Email for Let's Encrypt (certificate expiry notices)")" "$(prev LE_EMAIL "")"
    fi
else
    HTTPS=${HTTPS:-no}
fi
if [ "$NGINX_MODE" = site ] && [ -z "$DOMAIN" ] && { [ -L /etc/nginx/sites-enabled/default ] || [ ! -d /etc/nginx ]; }; then
    ask REMOVE_DEFAULT "$(T "Без домена сайт займёт адрес сервера целиком. Отключить стандартный сайт nginx «default»?" \
                            "Without a domain the site takes over the server address. Disable nginx's stock \"default\" site?") $(YN)" "$(YES)"
fi

choose KOLIBRI_LANG "$(T "Язык сборок KolibriOS:" "KolibriOS build language:")" "$(prev KOLIBRI_LANG "$(T ru_RU en_US)")" \
    "ru_RU|Русский" "en_US|English" "es_ES|Español" "it_IT|Italiano" "et_EE|Eesti"

ask ADMIN_USER "$(T "Логин админ-страницы" "Admin page login")" "$(prev ADMIN_USER admin)"
[[ $ADMIN_USER =~ ^[A-Za-z0-9._-]+$ ]] || die "$(T "логин: только латиница, цифры, . _ -" "login: Latin letters, digits, . _ - only")"
if [ -z "${ADMIN_PASSWORD:-}" ] && ! [ -s /etc/nginx/kolibri-admin.htpasswd ] && [ $ASSUME_YES = 0 ] && [ -t 0 ]; then
    read -r -s -p "$(T "Пароль админ-страницы (пусто — сгенерировать)" "Admin page password (empty: generate one)"): " ADMIN_PASSWORD; echo
fi
ask ADMIN_PORT "$(T "Локальный порт бэкенда админки" "Local port for the admin backend")" "$(prev ADMIN_PORT 8095)"
[[ $ADMIN_PORT =~ ^[0-9]+$ ]] || die "$(T "порт должен быть числом" "the port must be a number")"

HOST=${DOMAIN:-$(hostname -I 2>/dev/null | awk '{print $1}')}
SCHEME=http; yesno "$HTTPS" && SCHEME=https
[ "$NGINX_MODE" = snippet ] && SCHEME="https"
URL="$SCHEME://$HOST$PREFIX"

step "$(T "Проверьте настройки" "Review the settings")"
cat <<EOF
  $(T "Язык сайта и установщика: " "Site/installer language:  ") $([ "$UI_LANG" = ru ] && echo Русский || echo English)
  $(T "Адрес сайта:              " "Site address:             ") $URL
  $(T "Подключение nginx:        " "nginx integration:        ") $([ "$NGINX_MODE" = site ] && T "отдельный сайт" "separate site" || T "snippet для существующего сайта" "snippet for an existing site")
  $(T "Файлы сайта:              " "Site files:               ") $SITE_DIR
  HTTPS:                     $(yesno "$HTTPS" && echo "Let's Encrypt" || NO)
  $(T "Сборки KolibriOS:         " "KolibriOS builds:         ") $KOLIBRI_LANG, $(T "автообновление раз в сутки" "updated daily")
  $(T "Админ-страница:           " "Admin page:               ") ${URL%/}/admin/ ($(T "логин" "login") $ADMIN_USER)
EOF
ask CONFIRM "$(T "Устанавливать?" "Install?") $(YN)" "$(YES)"
yesno "$CONFIRM" || { say "$(T "Отменено." "Cancelled.")"; exit 0; }

# Remember answers (not the password) for the next run.
cat > "$CONF" <<EOF
UI_LANG=$UI_LANG
DOMAIN=$DOMAIN
NGINX_MODE=$NGINX_MODE
PREFIX=$PREFIX
WEBROOT=$WEBROOT
HTTPS=$HTTPS
LE_EMAIL=${LE_EMAIL:-}
KOLIBRI_LANG=$KOLIBRI_LANG
ADMIN_USER=$ADMIN_USER
ADMIN_PORT=$ADMIN_PORT
EOF

exec </dev/null  # all questions are asked; keep apt & co from reading the terminal

# ---------------------------------------------------------------- packages

step "$(T "Установка пакетов" "Installing packages")"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
pkgs=(nginx curl ca-certificates python3 dosfstools mtools fdisk openssl gzip)
yesno "$HTTPS" && pkgs+=(certbot python3-certbot-nginx)
apt-get install -y -qq "${pkgs[@]}" >/dev/null
# "7zip" on newer releases, "p7zip-full" on older ones.
apt-get install -y -qq 7zip >/dev/null 2>&1 || apt-get install -y -qq p7zip-full >/dev/null
command -v 7z >/dev/null || command -v 7zz >/dev/null || die "$(T "не удалось установить 7-Zip" "could not install 7-Zip")"
command -v sfdisk >/dev/null || apt-get install -y -qq util-linux >/dev/null
ok "$(T "Пакеты установлены" "Packages installed")"

# ---------------------------------------------------------------- site files

step "$(T "Файлы сайта" "Site files")"
install -d "$SITE_DIR" "$SITE_DIR/admin"
install -m 644 "$SRC"/web/{index.html,app.js,i18n.js,kmouse.js,kkeys.js} "$SITE_DIR/"
install -m 644 "$SRC/web/admin/index.html" "$SITE_DIR/admin/"
# Default UI language of the page and the admin page (visitors can switch it).
sed -i "s/data-default-lang=\"[a-z]*\"/data-default-lang=\"$UI_LANG\"/" "$SITE_DIR/index.html" "$SITE_DIR/admin/index.html"
bash "$SRC/scripts/fetch-v86.sh" "$SITE_DIR" >/dev/null
gzip -9 -k -f "$SITE_DIR/admin/index.html"
install -d -o www-data -g www-data "$SITE_DIR/os" "$STATE"
chown -R www-data:www-data "$SITE_DIR"
ok "$SITE_DIR"

# ---------------------------------------------------------------- updater & admin

step "$(T "Обновления и админ-страница" "Updates and the admin page")"
install -m 755 "$SRC/server/kolibri-update" /usr/local/bin/kolibri-update
install -D -m 644 "$SRC/server/kolibri-admin.py" /usr/local/lib/kolibri/kolibri-admin.py

ENV_LINES="Environment=KOLIBRI_ROOT=$SITE_DIR
Environment=KOLIBRI_LANG=$KOLIBRI_LANG
Environment=KOLIBRI_UI_LANG=$UI_LANG
Environment=KOLIBRI_ADMIN_PORT=$ADMIN_PORT"
HARDEN="NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$SITE_DIR/os $STATE"

cat > /etc/systemd/system/kolibri-update.service <<EOF
[Unit]
Description=Update KolibriOS images for the browser emulator
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=www-data
Group=www-data
$ENV_LINES
ExecStart=/usr/local/bin/kolibri-update
$HARDEN
EOF
cat > /etc/systemd/system/kolibri-update.timer <<'EOF'
[Unit]
Description=Daily KolibriOS image update

[Timer]
OnCalendar=*-*-* 04:30
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
cat > /etc/systemd/system/kolibri-admin.service <<EOF
[Unit]
Description=KolibriOS emulator admin backend
After=network.target

[Service]
User=www-data
Group=www-data
$ENV_LINES
ExecStart=/usr/bin/python3 /usr/local/lib/kolibri/kolibri-admin.py
Restart=on-failure
$HARDEN

[Install]
WantedBy=multi-user.target
EOF

# Admin password: keep the existing one unless a new one was given.
HTPASSWD=/etc/nginx/kolibri-admin.htpasswd
if [ -n "${ADMIN_PASSWORD:-}" ] || [ ! -s $HTPASSWD ]; then
    [ -n "${ADMIN_PASSWORD:-}" ] || ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)
    printf '%s:%s\n' "$ADMIN_USER" "$(openssl passwd -apr1 "$ADMIN_PASSWORD")" > $HTPASSWD
    chown root:www-data $HTPASSWD; chmod 640 $HTPASSWD
    (umask 077; printf 'URL: %sadmin/\nlogin: %s\npassword: %s\n' "$URL" "$ADMIN_USER" "$ADMIN_PASSWORD" > $CREDS)
    PASSWORD_NOTE="$(T "пароль" "password"): $ADMIN_PASSWORD ($(T "сохранён в" "saved to") $CREDS)"
else
    PASSWORD_NOTE="$(T "пароль прежний (см. $CREDS)" "password unchanged (see $CREDS)")"
fi
ok "kolibri-update, kolibri-admin, $(T "таймер" "timer")"

# ---------------------------------------------------------------- nginx

step "nginx"
# Location blocks for $PREFIX; the same text serves both modes. "^~" keeps regex
# locations of an existing site (e.g. caching rules for *.js) from taking these
# paths over, which would also bypass the admin password.
LOCATIONS=$(cat <<EOF
    location ^~ $PREFIX {
        gzip_static on;
        gzip_vary on;
        add_header Cache-Control "no-cache";
        try_files \$uri \$uri/ =404;
    }

    # Build directories never change once published; media.img is read with range requests.
    location ^~ ${PREFIX}os/ {
        gzip_static on;
        gzip_vary on;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files \$uri =404;
    }

    location = ${PREFIX}os/current.json {
        add_header Cache-Control "no-cache";
    }

    location ^~ ${PREFIX}admin/ {
        auth_basic "KolibriOS admin";
        auth_basic_user_file $HTPASSWD;
        add_header Cache-Control "no-store";
        try_files \$uri \$uri/ =404;
    }

    location ^~ ${PREFIX}admin/api/ {
        auth_basic "KolibriOS admin";
        auth_basic_user_file $HTPASSWD;
        proxy_pass http://127.0.0.1:$ADMIN_PORT/;
        proxy_read_timeout 60s;
    }
EOF
)

if [ "$NGINX_MODE" = site ]; then
    SERVER_NAME=${DOMAIN:-_}
    DEFAULT=
    if [ -z "$DOMAIN" ]; then
        # Without a domain the site must answer any Host: become the default server.
        DEFAULT=" default_server"
        if [ -L /etc/nginx/sites-enabled/default ] && yesno "${REMOVE_DEFAULT:-no}"; then
            rm -f /etc/nginx/sites-enabled/default
        fi
        if grep -rqs 'default_server' /etc/nginx/sites-enabled/ --exclude=kolibrios; then
            die "$(T "в nginx уже есть другой default_server; укажите домен или отключите тот сайт" \
                     "nginx already has another default_server; give a domain or disable that site")"
        fi
    fi
    cat > /etc/nginx/sites-available/kolibrios <<EOF
# KolibriOS in the browser — generated by install.sh, rerun it to regenerate.
server {
    listen 80$DEFAULT;
    listen [::]:80$DEFAULT;
    server_name $SERVER_NAME;
    root $WEBROOT;
    index index.html;
    server_tokens off;

$LOCATIONS
}
EOF
    ln -sf /etc/nginx/sites-available/kolibrios /etc/nginx/sites-enabled/kolibrios
else
    install -d /etc/nginx/snippets
    printf '# KolibriOS in the browser — generated by install.sh.\n# Include inside your server { } block whose root is %s\n%s\n' \
        "$WEBROOT" "$LOCATIONS" > /etc/nginx/snippets/kolibrios.conf
fi

nginx -t 2>/tmp/kolibrios-nginx.log || { cat /tmp/kolibrios-nginx.log >&2; die "$(T "nginx -t не прошёл, конфигурация не применена" "nginx -t failed, the configuration was not applied")"; }
if have_systemd; then systemctl enable -q nginx; systemctl reload nginx 2>/dev/null || systemctl restart nginx
else nginx -s reload 2>/dev/null || nginx; fi
ok "$(T "nginx настроен" "nginx configured")"

if [ "$NGINX_MODE" = site ] && yesno "$HTTPS"; then
    step "HTTPS (Let's Encrypt)"
    le_args=(--nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos)
    if [ -n "${LE_EMAIL:-}" ]; then le_args+=(-m "$LE_EMAIL"); else le_args+=(--register-unsafely-without-email); fi
    if certbot "${le_args[@]}"; then
        ok "$(T "Сертификат получен, HTTP перенаправляется на HTTPS" "Certificate obtained; HTTP redirects to HTTPS")"
    else
        warn "$(T "Сертификат получить не удалось: проверьте, что $DOMAIN указывает на этот сервер" \
                  "Could not get a certificate: check that $DOMAIN points to this server")"
        warn "$(T "и порт 80 открыт. Сайт работает по HTTP; повторите: certbot --nginx -d $DOMAIN" \
                  "and port 80 is open. The site works over HTTP; retry with: certbot --nginx -d $DOMAIN")"
        URL="http://$HOST$PREFIX"
    fi
fi

# ---------------------------------------------------------------- first build

step "$(T "Сборка KolibriOS (первый раз скачивается ~50 МБ)" "KolibriOS build (~50 MB download the first time)")"
if runuser -u www-data -- env KOLIBRI_ROOT="$SITE_DIR" KOLIBRI_LANG="$KOLIBRI_LANG" KOLIBRI_UI_LANG="$UI_LANG" \
        KOLIBRI_STATE="$STATE" /usr/local/bin/kolibri-update; then
    ok "$(T "Сборка установлена" "Build installed")"
else
    warn "$(T "Скачать сборку не удалось; повторите позже: sudo systemctl start kolibri-update" \
              "Could not download a build; retry later: sudo systemctl start kolibri-update")"
fi

if have_systemd; then
    systemctl daemon-reload
    systemctl enable -q --now kolibri-update.timer
    systemctl enable -q kolibri-admin.service
    systemctl restart kolibri-admin.service
    ok "$(T "Автообновление и админка запущены" "Daily updates and the admin backend are running")"
else
    warn "$(T "systemd не найден: автообновление и админка не запущены." "systemd not found: daily updates and the admin backend are not running.")"
    warn "$(T "Запускайте вручную от www-data с переменными окружения:" "Run them by hand as www-data with these variables:")"
    ENVS="KOLIBRI_ROOT=$SITE_DIR KOLIBRI_LANG=$KOLIBRI_LANG KOLIBRI_UI_LANG=$UI_LANG"
    warn "  $ENVS kolibri-update"
    warn "  $ENVS KOLIBRI_ADMIN_PORT=$ADMIN_PORT python3 /usr/local/lib/kolibri/kolibri-admin.py"
fi

# ---------------------------------------------------------------- done

step "$(T "Готово" "Done")"
say "  $(T "Сайт:          " "Site:          ") $URL"
say "  $(T "Админ-страница:" "Admin page:    ") ${URL%/}/admin/  $(T "логин" "login") $ADMIN_USER, $PASSWORD_NOTE"
if [ "$NGINX_MODE" = snippet ]; then
    say
    say "  $(T "Осталось подключить конфигурацию: добавьте в ваш server { } (где root $WEBROOT) строку" \
               "One step left: add this line to your server { } block (the one with root $WEBROOT):")"
    say "      include /etc/nginx/snippets/kolibrios.conf;"
    say "  $(T "и выполните:" "then run:") sudo nginx -t && sudo systemctl reload nginx"
fi
say
say "  $(T "Обновить установку: запустите install.sh снова. Удалить: install.sh --uninstall" \
           "To update: run install.sh again. To remove: install.sh --uninstall")"
