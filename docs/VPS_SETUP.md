# VPS Setup (one time)

Target: an Ubuntu 22.04/24.04 (or Debian 12) VPS that serves **https://mess.rapto.cloud**.
Everything here is **non-destructive**: nothing removes existing apps, containers, volumes or config.

## What runs on the VPS

```
Internet ──► Cloudflare (proxy, TLS) ──► Nginx on the host :443 ──► 127.0.0.1:8080 ──► container "mess-api-1"
                                                                                         │
                                                         Supabase (Postgres + Auth) ◄────┤  (HTTPS, hosted)
                                                         Cloudinary (files)          ◄────┘  (HTTPS, hosted)
```

- **One container** (`api`). There is no database, Redis or file-storage container: the database is
  Supabase (hosted) and files live in Cloudinary. Nothing stateful lives on the VPS, so there are no
  Docker volumes to protect or back up.
- The API port is bound to `127.0.0.1` only; only Nginx is reachable from outside.

```
/opt/mess-backend/
├── .env.production     SECRETS — created by hand, chmod 600, never written by CI
├── migrate.env         optional DB connection for migrations — by hand, chmod 600
├── monitor.env         optional alert webhook — by hand
├── .env                API_IMAGE=… only — written by deploy.sh (do not put secrets here; deploy refuses)
├── docker-compose.yml  ┐
├── deploy.sh           │
├── rollback.sh         │ shipped by GitHub Actions on every deploy (overwritten)
├── migrate.sh          │
├── monitor.sh, lib.sh  │
├── migrations/         ┘
└── .deploy/            state: current_image, previous_image, history.log, lock, monitor.log
```

## 0. Before you start: the subdomain is new

`mess.rapto.cloud` is a new subdomain with nothing deployed on it yet. Its DNS (Cloudflare, proxied)
already points at this VPS, so until our Nginx site is enabled, requests fall through to the server's
**default** Nginx site — on 2026-11-26 that was another app on the server (a Python service answering
`/health` with `{"status":"ok"}`). That is expected and harmless: once `mess-api.conf` (with
`server_name mess.rapto.cloud`) is enabled in step 6, Nginx sends this subdomain to the mess API and
the other app keeps working on its own domain. Nothing existing needs to be changed or removed.

Sanity check that no other block already claims the name (should print nothing):

```bash
sudo nginx -T 2>/dev/null | grep -n "server_name.*mess.rapto.cloud"
```

## 1. Bootstrap (Docker, deploy user, directories, log rotation)

From your machine:

```bash
scp deploy/vps/bootstrap.sh root@<VPS_IP>:/root/
ssh root@<VPS_IP> 'bash /root/bootstrap.sh deploy'
```

It installs Docker Engine + compose plugin **only if missing**, creates the `deploy` user (in the
`docker` group), `/opt/mess-backend` (mode 750) with an empty `.env.production` (mode 600), writes
`/etc/docker/daemon.json` log rotation **only if that file does not exist**, and **adds** ufw allow
rules for SSH/80/443 without enabling ufw.

> The `docker` group is root-equivalent. Use the `deploy` user only for deployments.

Check: `ssh root@<VPS_IP> 'docker --version && docker compose version && ls -la /opt/mess-backend'`

## 2. SSH key for GitHub Actions

On your machine (no passphrase; this key is only for CI):

```bash
ssh-keygen -t ed25519 -C "github-actions-mess-deploy" -f ./mess_deploy_key -N ""
ssh-copy-id -i ./mess_deploy_key.pub deploy@<VPS_IP>      # or append the .pub to ~deploy/.ssh/authorized_keys
ssh -i ./mess_deploy_key deploy@<VPS_IP> 'docker ps'       # must work without sudo
ssh-keyscan -p 22 <VPS_IP>                                  # output -> secret VPS_KNOWN_HOSTS
```

Put the private key in the GitHub secret `VPS_SSH_KEY` (see [CICD_PIPELINE.md](CICD_PIPELINE.md)),
then **delete the local copy**.

Optional hardening — restrict that key to deploy use from GitHub only by prefixing its line in
`authorized_keys` with `no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty `.
(`no-pty` is fine: the workflow never needs a terminal.)

## 3. SSH hardening (do this carefully, keep a second session open)

Only after key login works for **every** account you use:

```bash
sudo tee /etc/ssh/sshd_config.d/60-hardening.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
MaxAuthTries 4
EOF
sudo sshd -t && sudo systemctl reload ssh     # `ssh` on Ubuntu, `sshd` on Debian
```

Test a **new** login in a second terminal before closing the first.
Optional: `sudo apt install fail2ban` (default jail protects sshd).

## 4. Firewall

```bash
sudo ufw status verbose          # if already active: just make sure 80/443/SSH are allowed
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable                  # only if it was inactive AND you allowed your SSH port
```

Other apps on this server may need their own ports — check `sudo ss -tlnp` before enabling.
Note: Docker-published ports bypass ufw. That is why the API is published on `127.0.0.1:8080` only.
If 8080 is already used by another app, set `API_HOST_PORT=8090` in `/opt/mess-backend/.env` and
in the Nginx `upstream`.

Optional (recommended with Cloudflare): allow 80/443 only from
[Cloudflare IP ranges](https://www.cloudflare.com/ips/) so nobody can bypass Cloudflare.

## 5. Production secrets

```bash
ssh deploy@<VPS_IP>
nano /opt/mess-backend/.env.production      # fill from .env.example — see ENVIRONMENT_CONFIGURATION.md
chmod 600 /opt/mess-backend/.env.production
```

Optional migrations connection: copy `deploy/migrate.env.example` to `/opt/mess-backend/migrate.env`
(chmod 600) and follow "Database migrations" in [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)
**including the one-time baseline**.

## 6. Nginx + HTTPS

```bash
scp deploy/nginx/mess-api.conf root@<VPS_IP>:/etc/nginx/sites-available/mess-api.conf
ssh root@<VPS_IP>
# new subdomain: nothing to replace
ln -s /etc/nginx/sites-available/mess-api.conf /etc/nginx/sites-enabled/mess-api.conf
nginx -t && systemctl reload nginx
```

TLS, behind Cloudflare — pick one:

- **Cloudflare Origin Certificate (simplest, recommended):** Cloudflare dashboard → SSL/TLS → Origin
  Server → Create certificate for `mess.rapto.cloud` (15 years). Save as
  `/etc/ssl/cloudflare/mess.rapto.cloud.pem` and `.key` (key mode 600), and add to the server block:
  ```nginx
  listen 443 ssl; listen [::]:443 ssl; http2 on;
  ssl_certificate     /etc/ssl/cloudflare/mess.rapto.cloud.pem;
  ssl_certificate_key /etc/ssl/cloudflare/mess.rapto.cloud.key;
  ```
  Set Cloudflare SSL/TLS mode to **Full (strict)**.
- **Let's Encrypt:** `certbot --nginx -d mess.rapto.cloud` (renews automatically via systemd timer).
  If issuance fails behind Cloudflare, temporarily set the DNS record to "DNS only" (grey cloud),
  issue, then re-enable the proxy.

Cloudflare already serves HTTPS to visitors; the certificate above secures Cloudflare -> VPS.

**Client IPs:** with Cloudflare + Nginx there are **2 proxies**, so `.env.production` must have
`TRUST_PROXY_HOPS=2` (rate limits then use the real visitor IP).

## 7. Monitoring cron

```bash
crontab -e      # as deploy
*/5 * * * * /opt/mess-backend/monitor.sh >> /opt/mess-backend/.deploy/monitor.log 2>&1
```

Rotate that log (as root):

```bash
cat > /etc/logrotate.d/mess-backend <<'EOF'
/opt/mess-backend/.deploy/*.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF
```

Also add a free external uptime check (UptimeRobot, Better Stack, …) on
`https://mess.rapto.cloud/health/ready` every 5 minutes — it catches what an on-box monitor cannot
(VPS down, DNS, Cloudflare, TLS expiry).

## 8. First deployment

Configure the GitHub secrets/variables ([CICD_PIPELINE.md](CICD_PIPELINE.md)) and push to `main`,
or run **Actions → Deploy → Run workflow**. Then verify:

```bash
curl -s https://mess.rapto.cloud/health          # {"success":true,"data":{"status":"ok",...}}
curl -s https://mess.rapto.cloud/health/ready    # {"success":true,"data":{"status":"ready"}}
curl -s https://mess.rapto.cloud/api/v1          # {"success":true,"data":{"name":"mess-api","version":"v1"}}
```

## Resource sizing

The API container is limited to 1 CPU / 512 MB (V8 heap 384 MB). A 1 vCPU / 1 GB VPS is enough for
this app alone; with the other services already on this server, check `free -m` and `docker stats`.
Reclaim disk: `docker image prune -a --filter "until=168h"` (unused images only — **never**
`docker system prune --volumes` on a shared server).
