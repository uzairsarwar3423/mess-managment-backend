# Mess API ko VPS par chalana: Beginner se Advanced tak

Is guide ke baad aap ka backend **https://mess.rapto.cloud** par chalega, aur har `git push origin main` par khud update ho jayega.

```
git push  ->  GitHub tests chalata hai  ->  Docker image banata hai  ->  VPS par bhejta hai  ->  naya version chal jata hai
                                                                         (theek na chale to khud purane par wapas)
```

| Level | Kya milta hai | Waqt |
|-------|---------------|------|
| **Level 1: Beginner** (zaroori) | Pehla deploy, HTTPS, auto-deploy | 45-60 min |
| **Level 2: Intermediate** (pehle hafte mein) | Firewall, swap, monitoring, super admin, rollback | 30 min |
| **Level 3: Advanced** (jab chahein) | SSH hifazat, fail2ban, Cloudflare lock, auto security updates | 30 min |

> **Aap ke VPS par doosre projects pehle se chal rahe hain.** Is guide ki koi command unhein delete, band ya change **nahi** karti. Sirf naye folder `/opt/mess-backend`, ek naya Nginx site (`mess.rapto.cloud`) aur ek container `mess-api` banta hai. Jahan thoda risk hai wahan ⚠️ likha hai.

---

## Pehle samajh lein (5 minute)

```
Student / Admin App
      |  https://mess.rapto.cloud
      v
 Cloudflare (DNS)   -->   VPS par Nginx (80/443)   -->   127.0.0.1:8080 (sirf andar se)
                                                                |
                                                        Docker container "mess-api"
                                                                |
                                                    Supabase (database)   Cloudinary (photos)
```

VPS par koi database nahi. Container dobara bane ya server restart ho, aap ka data Supabase mein mehfooz rehta hai.

| Lafz | Matlab |
|------|--------|
| **VPS** | Internet par aap ka apna Linux computer |
| **SSH** | Apne PC se VPS par commands chalane ka tareeqa |
| **SSH key** | Password ki jagah ek jori: **private key** (raaz, sirf GitHub/aap ke paas) aur **public key** (VPS par rakhte hain) |
| **Docker / container** | Backend ek band dabbe mein chalta hai jis mein uski har zaroorat hoti hai |
| **Nginx** | Server ka "receptionist": `mess.rapto.cloud` ki request ko container tak pohanchata hai, HTTPS bhi yehi karta hai |
| `.env.production` | VPS par production ke raaz (Supabase keys waghera). Sirf server par rehti hai, GitHub par kabhi nahi |

**Commands kahan chalani hain:** jahan **"PC par"** likha ho wahan Windows ka **PowerShell**, jahan **"VPS par"** likha ho wahan SSH se server ke andar. Placeholder jaise `VPS-KA-IP` ko apni value se badlein (kisi brackets ke bina).

---

# LEVEL 1: Beginner

## Step 1: VPS mein login

**PC par:**
```powershell
ssh root@VPS-KA-IP
```
Pehli baar `yes` likhein, phir VPS ka password dein. Prompt `root@...:~#` ban jaye to aap server ke andar hain.

## Step 2: Dekhein server par kya hai (sirf dekhna, kuch badalta nahi)

**VPS par:**
```bash
docker --version                 # Docker laga hai?
nginx -v                         # Nginx laga hai?
ls /etc/nginx/sites-enabled      # doosre projects ke sites
ss -ltnp | grep -E ':(80|443|8080)\s'    # in ports par kaun chal raha hai
free -h                          # RAM aur swap
```

- Docker ya Nginx ka version nazar na aaye to woh Step 3 mein lag jayega.
- ⚠️ **Agar port 8080 par koi doosra project chal raha hai** (`ss` ki last command mein `:8080` dikhe), to is project ke liye `8081` ya koi aur khali port chunein. Neeche "Step 5" aur "Step 7" mein jahan `8080` hai wahan woh number likhein. Aage guide `8080` maan kar chalti hai.

## Step 3: Jo missing hai wohi lagayein

**VPS par** (har command sirf tab chalayein jab upar dekha ke woh cheez nahi hai):

```bash
# Docker (agar "docker --version" ne kuch nahi dikhaya)
curl -fsSL https://get.docker.com | sh

# Nginx aur HTTPS ka tool (agar nginx -v ne kuch nahi dikhaya; certbot nahi hai to wohi alag)
apt update && apt install -y nginx certbot python3-certbot-nginx
```

Check:
```bash
docker --version && docker compose version
```

## Step 4: App ka folder aur secrets ki file

**VPS par:**
```bash
mkdir -p /opt/mess-backend
nano /opt/mess-backend/.env.production
```

Is mein yeh likhein. Values wahi hain jo aap ke computer ke `backend/.env` mein hain, sirf 3 lines alag (`NODE_ENV`, `CLOUDINARY_ROOT_FOLDER`, `TRUST_PROXY_HOPS`):

```
NODE_ENV=production
LOG_LEVEL=info
APP_TIMEZONE=Asia/Karachi
CORS_ORIGINS=
ENABLE_JOBS=true
TRUST_PROXY_HOPS=2

SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_ROOT_FOLDER=mess-prod
UPLOAD_MAX_BYTES=2097152

QR_SIGNING_SECRET=...naya, kam az kam 32 huroof...
```

Save: `Ctrl+O`, Enter, `Ctrl+X`. Phir:
```bash
chmod 600 /opt/mess-backend/.env.production
```

Zaroori baatein:
- `TRUST_PROXY_HOPS=2` jab Cloudflare ka cloud **orange** ho (Cloudflare + Nginx). Sirf Nginx ho to `1`.
- `QR_SIGNING_SECRET` production ke liye **naya** banayein aur ek baar tay kar ke **kabhi na badlein** (badalne se chhape hue QR band ho jate hain). **PC par** banane ka tareeqa:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
- Cloudinary ki key ko Admin / full access chahiye (`npm run cloudinary:check` apne PC par chala kar dekh sakte hain).
- Agar Step 2 mein 8080 par doosra project tha to ek aur file: `echo "API_HOST_PORT=8081" > /opt/mess-backend/.env`

## Step 5: DNS (Cloudflare)

Cloudflare mein `rapto.cloud` kholein, **DNS, phir Add record**:

| Type | Name | IPv4 address | Proxy status |
|------|------|--------------|--------------|
| A | `mess` | VPS ka IP | **DNS only (grey cloud)** abhi ke liye |

Grey cloud sirf pehli baar HTTPS banane tak rakhein (Step 7 ke baad orange kar sakte hain).

**PC par** 2-5 minute baad check karein:
```powershell
nslookup mess.rapto.cloud
```
Jawab mein VPS ka IP aana chahiye. Jab tak na aaye, aage na barhein.

## Step 6: Nginx ka site (naya, doosre sites ko nahi chhedta)

**VPS par:**
```bash
cat > /etc/nginx/sites-available/mess-api.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=mess_api:10m rate=20r/s;

upstream mess_api {
    server 127.0.0.1:8080;
    keepalive 16;
}

server {
    listen 80;
    listen [::]:80;
    server_name mess.rapto.cloud;

    client_max_body_size 1m;

    location / {
        limit_req zone=mess_api burst=40 nodelay;
        proxy_pass http://mess_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
EOF

ln -s /etc/nginx/sites-available/mess-api.conf /etc/nginx/sites-enabled/mess-api.conf
nginx -t
```

`nginx -t` mein **"syntax is ok"** aur **"test is successful"** aana zaroori hai. Tab hi agla:
```bash
systemctl reload nginx
```

(Port 8080 ki jagah 8081 rakha ho to upar `server 127.0.0.1:8080;` mein woh number likhein.)

## Step 7: HTTPS (muft certificate)

**VPS par:**
```bash
certbot --nginx -d mess.rapto.cloud
```
Email poochhe to apna dein, terms ke liye `Y`, HTTP se HTTPS ka redirect poochhe to option `2` (Redirect). Certificate 90 din ka hota hai aur certbot khud renew karta hai. Check:
```bash
certbot renew --dry-run
```

Ab Cloudflare mein `mess` record ka cloud **orange (Proxied)** kar sakte hain, lekin tab Cloudflare ke **SSL/TLS** menu mein mode **Full (strict)** karein. **Flexible mode kabhi nahi**, warna redirect ka chakkar (loop) ban jata hai. Pehle grey hi rehne dein, sab chal jaye tab orange karna.

## Step 8: GitHub ke liye SSH key

**PC par:**
```powershell
ssh-keygen -t ed25519 -f $HOME\mess_deploy_key -N '""'
Get-Content $HOME\mess_deploy_key.pub
```
Aakhri command ek lambi line dikhati hai (`ssh-ed25519 AAAA...`). Use copy karein, phir **VPS par**, `PASTE-YAHAN` ki jagah:
```bash
mkdir -p /root/.ssh && echo "PASTE-YAHAN" >> /root/.ssh/authorized_keys
chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys
```
Test (**PC par**), password nahi poochna chahiye:
```powershell
ssh -i $HOME\mess_deploy_key root@VPS-KA-IP
```
`exit` likh kar nikal jayein.

## Step 9: GitHub mein 3 secrets

GitHub par apni repository, phir **Settings, phir Secrets and variables, phir Actions, phir New repository secret**:

| Name | Value |
|------|-------|
| `VPS_HOST` | VPS ka IP |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | **private** key ka poora text: PC par `Get-Content $HOME\mess_deploy_key` (`-----BEGIN` se `-----END` tak sab, **.pub wali nahi**) |

SSH ka port 22 nahi hai to chauthi secret `VPS_PORT` banayein.

## Step 10: Pehla deploy

**Pehle Supabase ka SQL** (agar nahi chalaya): Supabase, **SQL Editor**, yeh chalayein:
```sql
alter table payments alter column transaction_id drop not null;
```

**Phir PC par** (`D:\mess-managment-backend\backend` mein):
```powershell
git add .
git commit -m "simple deploy"
git push origin main
```

GitHub par repository ke **Actions** tab mein **Deploy** chalta hua nazar aayega (5-8 minute). Hara tick aaye to browser mein:
```
https://mess.rapto.cloud/health
```
`{"success":true,...}` aana chahiye. **Mubarak ho**, ab har `git push origin main` par naya version khud chal jata hai.

---

# LEVEL 2: Intermediate

## Pehla super admin (mess owner)

**VPS par:**
```bash
docker exec mess-api node dist/scripts/createSuperAdmin.js --email owner@mess.com --name "Ahmed Khan"
```
Password screen par ek baar aata hai. Owner Admin App mein login karke "Change password" kare.

## Mobile apps ko server ka address

Student App aur Admin App ke `.env` mein (release build banane se pehle):
```
EXPO_PUBLIC_API_BASE_URL=https://mess.rapto.cloud/api/v1
```

## Roz ke kaam (VPS par)

| Kaam | Command |
|------|---------|
| Live logs | `docker logs -f mess-api` |
| Kaun sa version chal raha hai | `docker ps` |
| Resource (RAM/CPU) | `docker stats --no-stream mess-api` |
| Restart | `cd /opt/mess-backend && docker compose restart` |
| `.env.production` badli to naya load | `cd /opt/mess-backend && docker compose up -d --force-recreate` |
| Cloudinary ki jaanch | `docker exec mess-api node dist/scripts/checkCloudinary.js` |

## Purane version par wapas jana (rollback)

Naya version start na ho to deploy khud wapas laga deta hai. Chalne ke baad koi galti nikle to haath se:
```bash
docker images mess-api                 # purane tags (commit ke naam) dekhein
nano /opt/mess-backend/.env            # IMAGE=mess-api:<purana-tag> likhein
cd /opt/mess-backend && docker compose up -d
```

## Swap (agar RAM 1 GB ya kam ho)

Pehle `free -h` dekhein. Swap `0B` ho to:
```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## Firewall (ufw)

⚠️ Doosre projects bhi isi server par hain. Pehle dekhein: `ufw status`.

- **Agar "Status: active" hai:** bas yeh add karein (kuch delete nahi hoga): `ufw allow 80/tcp && ufw allow 443/tcp`
- **Agar "inactive" hai** aur aap use chalana chahte hain: pehle jo bhi port doosre projects bahar se kholte hain (`ss -ltnp` mein `0.0.0.0` wale) un sab ko allow karein, **SSH sab se pehle**, aur tab `enable`:
  ```bash
  ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
  # + doosre projects ke ports: ufw allow <port>/tcp
  ufw enable
  ```
  ⚠️ `OpenSSH` allow kiye bina `enable` mat karein, warna aap server se bahar ho jayenge.

## Uptime ki nigrani (muft)

[uptimerobot.com](https://uptimerobot.com) par account banayein, **Add New Monitor**, type HTTP(s), URL `https://mess.rapto.cloud/health`, interval 5 minute, apna email dein. Server band ho to email aa jata hai.

## Database ke naye SQL

Jab bhi `database/migrations/` mein nayi `.sql` file aaye, uska text Supabase ke **SQL Editor** mein ek baar chalayein. Yeh jaan boojh kar khud nahi chalta, taake galti se database na bigade.

---

# LEVEL 3: Advanced (jab zaroorat ho)

## SSH ki hifazat (sirf key se login)

⚠️ Pehle sure karein ke Step 8 ka key-login test pass hua tha. **Ek SSH window khula rakhein**, doosri window mein test karein.

**VPS par:**
```bash
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PasswordAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t && systemctl reload ssh
```
(`sshd -t` khamosh rahe to theek hai. Nayi window mein `ssh root@VPS-KA-IP` chalayein, login ho jana chahiye. Na ho to pehli window mein woh file `rm /etc/ssh/sshd_config.d/99-hardening.conf && systemctl reload ssh` se hata dein.) Agar `systemctl reload ssh` na chale to `sshd` likh kar dekhein.

## Fail2ban (SSH par galat koshishon ko block)

```bash
apt install -y fail2ban
systemctl enable --now fail2ban
fail2ban-client status sshd
```

## Khud ba khud security updates

```bash
apt install -y unattended-upgrades
echo unattended-upgrades unattended-upgrades/enable_auto_updates boolean true | debconf-set-selections
dpkg-reconfigure -f noninteractive unattended-upgrades
```

## Sirf Cloudflare se aane dena

⚠️ Sirf tab karein jab is server ke **sab** websites Cloudflare (orange cloud) ke peeche hon. Warna doosre sites band ho jayenge. `ufw` active aur Step 7 mein orange cloud + Full (strict) ho. Phir:
```bash
for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
  ufw allow from "$ip" to any port 443 proto tcp
done
ufw delete allow 443/tcp
```

## Agar sab kuch kharab ho jaye (recovery)

- App chalu hai lekin purana: `docker ps` mein `mess-api` "healthy" hai? Logs: `docker logs --tail 100 mess-api`.
- Container bar bar restart: aksar `.env.production` mein koi value khali ya ghalat hai (`Invalid environment configuration` logs mein). Theek karke `docker compose up -d --force-recreate`.
- Pura dobara: `cd /opt/mess-backend && docker compose down && docker compose up -d`. Data safe hai (Supabase mein).
- `.env.production` ki ek copy kisi mehfooz jagah rakhein (password manager). Server gaya to isi se naya server 30 minute mein ban jata hai.

---

## Agar kuch na chale (common errors)

| Nishani | Wajah aur hal |
|---------|---------------|
| Actions mein **test** ka step laal | Code mein masla. Error parhein, theek karein, dobara push karein. Server tak kuch nahi pohnchta. |
| **Connect to the VPS** laal, "Permission denied" | `VPS_SSH_KEY` poori paste nahi hui, ya uski public key `/root/.ssh/authorized_keys` mein nahi (Step 8). |
| `/opt/mess-backend: No such file` | Step 4 ka `mkdir` nahi hua. |
| Last step laal, "did not become healthy" | Server ne purana version wapas laga diya. Output ke neeche logs hain: aksar `.env.production` mein value ghalat ya khali. |
| Actions hara hai lekin `https://mess.rapto.cloud` nahi khulta | DNS abhi VPS par nahi gaya (Step 5), ya `nginx -t`, ya certbot nahi chala (Step 7). VPS par `curl http://127.0.0.1:8080/health` chalayein: yeh chale to masla Nginx/DNS ka hai, container theek hai. |
| Browser mein "redirected you too many times" | Cloudflare SSL mode **Flexible** hai. **Full (strict)** karein. |
| `502 Bad Gateway` | Container band hai ya Nginx ka port ghalat. `docker ps` aur Nginx conf ka `server 127.0.0.1:PORT` dekhein. |
| Student App mein payment ya upload ka error | Upar wala Supabase SQL, aur Cloudinary key ka role: `docker exec mess-api node dist/scripts/checkCloudinary.js` |
