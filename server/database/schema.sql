CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL
        CHECK (role IN ('manager', 'member')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'archived')),
    created_by BIGINT NOT NULL REFERENCES users(id),
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        end_date IS NULL
        OR start_date IS NULL
        OR end_date >= start_date
    )
);

CREATE TABLE IF NOT EXISTS project_members (
    project_id BIGINT NOT NULL
        REFERENCES projects(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS time_entries (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id),
    project_id BIGINT NOT NULL REFERENCES projects(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    work_date DATE NOT NULL DEFAULT CURRENT_DATE,

    entry_method VARCHAR(20) NOT NULL
        CHECK (entry_method IN ('manual', 'timer')),

    duration_minutes INTEGER
        CHECK (duration_minutes IS NULL OR duration_minutes > 0),

    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,

    status VARCHAR(30) NOT NULL DEFAULT 'draft'
        CHECK (
            status IN (
                'draft',
                'submitted',
                'partially_approved',
                'approved',
                'rejected'
            )
        ),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (
        ended_at IS NULL
        OR started_at IS NULL
        OR ended_at >= started_at
    ),

    CHECK (
        (entry_method = 'manual' AND duration_minutes IS NOT NULL)
        OR
        (entry_method = 'timer' AND started_at IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS approvals (
    id BIGSERIAL PRIMARY KEY,
    time_entry_id BIGINT NOT NULL
        REFERENCES time_entries(id) ON DELETE CASCADE,

    manager_id BIGINT NOT NULL REFERENCES users(id),

    decision VARCHAR(20) NOT NULL
        CHECK (decision IN ('approved', 'rejected')),

    note TEXT,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (time_entry_id, manager_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_timer_per_user
ON time_entries (user_id)
WHERE entry_method = 'timer' AND ended_at IS NULL;

CREATE INDEX IF NOT EXISTS time_entries_user_id_index
ON time_entries (user_id);

CREATE INDEX IF NOT EXISTS time_entries_project_id_index
ON time_entries (project_id);

CREATE INDEX IF NOT EXISTS time_entries_status_index
ON time_entries (status);

CREATE INDEX IF NOT EXISTS approvals_time_entry_id_index
ON approvals (time_entry_id);