# Backend ko Supabase par chalane ka tareeqa (aasan steps)

**Supabase kya hai?** Yeh internet par ek ready-made **database** aur **login system** hai. Hamara backend isi se baat karta hai.
Aap ko kuch code nahi likhna, sirf neeche ke steps par click karna aur copy-paste karna hai. Free plan kaafi hai.

Aap ko 3 chahiye: **Supabase account**, **Cloudinary account** (photos ke liye), aur **Gmail** (OTP emails ke liye).

---

## Step 1 — Supabase project banayein
1. https://supabase.com par jayein, **Start your project** → GitHub ya email se sign up.
2. **New project** dabayein.
   - Name: `mess`
   - Database Password: ek mazboot password likhein aur **kahin save kar lein**.
   - Region: jo aap ke sab se qareeb ho (Singapore ya Mumbai).
3. **Create new project** dabayein. 1–2 minute intezar karein jab tak project ban jaye.

## Step 2 — Database tayyar karein (sirf copy-paste)
1. Left menu mein **SQL Editor** kholein → **New query**.
2. Computer par yeh file kholein: `D:\mess-managment-backend\backend\database\all_in_one.sql`
   Poori file **select all (Ctrl+A) → copy (Ctrl+C)** karein.
3. SQL Editor mein **paste (Ctrl+V)** karein → neeche green **Run** dabayein.
4. Neeche result mein ek lambi id aaye gi (`COPY_THIS_INTO_DEFAULT_MESS_ID`). **Usay copy kar lein** — yeh Step 5 mein chahiye.
   - Agar red error aaye to us ki screenshot/text mujhe bhej dein.
   - Yeh file sirf **ek baar** chalani hai.

## Step 3 — Keys copy karein
1. Left menu → **Project Settings** (gear icon) → **API Keys** (ya "API").
2. Teen cheezein copy karein:
   - **Project URL** (`https://xxxxxxxx.supabase.co`) → `SUPABASE_URL`
   - **anon / publishable key** → `SUPABASE_ANON_KEY`
   - **service_role / secret key** → `SUPABASE_SERVICE_ROLE_KEY`  ⚠️ yeh bohat khufia hai, kisi ko mat dikhayein, kahin post na karein.
   - Agar "Legacy API keys" ka tab ho to wahan se `anon` aur `service_role` lein.

## Step 4 — Login emails (OTP code) set karein
**4a. Email ki settings**
1. Left menu → **Authentication** → **Sign In / Providers** → **Email**.
2. **Confirm email** = **ON**. Minimum password length = **8**. Save.

**4b. Email ka message (link ki jagah 6-digit code)**
1. **Authentication** → **Email Templates**.
2. **Confirm signup** template kholein. Poora message hata kar yeh likhein:
   ```html
   <h2>Your verification code</h2>
   <p>Enter this code in the Mess app: <b>{{ .Token }}</b></p>
   ```
   Save.
3. **Reset Password** template mein bhi yehi karein (heading "Your password reset code"). Save.

**4c. Gmail se emails bhejna** (pehle test ke liye yeh step chhod sakte hain, lekin Supabase ki apni email bohat kam bhejti hai, is liye real use se pehle zaroor karein)
1. Google account → **Security** → **2-Step Verification** on karein.
2. Wahin **App passwords** banayein (naam: `mess`) → 16 harf ka password milega, copy karein.
3. Supabase → **Authentication** → **Emails** (ya Settings) → **SMTP Settings** → **Enable custom SMTP**:
   - Sender email: aap ka Gmail
   - Sender name: `Mess`
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: aap ka Gmail
   - Password: woh 16 harf wala App Password
   Save.

## Step 5 — Cloudinary (photos)
1. https://cloudinary.com par free account banayein.
2. **Dashboard** par teen cheezein dikhengi: **Cloud name**, **API Key**, **API Secret** (copy karein).
3. **Settings → Upload → Upload presets → Add upload preset**, do preset banayein:

   | Naam | Signing mode | Delivery type (Access mode) | Allowed formats | Incoming transformation |
   |------|--------------|-----------------------------|-----------------|--------------------------|
   | `mess_payments_signed` | **Signed** | **Authenticated** | jpg, jpeg, png, webp | Crop = Limit, Width 1600, Height 1600 |
   | `mess_profiles_signed` | **Signed** | Upload (public) | jpg, jpeg, png, webp | Crop = Fill, Width 512, Height 512, Gravity = Face |

   Dono mein "Overwrite" band (false) rakhein.
4. **Settings → Security** mein **Strict transformations** on kar sakte hain (optional, behtar hai).

## Step 6 — `.env` file banayein
1. Folder `D:\mess-managment-backend\backend` mein `.env.example` ki copy banayein aur naam rakhein **`.env`**.
2. Kholein aur yeh bharein:

   ```
   NODE_ENV=development
   PORT=8080
   DEFAULT_MESS_ID=<Step 2 ki lambi id>
   SUPABASE_URL=<Step 3>
   SUPABASE_ANON_KEY=<Step 3>
   SUPABASE_SERVICE_ROLE_KEY=<Step 3>
   CLOUDINARY_CLOUD_NAME=<Step 5>
   CLOUDINARY_API_KEY=<Step 5>
   CLOUDINARY_API_SECRET=<Step 5>
   CLOUDINARY_PRESET_PAYMENTS=mess_payments_signed
   CLOUDINARY_PRESET_PROFILES=mess_profiles_signed
   CLOUDINARY_ROOT_FOLDER=mess-dev
   QR_SIGNING_SECRET=<neeche wali command ka result>
   ```
3. `QR_SIGNING_SECRET` banane ke liye terminal mein (folder `backend` mein) yeh chalayein aur result paste karein:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```
4. `.env` kisi ko mat bhejein aur Git mein mat dalein (yeh already ignore hoti hai).

## Step 7 — Apna admin account banayein
1. Supabase → **Authentication** → **Users** → **Add user** → **Create new user**.
   - Email aur password likhein (yeh aap ka admin login hoga).
   - **Auto Confirm User** ✅ lagayein. Create.
2. **SQL Editor** → New query → file `database\create_first_super_admin.sql` ka text paste karein.
3. Us mein `owner@example.com` ko **apni email** se badlein (jo Step 7.1 mein use ki) aur naam badal dein. **Run**.
4. Neeche aap ki 1 row dikhni chahiye (`role = super_admin`).

## Step 8 — Chalayein aur check karein
```powershell
cd D:\mess-managment-backend\backend
npm run dev
```
Terminal mein yeh lines aani chahiyein:
- `mess-api listening`
- `Supabase connected`
- `Cloudinary connected`

Agar `FAILED` likha aaye to us ke saath likhi wajah mujhe bhej dein.

Phir **doosra terminal** kholein aur admin login try karein (email/password apne wale likhein):
```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8080/api/v1/auth/admin/login -ContentType 'application/json' -Body '{"email":"owner@example.com","password":"AAPKA_PASSWORD"}'
```
Agar jawab mein `access_token` aur aap ka naam aaye to **backend asli Supabase par chal gaya** ✅.

---

## Aam masle
| Masla | Hal |
|-------|-----|
| SQL Editor mein error | Poori file dobara copy karein (kuch kata na ho). Phir bhi error ho to text mujhe bhejein |
| `Invalid environment configuration` | `.env` mein koi value khali hai; terminal mein jis ka naam likha ho woh bharein |
| `INVALID_CREDENTIALS` | Email/password ghalat, ya Step 7 mein "Auto Confirm User" nahi lagaya |
| `FORBIDDEN` admin login par | Step 7.2–7.4 (admins table ki row) nahi hui |
| Email nahi aati | Step 4c (Gmail SMTP) karein; Spam folder bhi dekhein |

## Pehla super admin (mess owner ka account) - ek command se

SQL ki zaroorat nahi. Backend folder mein (server ke `.env` ke saath):

```
npm run admin:create -- --email owner@mess.com --name "Ahmed Khan"
```

Password na dein to khud ek mazboot password banta hai aur sirf ek baar screen par dikhta hai. Apna password dena ho:
`--password "Mess2026x"` (8+ huroof, ek letter aur ek number). Phone optional: `--phone 03001234567`.
Owner Admin App mein login kar ke More > Change password se apna password badal le, aur baqi staff More > Admins se banaye.
