
UPDATE auth.users
   SET encrypted_password = crypt('Pathak*123*', gen_salt('bf')),
       email_confirmed_at = COALESCE(email_confirmed_at, now()),
       updated_at = now()
 WHERE email = 'acauntant@gmail.com';
