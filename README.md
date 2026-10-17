# Chores

NFC-tap chore tracker for a household. Tap a tag to log a chore for today. If a
scheduled chore isn't logged by its deadline, each linked person gets a Pushover
"Chore Missed" alert. Runs on a local VM. No public domain needed.

## How it works

- **Chores** have a name, a deadline (24-hour time), and a schedule: every day, or
  only chosen weekdays. Each chore gets its own tap URL.
- **Recipients** have a name and a Pushover user key. Each chore picks who gets alerted.
- **NFC tag** holds the chore's tap URL. Tapping it opens the page and logs the completion.
- **Scheduler** runs every minute. Once a scheduled chore passes its deadline without a
  log for that day, it sends one alert per recipient, then stops for that day.
- Everything is managed from a web admin page at `/`, behind a login.

## Setup on the VM (Ubuntu)

Requires Node 20+ and build tools for `better-sqlite3`.

```bash
sudo apt install -y build-essential python3
git clone https://github.com/<you>/chores.git
cd chores
npm ci
cp .env.example .env   # then edit ADMIN_PASS, BASE_URL, TZ_NAME, PUSHOVER_APP_TOKEN
npm test               # should pass before you go further
node --env-file=.env src/server.js
```

Open `http://<vm-ip>:3000/` and sign in with `ADMIN_USER` / `ADMIN_PASS`.

### Run as a service

```bash
sudo useradd --system --home /opt/chores chores
sudo cp -r . /opt/chores && sudo chown -R chores: /opt/chores
sudo cp /opt/chores/deploy/chores.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now chores
```

Logs: `journalctl -u chores -f`

## Adding chores and people

1. Open the admin page and add a recipient with their Pushover user key.
2. Add a chore: name, deadline, every day or specific days, and who to notify.
3. Copy the chore's **NFC tag URL** from the admin page.
4. Write it to a tag with the NFC Tools app (Write → Add record → URL/Link).

Edit, turn off, or delete chores any time. Turning a chore off stops its tap and alerts.

## Phones have to reach the VM

Tags only work where the phone can reach `BASE_URL`. On your home Wi-Fi that's the
VM's LAN IP. Tapping from outside the house needs Tailscale or a VPN. Nothing is
exposed to the internet.

## Notes

- Tap URLs are secret. Anyone who has the URL can log that chore, so keep tags
  in the house.
- The admin login is basic auth over plain HTTP. Keep it on the LAN, or put it
  behind Tailscale. Don't port-forward it.
- `DRY_RUN=1` prints alerts to the console instead of sending them. Useful for testing.
- Missed-chore alerts are Pushover only. iMessage was dropped as a channel.
- Data lives in `DB_FILE` (default `data/chores.db`). Back that file up.

## Layout

```
src/server.js     entry point (HTTP server + scheduler)
src/app.js        routes: NFC tap, admin pages, forms
src/chores.js     data access and rules
src/scheduler.js  missed-chore detection and alerts
src/notify.js     Pushover client
src/time.js       timezone, weekday and day-list helpers
src/views.js      server-rendered HTML
test/             node:test suite (npm test)
deploy/           systemd unit
```
