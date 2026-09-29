#!/bin/bash
# Interactive installer: sets up a KolibriOS-in-the-browser site on a
# Debian/Ubuntu server (nginx + v86 + daily KolibriOS updates + admin page).
#
#   sudo ./install.sh              ask questions, then install or update
#   sudo ./install.sh --yes        take defaults / environment values, no questions
#   sudo ./install.sh --uninstall  remove what the installer created
#
# Every answer can be preset in the environment: DOMAIN, NGINX_MODE (site|snippet),
# PREFIX, WEBROOT, HTTPS (yes|no), LE_EMAIL, KOLIBRI_LANG, ADMIN_USER,
# ADMIN_PASSWORD, ADMIN_PORT. Running it again updates an existing install and
# keeps downloaded builds and the admin password (unless a new one is given).
set -euo pipefail

REPO_URL=https://github.com/Xtratter/kolibrios-web
CONF=/etc/kolibrios-web.conf        # answers of the last run, reused as defaults
STATE=/var/lib/kolibri-update
CREDS=/root/kolibrios-admin.txt
ASSUME_YES=0

# ---------------------------------------------------------------- helpers

if [ -t 1 ]; then B=$'\e[1m' G=$'\e[32m' Y=$'\e[33m' R=$'\e[31m' N=$'\e[0m'; else B= G= Y= R= N=; fi
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok()   { printf '%s✓%s %s\n' "$G" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%sОшибка:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# ask VAR "Вопрос" default — keeps a preset $VAR, otherwise prompts (or takes the default with --yes)
ask() {
    local var=$1 question=$2 def=${3:-} answer
    if [ -n "${!var:-}" ]; then return; fi
    if [ $ASSUME_YES = 1 ] || [ ! -t 0 ]; then printf -v "$var" '%s' "$def"; return; fi
    read -r -p "$question${def:+ [$def]}: " answer
    printf -v "$var" '%s' "${answer:-$def}"
}

# choose VAR "Вопрос" default option... — numbered menu, stores the chosen option
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
        read -r -p "Выбор [$defn]: " n
        n=${n:-$defn}
        if [[ $n =~ ^[0-9]+$ ]] && [ "$n" -ge 1 ] && [ "$n" -le $# ]; then
            opt=${!n}
            printf -v "$var" '%s' "${opt%%|*}"
            return
        fi
    done
}

yesno() { case "${1,,}" in y|yes|д|да|1|true) return 0;; *) return 1;; esac; }
have_systemd() { [ -d /run/systemd/system ]; }

# ---------------------------------------------------------------- arguments

UNINSTALL=0
for arg in "$@"; do
    case $arg in
        -y|--yes) ASSUME_YES=1 ;;
        --uninstall) UNINSTALL=1 ;;
        -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "неизвестный параметр $arg" ;;
    esac
done

[ "$(id -u)" = 0 ] || die "запустите через sudo"
command -v apt-get >/dev/null || die "поддерживаются только Debian и Ubuntu (нужен apt-get)"

# Answers from a previous run become defaults (environment still wins).
if [ -f "$CONF" ]; then
    while IFS='=' read -r k v; do
        [[ $k =~ ^(DOMAIN|NGINX_MODE|PREFIX|WEBROOT|HTTPS|LE_EMAIL|KOLIBRI_LANG|ADMIN_USER|ADMIN_PORT)$ ]] || continue
        [ -n "${!k:-}" ] || printf -v "PREV_$k" '%s' "$v"
    done < "$CONF"
fi
prev() { local v="PREV_$1"; printf '%s' "${!v:-$2}"; }

# ---------------------------------------------------------------- uninstall

if [ $UNINSTALL = 1 ]; then
    WEBROOT=${WEBROOT:-$(prev WEBROOT /var/www/kolibrios)}; PREFIX=${PREFIX:-$(prev PREFIX /)}
    SITE_DIR=${WEBROOT%/}${PREFIX%/}
    step "Удаление KolibriOS-сайта"
    say "Будут удалены: сервисы kolibri-*, /usr/local/bin/kolibri-update, /usr/local/lib/kolibri,"
    say "конфигурация nginx этого сайта, $STATE, $CONF."
    say "Каталог сайта $SITE_DIR (со скачанными сборками) удаляется отдельно по вашему выбору."
    ask CONFIRM "Продолжить? (да/нет)" "$([ $ASSUME_YES = 1 ] && echo да || echo нет)"
    yesno "$CONFIRM" || { say "Отменено."; exit 0; }
    if have_systemd; then
        systemctl disable --now kolibri-update.timer kolibri-admin.service 2>/dev/null || true
    fi
    rm -f /etc/systemd/system/kolibri-{update.service,update.timer,admin.service}
    have_systemd && systemctl daemon-reload
    rm -f /usr/local/bin/kolibri-update /etc/nginx/snippets/kolibrios.conf /etc/nginx/kolibri-admin.htpasswd
    rm -f /etc/nginx/sites-enabled/kolibrios /etc/nginx/sites-available/kolibrios
    rm -rf /usr/local/lib/kolibri "$STATE" "$CONF"
    ask REMOVE_SITE "Удалить и каталог сайта $SITE_DIR? (да/нет)" "нет"
    yesno "$REMOVE_SITE" && rm -rf "$SITE_DIR"
    if nginx -t 2>/dev/null; then
        have_systemd && systemctl reload nginx || nginx -s reload 2>/dev/null || true
    else
        warn "nginx -t сообщает об ошибке: если вы подключали snippet вручную, уберите строку include."
    fi
    ok "Удалено. Пакеты (nginx, 7zip и др.) и сертификаты Let's Encrypt оставлены."
    exit 0
fi

# ---------------------------------------------------------------- source files

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
if [ ! -f "$SRC/web/app.js" ]; then
    # Run via "curl ... | bash" or copied alone: fetch the project.
    command -v git >/dev/null || apt-get install -y -qq git >/dev/null
    SRC=/opt/kolibrios-web
    if [ -d $SRC/.git ]; then git -C $SRC pull -q; else git clone -q --depth 1 $REPO_URL $SRC; fi
    ok "Файлы проекта: $SRC"
fi

# ---------------------------------------------------------------- questions

step "Настройка"
say "Нажмите Enter, чтобы принять значение в скобках."
say

ask DOMAIN "Домен сайта (пусто — открывать по IP-адресу, без HTTPS)" "$(prev DOMAIN "")"
DOMAIN=${DOMAIN,,}
[ -z "$DOMAIN" ] || [[ $DOMAIN =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "некорректный домен: $DOMAIN"

choose NGINX_MODE "Как подключить к nginx?" "$(prev NGINX_MODE site)" \
    "site|Отдельный сайт для этого домена (installer создаст server {} сам)" \
    "snippet|Добавить к уже настроенному сайту (вы подключите файл include сами)"

if [ "$NGINX_MODE" = site ]; then
    ask PREFIX "Путь на сайте" "$(prev PREFIX /)"
    ask WEBROOT "Каталог для файлов сайта" "$(prev WEBROOT /var/www/kolibrios)"
else
    ask PREFIX "Путь на сайте (не занятый другим содержимым)" "$(prev PREFIX /kolibri/)"
    ask WEBROOT "Значение root в вашем server {} (корень сайта)" "$(prev WEBROOT /var/www/html)"
fi
PREFIX="/${PREFIX#/}"; PREFIX="${PREFIX%/}/"; PREFIX=${PREFIX//\/\//\/}
[[ $PREFIX =~ ^/[A-Za-z0-9._/-]*$ ]] || die "некорректный путь: $PREFIX"
WEBROOT=${WEBROOT%/}
SITE_DIR=$WEBROOT${PREFIX%/}

if [ "$NGINX_MODE" = site ] && [ -n "$DOMAIN" ]; then
    ask HTTPS "Получить бесплатный HTTPS-сертификат Let's Encrypt? (да/нет)" "$(prev HTTPS да)"
    if yesno "$HTTPS"; then
        ask LE_EMAIL "Email для Let's Encrypt (уведомления об истечении сертификата)" "$(prev LE_EMAIL "")"
    fi
else
    HTTPS=${HTTPS:-нет}
fi
if [ "$NGINX_MODE" = site ] && [ -z "$DOMAIN" ] && { [ -L /etc/nginx/sites-enabled/default ] || [ ! -d /etc/nginx ]; }; then
    ask REMOVE_DEFAULT "Без домена сайт займёт адрес сервера целиком. Отключить стандартный сайт nginx «default»? (да/нет)" "да"
fi

choose KOLIBRI_LANG "Язык сборок KolibriOS:" "$(prev KOLIBRI_LANG ru_RU)" \
    "ru_RU|Русский" "en_US|English" "es_ES|Español" "it_IT|Italiano" "et_EE|Eesti"

ask ADMIN_USER "Логин админ-страницы" "$(prev ADMIN_USER admin)"
[[ $ADMIN_USER =~ ^[A-Za-z0-9._-]+$ ]] || die "логин: только латиница, цифры, . _ -"
if [ -z "${ADMIN_PASSWORD:-}" ] && ! [ -s /etc/nginx/kolibri-admin.htpasswd ] && [ $ASSUME_YES = 0 ] && [ -t 0 ]; then
    read -r -s -p "Пароль админ-страницы (пусто — сгенерировать): " ADMIN_PASSWORD; echo
fi
ask ADMIN_PORT "Локальный порт бэкенда админки" "$(prev ADMIN_PORT 8095)"
[[ $ADMIN_PORT =~ ^[0-9]+$ ]] || die "порт должен быть числом"

HOST=${DOMAIN:-$(hostname -I 2>/dev/null | awk '{print $1}')}
SCHEME=http; yesno "$HTTPS" && SCHEME=https
[ "$NGINX_MODE" = snippet ] && SCHEME="https (или http)"
URL="$SCHEME://$HOST$PREFIX"

step "Проверьте настройки"
cat <<EOF
  Адрес сайта:        $URL
  Подключение nginx:  $([ "$NGINX_MODE" = site ] && echo "отдельный сайт" || echo "snippet для существующего сайта")
  Файлы сайта:        $SITE_DIR
  HTTPS:              $(yesno "$HTTPS" && echo "Let's Encrypt" || echo "нет")
  Сборки KolibriOS:   $KOLIBRI_LANG, автообновление раз в сутки
  Админ-страница:     ${URL%/}/admin/ (логин $ADMIN_USER)
EOF
ask CONFIRM "Устанавливать? (да/нет)" "да"
yesno "$CONFIRM" || { say "Отменено."; exit 0; }

# Remember answers (not the password) for the next run.
cat > "$CONF" <<EOF
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

step "Установка пакетов"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
pkgs=(nginx curl ca-certificates python3 dosfstools mtools fdisk openssl gzip)
yesno "$HTTPS" && pkgs+=(certbot python3-certbot-nginx)
apt-get install -y -qq "${pkgs[@]}" >/dev/null
# "7zip" on newer releases, "p7zip-full" on older ones.
apt-get install -y -qq 7zip >/dev/null 2>&1 || apt-get install -y -qq p7zip-full >/dev/null
command -v 7z >/dev/null || command -v 7zz >/dev/null || die "не удалось установить 7-Zip"
command -v sfdisk >/dev/null || apt-get install -y -qq util-linux >/dev/null
ok "Пакеты установлены"

# ---------------------------------------------------------------- site files

step "Файлы сайта"
install -d "$SITE_DIR" "$SITE_DIR/admin"
install -m 644 "$SRC"/web/{index.html,app.js,kmouse.js,kkeys.js} "$SITE_DIR/"
install -m 644 "$SRC/web/admin/index.html" "$SITE_DIR/admin/"
bash "$SRC/scripts/fetch-v86.sh" "$SITE_DIR" >/dev/null
gzip -9 -k -f "$SITE_DIR/admin/index.html"
install -d -o www-data -g www-data "$SITE_DIR/os" "$STATE"
chown -R www-data:www-data "$SITE_DIR"
ok "$SITE_DIR"

# ---------------------------------------------------------------- updater & admin

step "Обновления и админ-страница"
install -m 755 "$SRC/server/kolibri-update" /usr/local/bin/kolibri-update
install -D -m 644 "$SRC/server/kolibri-admin.py" /usr/local/lib/kolibri/kolibri-admin.py

ENV_LINES="Environment=KOLIBRI_ROOT=$SITE_DIR
Environment=KOLIBRI_LANG=$KOLIBRI_LANG
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
    PASSWORD_NOTE="пароль: $ADMIN_PASSWORD (сохранён в $CREDS)"
else
    PASSWORD_NOTE="пароль прежний (см. $CREDS)"
fi
ok "kolibri-update, kolibri-admin, таймер"

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
        if [ -L /etc/nginx/sites-enabled/default ] && yesno "${REMOVE_DEFAULT:-нет}"; then
            rm -f /etc/nginx/sites-enabled/default
        fi
        if grep -rqs 'default_server' /etc/nginx/sites-enabled/ --exclude=kolibrios; then
            die "в nginx уже есть другой default_server; укажите домен или отключите тот сайт"
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

nginx -t 2>/tmp/kolibrios-nginx.log || { cat /tmp/kolibrios-nginx.log >&2; die "nginx -t не прошёл, конфигурация не применена"; }
if have_systemd; then systemctl enable -q nginx; systemctl reload nginx 2>/dev/null || systemctl restart nginx
else nginx -s reload 2>/dev/null || nginx; fi
ok "nginx настроен"

if [ "$NGINX_MODE" = site ] && yesno "$HTTPS"; then
    step "HTTPS (Let's Encrypt)"
    le_args=(--nginx -d "$DOMAIN" --redirect --non-interactive --agree-tos)
    if [ -n "${LE_EMAIL:-}" ]; then le_args+=(-m "$LE_EMAIL"); else le_args+=(--register-unsafely-without-email); fi
    if certbot "${le_args[@]}"; then
        ok "Сертификат получен, HTTP перенаправляется на HTTPS"
    else
        warn "Сертификат получить не удалось: проверьте, что $DOMAIN указывает на этот сервер"
        warn "и порт 80 открыт. Сайт работает по HTTP; повторите: certbot --nginx -d $DOMAIN"
        URL="http://$HOST$PREFIX"
    fi
fi

# ---------------------------------------------------------------- first build

step "Сборка KolibriOS (первый раз скачивается ~50 МБ)"
if runuser -u www-data -- env KOLIBRI_ROOT="$SITE_DIR" KOLIBRI_LANG="$KOLIBRI_LANG" KOLIBRI_STATE="$STATE" \
        /usr/local/bin/kolibri-update; then
    ok "Сборка установлена"
else
    warn "Скачать сборку не удалось; повторите позже: sudo systemctl start kolibri-update"
fi

if have_systemd; then
    systemctl daemon-reload
    systemctl enable -q --now kolibri-update.timer
    systemctl enable -q kolibri-admin.service
    systemctl restart kolibri-admin.service
    ok "Автообновление и админка запущены"
else
    warn "systemd не найден: автообновление и админка не запущены."
    warn "Запускайте вручную от www-data с переменными окружения:"
    warn "  KOLIBRI_ROOT=$SITE_DIR KOLIBRI_LANG=$KOLIBRI_LANG kolibri-update"
    warn "  KOLIBRI_ROOT=$SITE_DIR KOLIBRI_LANG=$KOLIBRI_LANG KOLIBRI_ADMIN_PORT=$ADMIN_PORT python3 /usr/local/lib/kolibri/kolibri-admin.py"
fi

# ---------------------------------------------------------------- done

step "Готово"
say "  Сайт:           $URL"
say "  Админ-страница: ${URL%/}/admin/  логин $ADMIN_USER, $PASSWORD_NOTE"
if [ "$NGINX_MODE" = snippet ]; then
    say
    say "  Осталось подключить конфигурацию: добавьте в ваш server { } (где root $WEBROOT) строку"
    say "      include /etc/nginx/snippets/kolibrios.conf;"
    say "  и выполните: sudo nginx -t && sudo systemctl reload nginx"
fi
say
say "  Обновить установку: запустите install.sh снова. Удалить: install.sh --uninstall"
