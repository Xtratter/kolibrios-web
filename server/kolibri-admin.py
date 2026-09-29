#!/usr/bin/env python3
"""Backend for /kolibri/admin/: shows installed builds and runs kolibri-update.

Listens on 127.0.0.1 only; nginx puts it behind basic auth. State-changing
requests must carry "X-Requested-With: kolibri-admin", which a cross-site form
cannot send, so a logged-in browser cannot be made to trigger them elsewhere.
"""
import fcntl
import json
import os
import re
import subprocess
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.environ.get("KOLIBRI_ROOT", "/var/www/html/kolibri"), "os")
STATE = os.environ.get("KOLIBRI_STATE", "/var/lib/kolibri-update")
LOG = os.path.join(STATE, "update.log")
UPDATE = "/usr/local/bin/kolibri-update"
LANG = os.environ.get("KOLIBRI_LANG", "ru_RU")
SUMS_URL = f"https://builds.kolibrios.org/{LANG}/sha256sums.txt"

_upstream = {"at": 0, "build": None, "error": None}


def read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def upstream_build():
    if time.time() - _upstream["at"] > 600:
        try:
            with urllib.request.urlopen(SUMS_URL, timeout=15) as r:
                sums = r.read().decode()
            names = re.findall(r"kolibrios-(\S+)-img\.7z", sums)
            _upstream.update(build=names[-1] if names else None, error=None)
        except Exception as e:  # network errors are shown, not fatal
            _upstream.update(error=str(e))
        _upstream["at"] = time.time()
    return {"build": _upstream["build"], "error": _upstream["error"]}


def update_running():
    try:
        with open(os.path.join(STATE, "lock"), "a") as f:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(f, fcntl.LOCK_UN)
        return False
    except BlockingIOError:
        return True
    except OSError:
        return False


def log_tail(lines=80):
    try:
        with open(LOG, errors="replace") as f:
            return f.readlines()[-lines:]
    except OSError:
        return []


def status():
    builds = []
    for name in sorted(os.listdir(ROOT)) if os.path.isdir(ROOT) else []:
        meta = read_json(os.path.join(ROOT, name, "meta.json"))
        if meta:
            builds.append(meta)
    builds.sort(key=lambda m: m.get("installed", ""), reverse=True)
    return {
        "current": read_json(os.path.join(ROOT, "current.json")),
        "builds": builds,
        "upstream": upstream_build(),
        "running": update_running(),
        "log": log_tail(),
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") in ("", "/status"):
            return self.send_json(200, status())
        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.headers.get("X-Requested-With") != "kolibri-admin":
            return self.send_json(403, {"error": "forbidden"})
        length = min(int(self.headers.get("Content-Length") or 0), 4096)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.send_json(400, {"error": "bad json"})

        if self.path == "/update":
            if update_running():
                return self.send_json(409, {"error": "Обновление уже выполняется"})
            args = [UPDATE] + (["--force"] if body.get("force") else [])
            subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
            return self.send_json(202, {"started": True})

        if self.path == "/activate":
            build = str(body.get("build", ""))
            if not re.fullmatch(r"[\w.+-]+", build):
                return self.send_json(400, {"error": "bad build"})
            r = subprocess.run([UPDATE, "--activate", build], capture_output=True, text=True, timeout=30)
            return self.send_json(200 if r.returncode == 0 else 400,
                                  {"ok": r.returncode == 0, "output": (r.stdout + r.stderr).strip()})

        self.send_json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("KOLIBRI_ADMIN_PORT", "8095"))), Handler).serve_forever()
