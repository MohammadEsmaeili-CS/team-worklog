CREATE TABLE IF NOT EXISTS member_lifecycle_requests (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    requested_action VARCHAR(20) NOT NULL
        CHECK (requested_action IN ('suspend', 'reactivate')),
    requested_by BIGINT NOT NULL REFERENCES users(id),
    confirmed_by BIGINT REFERENCES users(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'cancelled')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CHECK (confirmed_by IS NULL OR confirmed_by <> requested_by)
);

CREATE UNIQUE INDEX IF NOT EXISTS member_lifecycle_one_pending_per_user
ON member_lifecycle_requests (user_id)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS member_lifecycle_status_index
ON member_lifecycle_requests (status, requested_at);
