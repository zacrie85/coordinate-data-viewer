-- =============================================
-- SETUP FOTO di project Supabase 'odp-map' yang SUDAH ADA
-- Jalankan di Supabase Dashboard > SQL Editor
-- di project odp-map kamu
-- =============================================

-- ── Step 1: Buat Storage Bucket 'odp-photos' ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'odp-photos',
  'odp-photos',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- ── Step 2: Set RLS Policies untuk Storage ──
CREATE POLICY "Public read odp-photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'odp-photos');

CREATE POLICY "Authenticated upload odp-photos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'odp-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated update odp-photos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'odp-photos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated delete odp-photos"
ON storage.objects FOR DELETE
USING (bucket_id = 'odp-photos' AND auth.role() = 'authenticated');

-- ── Step 3: Buat tabel Photo ──
CREATE TABLE IF NOT EXISTS "Photo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pointId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "url" TEXT NOT NULL,
    "thumbUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Photo_pointId_fkey" FOREIGN KEY ("pointId") REFERENCES "Odp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Photo_pointId_idx" ON "Photo"("pointId");
CREATE INDEX IF NOT EXISTS "Photo_createdAt_idx" ON "Photo"("createdAt");

-- ── VERIFIKASI ──
SELECT '=== BUCKET ===' as info;
SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'odp-photos';

SELECT '=== POLICIES ===' as info;
SELECT policyname, tablename, cmd FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE '%odp-photos%';

SELECT '=== TABEL PHOTO ===' as info;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Photo' ORDER BY ordinal_position;