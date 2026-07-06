CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- USERS
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    role TEXT,
    user_kind TEXT NOT NULL DEFAULT 'real',
    is_planner_exempt BOOLEAN NOT NULL DEFAULT false
);

-- GROUPS
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL
);

-- DUTY SLOTS
CREATE TABLE duty_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_date DATE NOT NULL,
    weekday TEXT,
    slot_code TEXT,
    start_time TIME,
    end_time TIME,
    group_id UUID REFERENCES groups(id),
    template_item_id UUID,
    base_group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    open_end BOOLEAN NOT NULL DEFAULT false,
    required_active_count INTEGER,
    required_ruf_count INTEGER,
    full_attendance BOOLEAN NOT NULL DEFAULT false
);

-- SLOT ASSIGNMENTS
CREATE TABLE slot_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID REFERENCES duty_slots(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE
);

-- EXCHANGES
CREATE TYPE exchange_mode AS ENUM ('SWAP', 'TAKEOVER');
CREATE TYPE exchange_status AS ENUM ('OPEN', 'PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED');

CREATE TABLE exchanges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID REFERENCES duty_slots(id),
    mode exchange_mode NOT NULL DEFAULT 'SWAP',
    from_user_id UUID REFERENCES users(id),
    to_user_id UUID REFERENCES users(id),
    created_by_user_id UUID REFERENCES users(id),
    status exchange_status NOT NULL DEFAULT 'OPEN',
    confirmed_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancel_reason TEXT,
    from_confirmed_at TIMESTAMP WITH TIME ZONE,
    to_confirmed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- PGF MESSAGES
CREATE TABLE pgf_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    sender_name TEXT NOT NULL,
    content TEXT NOT NULL,
    urgency TEXT NOT NULL
);

CREATE TABLE pgf_message_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES pgf_messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (message_id, user_id)
);

CREATE TABLE pgf_message_hidden (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES pgf_messages(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (message_id, user_id)
);

-- ATTENDANCE
CREATE TABLE attendance_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID REFERENCES duty_slots(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id),
    is_present BOOLEAN,
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    actor_user_id UUID
);

CREATE TABLE temporary_pgf_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE attendance_reminders_sent (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slot_id UUID,
    user_id UUID,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- PUSH TOKENS
CREATE TABLE user_push_tokens (
    user_id UUID,
    token TEXT UNIQUE,
    platform TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE activation_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    activated_at TIMESTAMP WITH TIME ZONE,
    activated_device_id TEXT,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_activation_invitations_user_id
ON activation_invitations(user_id);

CREATE TABLE trusted_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_name TEXT,
    platform TEXT,
    activated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    UNIQUE (user_id, device_id)
);

CREATE TABLE slot_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    default_active_count INTEGER NOT NULL DEFAULT 24,
    default_ruf_count INTEGER NOT NULL DEFAULT 24,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE slot_template_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES slot_templates(id) ON DELETE CASCADE,
    weekday TEXT NOT NULL,
    slot_code TEXT NOT NULL,
    slot_order INTEGER NOT NULL,
    day_offset INTEGER NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME,
    open_end BOOLEAN NOT NULL DEFAULT false,
    required_active_count INTEGER,
    required_ruf_count INTEGER,
    full_attendance BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE person_slot_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_item_id UUID NOT NULL REFERENCES slot_template_items(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL DEFAULT 'blocked',
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id, template_item_id, rule_type)
);

ALTER TABLE duty_slots
ADD COLUMN IF NOT EXISTS template_item_id UUID REFERENCES slot_template_items(id) ON DELETE SET NULL;

CREATE TABLE planning_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    week_start DATE,
    week_end DATE,
    status TEXT NOT NULL DEFAULT 'draft',
    template_id UUID REFERENCES slot_templates(id) ON DELETE SET NULL,
    random_seed INTEGER NOT NULL DEFAULT 0,
    input_snapshot JSONB,
    summary_json JSONB,
    warnings JSONB,
    applied_at TIMESTAMP WITH TIME ZONE,
    applied_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE planning_run_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    planning_run_id UUID NOT NULL REFERENCES planning_runs(id) ON DELETE CASCADE,
    slot_id UUID NOT NULL REFERENCES duty_slots(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assignment_type TEXT NOT NULL DEFAULT 'active',
    score DOUBLE PRECISION NOT NULL DEFAULT 0,
    reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
    score_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_manual_fixed BOOLEAN NOT NULL DEFAULT false,
    is_late_slot BOOLEAN NOT NULL DEFAULT false,
    is_last_slot_of_day BOOLEAN NOT NULL DEFAULT false,
    is_friday_last_slot BOOLEAN NOT NULL DEFAULT false,
    required_active_count INTEGER NOT NULL DEFAULT 0,
    required_ruf_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (planning_run_id, slot_id, user_id)
);

CREATE TABLE planner_person_week_stats (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    week_end DATE,
    planning_run_id UUID REFERENCES planning_runs(id) ON DELETE SET NULL,
    total_slots INTEGER NOT NULL DEFAULT 0,
    active_slots INTEGER NOT NULL DEFAULT 0,
    ruf_slots INTEGER NOT NULL DEFAULT 0,
    late_slots INTEGER NOT NULL DEFAULT 0,
    friday_last_slots INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, week_start)
);

CREATE TABLE planner_person_stats (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_slots INTEGER NOT NULL DEFAULT 0,
    active_slots INTEGER NOT NULL DEFAULT 0,
    ruf_slots INTEGER NOT NULL DEFAULT 0,
    late_slots INTEGER NOT NULL DEFAULT 0,
    friday_last_slots INTEGER NOT NULL DEFAULT 0,
    planned_weeks INTEGER NOT NULL DEFAULT 0,
    last_planned_week_start DATE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
