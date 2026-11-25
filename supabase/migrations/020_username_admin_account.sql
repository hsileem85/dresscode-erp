-- ============================================================================
-- Migration 020: Create Username-Based Admin Account (`admin`)
-- ============================================================================
-- Creates a pre-confirmed Supabase Auth account for username `admin`
-- (mapped internally to `admin@erp.dresscode-clothing.com` so the user signs
-- in by typing simply `admin` in the login screen — no email required).
--
-- Default Password:  Admin@2026   (يمكنك تعديلها في السطر التالي قبل التشغيل)
-- Role:              admin (كامل الصلاحيات)
--
-- Safe & idempotent: can be re-run to reset the `admin` password or confirm it.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure user_roles exists even if migration 019 was not executed yet
CREATE TABLE IF NOT EXISTS public.user_roles (
  email        TEXT PRIMARY KEY,
  role         TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'staff')),
  display_name TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
DECLARE
  v_username   TEXT := 'admin';
  v_password   TEXT := 'Admin@2026'; -- غيّر كلمة المرور هنا قبل التشغيل إذا أردت
  v_email      TEXT := LOWER(v_username) || '@erp.dresscode-clothing.com';
  v_user_id    UUID;
  v_pw_hash    TEXT;
BEGIN
  -- Ensure crypt() / gen_salt() resolve whether pgcrypto is in public or extensions
  PERFORM set_config('search_path', 'public, extensions, auth', true);

  v_pw_hash := crypt(v_password, gen_salt('bf'));

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE LOWER(email) = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      raw_app_meta_data,
      raw_user_meta_data,
      is_super_admin,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      v_pw_hash,
      NOW(),
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('username', v_username, 'full_name', v_username),
      false,
      NOW(),
      NOW()
    );

    INSERT INTO auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', v_email,
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      NOW(),
      NOW(),
      NOW()
    );
  ELSE
    -- Account already exists: refresh password, confirm email, and ensure metadata
    UPDATE auth.users
    SET
      encrypted_password = v_pw_hash,
      email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
      confirmation_token = COALESCE(confirmation_token, ''),
      recovery_token = COALESCE(recovery_token, ''),
      email_change_token_new = COALESCE(email_change_token_new, ''),
      email_change = COALESCE(email_change, ''),
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('username', v_username, 'full_name', v_username),
      updated_at = NOW()
    WHERE id = v_user_id;

    -- Ensure an email identity exists for password sign-in
    IF NOT EXISTS (
      SELECT 1 FROM auth.identities
      WHERE user_id = v_user_id AND provider = 'email'
    ) THEN
      INSERT INTO auth.identities (
        id,
        user_id,
        provider_id,
        identity_data,
        provider,
        last_sign_in_at,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        v_user_id,
        v_user_id::text,
        jsonb_build_object(
          'sub', v_user_id::text,
          'email', v_email,
          'email_verified', true,
          'phone_verified', false
        ),
        'email',
        NOW(),
        NOW(),
        NOW()
      );
    END IF;
  END IF;

  -- Register explicitly as full Admin in user_roles
  INSERT INTO public.user_roles (email, role, display_name, updated_at)
  VALUES (v_email, 'admin', v_username, NOW())
  ON CONFLICT (email) DO UPDATE
    SET role = 'admin',
        display_name = EXCLUDED.display_name,
        updated_at = NOW();
END $$;
