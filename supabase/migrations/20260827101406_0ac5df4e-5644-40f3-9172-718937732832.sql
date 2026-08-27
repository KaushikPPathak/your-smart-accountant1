DROP POLICY IF EXISTS "Members can upload company logos" ON storage.objects;
DROP POLICY IF EXISTS "Members can update company logos" ON storage.objects;
DROP POLICY IF EXISTS "Members can delete company logos" ON storage.objects;

CREATE POLICY "Users can upload logos in their own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'company-logos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update logos in their own folder"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'company-logos'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'company-logos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete logos in their own folder"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'company-logos'
  AND auth.uid()::text = (storage.foldername(name))[1]
);