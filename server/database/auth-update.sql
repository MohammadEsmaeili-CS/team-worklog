ALTER TABLE users
ADD COLUMN IF NOT EXISTS username VARCHAR(50);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS account_status VARCHAR(20)
DEFAULT 'pending';

ALTER TABLE users
ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS reviewed_by BIGINT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS review_note TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN
NOT NULL DEFAULT FALSE;

UPDATE users
SET username = 'user_' || id
WHERE username IS NULL;

UPDATE users
SET account_status = 'pending'
WHERE account_status IS NULL;

ALTER TABLE users
ALTER COLUMN username SET NOT NULL;

ALTER TABLE users
ALTER COLUMN account_status SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_username_length_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_username_length_check
        CHECK (CHAR_LENGTH(username) BETWEEN 3 AND 50);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_account_status_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_account_status_check
        CHECK (
            account_status IN (
                'pending',
                'active',
                'rejected',
                'suspended'
            )
        );
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_reviewed_by_fkey'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_reviewed_by_fkey
        FOREIGN KEY (reviewed_by) REFERENCES users(id);
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique
ON users (LOWER(username));

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS auth_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    purpose VARCHAR(30) NOT NULL
        CHECK (
            purpose IN (
                'password_reset',
                'email_verification'
            )
        ),

    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_index
ON auth_tokens (user_id, purpose);