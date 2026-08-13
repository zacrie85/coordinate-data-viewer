# Setup Coordinate Data Viewer - Pakai Existing Supabase 'odp-map'

## Yang Perlu Kamu Lakukan HANYA 3 Langkah:

---

### Langkah 1: Jalankan SQL di Supabase 'odp-map'

1. Buka **https://supabase.com/dashboard**
2. Klik project **odp-map**
3. Menu kiri → klik **SQL Editor**
4. Klik **New query**
5. Copy **SELURUH** isi file `supabase-setup-odp-map.sql` → paste
6. Klik **Run** (Ctrl+Enter)
7. Pastikan hasilnya menunjukkan:
   - Bucket `odp-photos` (public = true)
   - 4 policies terbentuk
   - Tabel `Photo` tercipta dengan kolom-kolom

---

### Langkah 2: Copy Kredensial dari project 'odp-map'

1. Di dashboard **odp-map** → **Settings** → **API**
2. Ambil 3 nilai ini:

```
Project URL:       https://xxxxx.supabase.co     → NEXT_PUBLIC_SUPABASE_URL
Anon public key:   eyJhbGci...                  → NEXT_PUBLIC_SUPABASE_ANON_KEY
Service role key:  eyJhbGci...                  → SUPABASE_SERVICE_ROLE_KEY
```

3. Di dashboard **odp-map** → **Settings** → **Database**
4. Copy **Connection string (URI)**:
```
postgresql://postgres.xxxxx:[PASSWORD]@aws-0-region.pooler.supabase.com:6543/postgres
```
→ Ini untuk `DATABASE_URL` dan `DIRECT_URL`

---

### Langkah 3: Isi .env.local di project

Buat file `.env.local` di folder project dan isi:

```env
DATABASE_URL="postgresql://postgres.xxxxx:[PASS]@aws-0-xx.pooler.supabase.com:6543/postgres"
DIRECT_URL="postgresql://postgres.xxxxx:[PASS]@aws-0-xx.pooler.supabase.com:6543/postgres"

NEXT_PUBLIC_SUPABASE_URL="https://xxxxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGci..."
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGci..."

NEXT_PUBLIC_APP_URL="https://coordinate-data-viewer.vercel.app"
```

Lalu jalankan:
```bash
npm install
npx prisma db push
npm run dev
```

---

## Verifikasi

1. Buka http://localhost:3000
2. Upload file Excel yang sama dengan di project lama
3. Klik ODP → di panel detail akan muncul bagian **Foto**
4. Upload foto → harusnya berhasil
5. Export KML → buka Google Earth → popup harusnya ada thumbnail

---

## Catatan Penting

- **Database** project ini TERPISAH dari project lama karena Prisma `db push` akan membuat tabel baru.
- **Storage bucket** `odp-photos` juga baru, tidak bentrok.
- Kalau project lama tidak pakai tabel Photo, tidak ada konflik sama sekali.
- **Tapi**: Kalau kamu upload Excel yang SAMA, data ODP-nya akan duplikat (tapi di tabel terpisah per dataset, jadi aman).
