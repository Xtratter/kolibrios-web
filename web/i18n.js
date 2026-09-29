// UI strings for the page and the admin page. The language is the visitor's
// choice from the menu (localStorage), else <html data-default-lang> set by
// install.sh, else Russian. Elements opt in with data-i18n (text),
// data-i18n-html (trusted markup from this file), data-i18n-title and
// data-i18n-aria; apply() fills them in.
(function (root) {
  const DICT = {
    ru: {
      "title": "KolibriOS в браузере",
      "loading": "Загрузка…",
      "pad": "Тачпад", "pad.title": "Режим тачпада",
      "kbd": "Клавиатура", "kbd.aria": "Ввод с клавиатуры",
      "full": "Экран", "full.title": "Во весь экран",
      "menu": "Меню", "close": "Закрыть",
      "lmb": "ЛКМ", "rmb": "ПКМ", "dbl.title": "Двойной щелчок",
      "footer": 'Мышь работает сразу, без захвата. Эмуляция идёт в вашем браузере (<a href="https://github.com/copy/v86">v86</a>); состояние можно сохранить через меню.',
      "h.system": "Система", "reset": "Перезагрузка",
      "h.state": "Состояние", "save": "Сохранить", "load": "Восстановить",
      "export": "Скачать файл", "import": "Из файла…",
      "state.hint": "Сохранение хранится в этом браузере; файл можно перенести на другое устройство.",
      "h.media": "Медиа-пакет",
      "media.desc": 'Подключить диск с дополнительными программами: плееры (fplay, minimp3), просмотр картинок и PDF, игры, 3D, эмуляторы, средства разработки. Всего <span id="media-size">…</span>, скачиваются только открываемые файлы. Папка <code>/kolibrios</code>.',
      "media.note": "Изменение применится после перезапуска.", "apply": "Перезапустить",
      "h.phone": "Управление с телефона",
      "phone.hint": "Кнопка «Тачпад» в шапке переключает режим.",
      "phone.help": `<li><b>Тачпад:</b> ведите пальцем — курсор движется (быстрее ведёте — дальше уходит),
        касание — щелчок, два пальца — прокрутка, касание двумя пальцами — правая кнопка.
        Работает по всей области, включая пустые поля над и под экраном системы.
        Кнопки <b>ЛКМ</b>/<b>ПКМ</b> внизу можно удерживать и одновременно вести пальцем по экрану — так перетаскиваются окна</li>
        <li><b>Прямое касание</b> (тачпад выключен): <b>касание</b> — щелчок в этой точке, <b>двойное касание</b> — двойной щелчок,
        <b>долгое нажатие</b> или <b>касание двумя пальцами</b> — правая кнопка, <b>провести пальцем</b> — перетаскивание,
        <b>два пальца вверх/вниз</b> — прокрутка</li>
        <li><b>Клавиатура</b> в шапке открывает экранную клавиатуру и панель Esc/Ctrl/стрелок;
        русские и латинские буквы вводятся без переключения раскладки</li>
        <li>В портретной ориентации экран мелкий — удобнее повернуть телефон или нажать «Экран»</li>`,
      "h.lang": "Язык",
      "h.version": "Версия",
      "version.text": 'KolibriOS <span id="build-info">…</span>. Новые сборки с kolibrios.org устанавливаются на сервере автоматически.',
      "mb": "МБ",
      "build.gone": "Сборка сохранения больше недоступна",
      "build.fail": "Не удалось получить описание сборки",
      "build.title": "KolibriOS {build} от {date}",
      "build.info": "{build}, сборка от {date}",
      "dl.progress": "Загрузка {p}%",
      "dl.error": "Ошибка загрузки файлов",
      "media.reading": "Чтение медиа-диска…",
      "media.on": "Медиа-пакет подключён",
      "full.na": "Полноэкранный режим недоступен",
      "error": "Ошибка: {msg}",
      "restarting": "Перезапуск с нужной сборкой…",
      "restoring": "Восстановление", "restored": "Восстановлено от {time}",
      "nothing": "Нечего восстанавливать", "no.save": "Нет сохранения в этом браузере",
      "saving": "Сохранение", "saved": "Сохранено ({size})",
      "preparing": "Подготовка файла", "downloaded": "Файл скачан ({size})",
      "loading.file": "Загрузка файла",

      "a.title": "KolibriOS: обновления",
      "a.h.state": "Состояние", "a.current": "Текущая сборка", "a.upstream": "Последняя на kolibrios.org",
      "a.process": "Процесс", "a.update": "Проверить и обновить",
      "a.force": "Пересобрать", "a.force.title": "Скачать и собрать последнюю сборку заново",
      "a.hint": "Автоматическая проверка — ежедневно около 04:30. Хранятся три последние сборки; на любую можно вернуться. Посетители получают новую сборку при следующем открытии страницы.",
      "a.h.builds": "Установленные сборки", "a.h.log": "Журнал", "a.back": "← К эмулятору",
      "a.cur.value": "{build} (от {date})", "a.not.installed": "не установлена",
      "a.check.failed": "не удалось проверить", "a.is.installed": "— установлена", "a.has.update": "— доступно обновление",
      "a.running": "идёт обновление…", "a.idle": "ожидание",
      "a.checksum": "SHA-256 ISO не совпал с опубликованным (архив цел)",
      "a.build.meta": "от {date}, медиа {size}", "a.is.current": "текущая", "a.activate": "Сделать текущей",
      "a.offline": "Нет связи с сервером", "a.started": "Запущено", "a.error": "Ошибка",
    },
    en: {
      "title": "KolibriOS in the browser",
      "loading": "Loading…",
      "pad": "Touchpad", "pad.title": "Touchpad mode",
      "kbd": "Keyboard", "kbd.aria": "Keyboard input",
      "full": "Fullscreen", "full.title": "Fullscreen",
      "menu": "Menu", "close": "Close",
      "lmb": "LMB", "rmb": "RMB", "dbl.title": "Double click",
      "footer": 'The mouse works right away, no capture needed. The emulator runs in your browser (<a href="https://github.com/copy/v86">v86</a>); the machine state can be saved from the menu.',
      "h.system": "System", "reset": "Restart",
      "h.state": "Machine state", "save": "Save", "load": "Restore",
      "export": "Download file", "import": "From file…",
      "state.hint": "A saved state is kept in this browser; a file can be moved to another device.",
      "h.media": "Media pack",
      "media.desc": 'Attach a disk with extra programs: players (fplay, minimp3), image and PDF viewers, games, 3D, emulators, development tools. <span id="media-size">…</span> in total; only the files you open are downloaded. Folder <code>/kolibrios</code>.',
      "media.note": "The change takes effect after a restart.", "apply": "Restart now",
      "h.phone": "Phone controls",
      "phone.hint": "The “Touchpad” button in the header switches the mode.",
      "phone.help": `<li><b>Touchpad:</b> slide a finger to move the cursor (faster slides go further),
        tap to click, two fingers to scroll, two-finger tap for a right click.
        Works on the whole area, including the empty space above and below the guest screen.
        The <b>LMB</b>/<b>RMB</b> buttons below can be held while sliding another finger — that is how windows are dragged</li>
        <li><b>Direct touch</b> (touchpad off): <b>tap</b> clicks at that point, <b>double tap</b> double-clicks,
        <b>long press</b> or <b>two-finger tap</b> is a right click, <b>slide</b> drags,
        <b>two fingers up/down</b> scroll</li>
        <li><b>Keyboard</b> in the header opens the on-screen keyboard and a bar with Esc/Ctrl/arrows;
        Latin and Cyrillic letters can be typed without switching layouts</li>
        <li>In portrait orientation the screen is small — turn the phone or press “Fullscreen”</li>`,
      "h.lang": "Language",
      "h.version": "Version",
      "version.text": 'KolibriOS <span id="build-info">…</span>. New builds from kolibrios.org are installed on the server automatically.',
      "mb": "MB",
      "build.gone": "The build of this saved state is no longer available",
      "build.fail": "Could not load the build description",
      "build.title": "KolibriOS {build} of {date}",
      "build.info": "{build}, built on {date}",
      "dl.progress": "Loading {p}%",
      "dl.error": "Failed to download files",
      "media.reading": "Reading the media disk…",
      "media.on": "Media pack attached",
      "full.na": "Fullscreen is not available",
      "error": "Error: {msg}",
      "restarting": "Restarting with the matching build…",
      "restoring": "Restoring", "restored": "Restored the state of {time}",
      "nothing": "Nothing to restore", "no.save": "No saved state in this browser",
      "saving": "Saving", "saved": "Saved ({size})",
      "preparing": "Preparing file", "downloaded": "File downloaded ({size})",
      "loading.file": "Loading file",

      "a.title": "KolibriOS: updates",
      "a.h.state": "Status", "a.current": "Current build", "a.upstream": "Latest on kolibrios.org",
      "a.process": "Process", "a.update": "Check and update",
      "a.force": "Rebuild", "a.force.title": "Download and build the latest build again",
      "a.hint": "Automatic check runs daily around 04:30. The last three builds are kept, and any of them can be made current again. Visitors get a new build the next time they open the page.",
      "a.h.builds": "Installed builds", "a.h.log": "Log", "a.back": "← Back to the emulator",
      "a.cur.value": "{build} (of {date})", "a.not.installed": "not installed",
      "a.check.failed": "check failed", "a.is.installed": "— installed", "a.has.update": "— update available",
      "a.running": "updating…", "a.idle": "idle",
      "a.checksum": "ISO SHA-256 differs from the published one (the archive is intact)",
      "a.build.meta": "of {date}, media {size}", "a.is.current": "current", "a.activate": "Make current",
      "a.offline": "No connection to the server", "a.started": "Started", "a.error": "Error",
    },
  };
  const NAMES = { ru: "Русский", en: "English" };

  function pick() {
    let saved = null;
    try { saved = localStorage.getItem("kolibri-lang"); } catch {}
    const def = document.documentElement.dataset.defaultLang;
    return [saved, def, "ru"].find(l => l && DICT[l]);
  }
  const lang = pick();

  function t(key, vars) {
    let s = DICT[lang][key] ?? DICT.ru[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return s;
  }

  function apply(scope = document) {
    document.documentElement.lang = lang;
    for (const el of scope.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
    for (const el of scope.querySelectorAll("[data-i18n-html]")) el.innerHTML = t(el.dataset.i18nHtml);
    for (const el of scope.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
    for (const el of scope.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
  }

  function set(l) {
    try { localStorage.setItem("kolibri-lang", l); } catch {}
    location.reload();
  }

  const locale = lang === "ru" ? "ru-RU" : "en-GB";
  root.I18N = { lang, t, apply, set, NAMES, locale };
  apply();
})(window);
