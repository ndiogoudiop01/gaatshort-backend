-- Migration initiale Gaatshort (Phase 3).
-- Générée en rejouant les migrations du socle SOOBA sur PostgreSQL 16, puis en
-- supprimant les tables métier SOOBA. Équivalente au schéma Prisma de ce commit.
-- La RLS (prisma/sql/rls-policies.sql) est appliquée APRÈS cette migration.

CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

--
--

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

--
-- Name: AuthChannel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "AuthChannel" AS ENUM (
    'EMAIL_MAGIC_LINK',
    'EMAIL_OTP',
    'PHONE_OTP',
    'PASSWORD'
);

--
-- Name: DsrStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "DsrStatus" AS ENUM (
    'RECEIVED',
    'IN_PROGRESS',
    'COMPLETED',
    'REFUSED'
);

--
-- Name: DsrType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "DsrType" AS ENUM (
    'ACCESS',
    'ERASURE',
    'RECTIFICATION',
    'PORTABILITY',
    'OBJECTION'
);

--
-- Name: NotificationChannel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "NotificationChannel" AS ENUM (
    'EMAIL',
    'SMS',
    'PUSH',
    'IN_APP'
);

--
-- Name: NotificationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "NotificationStatus" AS ENUM (
    'QUEUED',
    'SENT',
    'DELIVERED',
    'FAILED',
    'SKIPPED'
);

--
-- Name: TenancyIsolation; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "TenancyIsolation" AS ENUM (
    'SHARED_RLS',
    'SCHEMA'
);

--
-- Name: TenantStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "TenantStatus" AS ENUM (
    'ACTIVE',
    'SUSPENDED',
    'ARCHIVED'
);

--
-- Name: UserStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE "UserStatus" AS ENUM (
    'PENDING',
    'ACTIVE',
    'SUSPENDED',
    'DELETED'
);

--
-- Name: f_unaccent(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION f_unaccent(text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
    AS $_$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $_$;

--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE analytics_events (
    id uuid NOT NULL,
    name text NOT NULL,
    properties jsonb DEFAULT '{}'::jsonb NOT NULL,
    country_code character(2),
    occurred_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    session_id text,
    tenant_id uuid NOT NULL,
    user_id uuid
);

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE audit_logs (
    id uuid NOT NULL,
    action text NOT NULL,
    before jsonb,
    after jsonb,
    actor_id uuid,
    actor_type text DEFAULT 'USER'::text NOT NULL,
    correlation_id text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ip_hash text,
    resource_id text,
    resource_type text NOT NULL,
    tenant_id uuid NOT NULL,
    user_agent text
);

--
-- Name: auth_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE auth_challenges (
    id uuid NOT NULL,
    channel "AuthChannel" NOT NULL,
    identifier text NOT NULL,
    purpose text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    consumed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    ip_hash text,
    max_attempts integer DEFAULT 5 NOT NULL,
    secret_hash text NOT NULL,
    tenant_id uuid NOT NULL
);

--
-- Name: auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE auth_sessions (
    id uuid NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp(3) without time zone NOT NULL,
    family_id uuid NOT NULL,
    ip_hash text,
    refresh_token_hash text NOT NULL,
    replaced_by_id uuid,
    revoked_at timestamp(3) without time zone,
    tenant_id uuid NOT NULL,
    user_agent text,
    user_id uuid NOT NULL
);

--
-- Name: consent_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE consent_definitions (
    id uuid NOT NULL,
    key text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    label text NOT NULL,
    purpose text NOT NULL,
    locale text DEFAULT 'fr'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_required boolean DEFAULT false NOT NULL,
    policy_url text,
    tenant_id uuid NOT NULL
);

--
-- Name: consent_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE consent_records (
    id uuid NOT NULL,
    granted boolean NOT NULL,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    consent_key text NOT NULL,
    consent_version integer NOT NULL,
    definition_id uuid NOT NULL,
    ip_hash text,
    occurred_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    subject_id text NOT NULL,
    subject_type text NOT NULL,
    tenant_id uuid NOT NULL,
    user_agent text
);

--
-- Name: countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE countries (
    code character(2) NOT NULL,
    name text NOT NULL,
    name_fr text NOT NULL,
    dial_code text NOT NULL,
    currency_code character(3) NOT NULL,
    flag_emoji text NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

--
-- Name: currencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE currencies (
    code character(3) NOT NULL,
    symbol text NOT NULL,
    name text NOT NULL,
    decimals integer NOT NULL,
    rate_to_xof numeric(20,6) NOT NULL
);

--
-- Name: data_subject_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE data_subject_requests (
    id uuid NOT NULL,
    type "DsrType" NOT NULL,
    status "DsrStatus" DEFAULT 'RECEIVED'::"DsrStatus" NOT NULL,
    completed_at timestamp(3) without time zone,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    due_at timestamp(3) without time zone NOT NULL,
    export_file_id uuid,
    handled_by_id uuid,
    requester_email text NOT NULL,
    resolution_note text,
    subject_user_id uuid,
    tenant_id uuid NOT NULL
);

--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE idempotency_keys (
    id uuid NOT NULL,
    key text NOT NULL,
    endpoint text NOT NULL,
    completed_at timestamp(3) without time zone,
    expires_at timestamp(3) without time zone NOT NULL,
    locked_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    request_hash text NOT NULL,
    response_body jsonb,
    response_status integer,
    tenant_id uuid NOT NULL
);

--
-- Name: metric_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE metric_snapshots (
    id uuid NOT NULL,
    key text NOT NULL,
    granularity text NOT NULL,
    dimensions jsonb DEFAULT '{}'::jsonb NOT NULL,
    value numeric(20,4) NOT NULL,
    bucket_at timestamp(3) without time zone NOT NULL,
    computed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tenant_id uuid NOT NULL
);

--
-- Name: notification_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE notification_templates (
    id uuid NOT NULL,
    key text NOT NULL,
    channel "NotificationChannel" NOT NULL,
    locale text DEFAULT 'fr'::text NOT NULL,
    subject text,
    body text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    tenant_id uuid NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);

--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE notifications (
    id uuid NOT NULL,
    recipient text NOT NULL,
    channel "NotificationChannel" NOT NULL,
    locale text DEFAULT 'fr'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status "NotificationStatus" DEFAULT 'QUEUED'::"NotificationStatus" NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    provider_id text,
    read_at timestamp(3) without time zone,
    sent_at timestamp(3) without time zone,
    template_key text NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid
);

--
-- Name: outbox_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE outbox_messages (
    id uuid NOT NULL,
    payload jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    aggregate_id text NOT NULL,
    aggregate_type text NOT NULL,
    event_name text NOT NULL,
    last_error text,
    occurred_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    processed_at timestamp(3) without time zone,
    tenant_id uuid NOT NULL
);

--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE permissions (
    id uuid NOT NULL,
    key text NOT NULL,
    resource text NOT NULL,
    action text NOT NULL,
    description text
);

--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE role_permissions (
    permission_id uuid NOT NULL,
    role_id uuid NOT NULL
);

--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE roles (
    id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    tenant_id uuid,
    updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

--
-- Name: tenant_countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE tenant_countries (
    tenant_id uuid NOT NULL,
    country_code character(2) NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL
);

--
-- Name: tenant_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE tenant_domains (
    id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    tenant_id uuid NOT NULL,
    verified_at timestamp(3) without time zone
);

--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE tenants (
    id uuid NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    status "TenantStatus" DEFAULT 'ACTIVE'::"TenantStatus" NOT NULL,
    isolation "TenancyIsolation" DEFAULT 'SHARED_RLS'::"TenancyIsolation" NOT NULL,
    timezone text DEFAULT 'Africa/Dakar'::text NOT NULL,
    branding jsonb DEFAULT '{}'::jsonb NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    default_country character(2) DEFAULT 'SN'::bpchar NOT NULL,
    default_currency character(3) DEFAULT 'XOF'::bpchar NOT NULL,
    default_locale text DEFAULT 'fr'::text NOT NULL,
    deleted_at timestamp(3) without time zone,
    feature_flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    legal_name text,
    schema_name text,
    updated_at timestamp(3) without time zone NOT NULL
);

--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE user_roles (
    granted_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    granted_by uuid,
    role_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL
);

--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE users (
    id uuid NOT NULL,
    email text,
    status "UserStatus" DEFAULT 'PENDING'::"UserStatus" NOT NULL,
    locale text DEFAULT 'fr'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    country_code character(2),
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp(3) without time zone,
    email_verified_at timestamp(3) without time zone,
    first_name text,
    last_login_at timestamp(3) without time zone,
    last_name text,
    mfa_enabled boolean DEFAULT false NOT NULL,
    password_hash text,
    phone_e164 text,
    phone_verified_at timestamp(3) without time zone,
    tenant_id uuid NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    all_countries boolean DEFAULT false NOT NULL,
    country_scope text[] DEFAULT ARRAY[]::text[]
);

--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);

--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

--
-- Name: auth_challenges auth_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY auth_challenges
    ADD CONSTRAINT auth_challenges_pkey PRIMARY KEY (id);

--
-- Name: auth_sessions auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (id);

--
-- Name: consent_definitions consent_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY consent_definitions
    ADD CONSTRAINT consent_definitions_pkey PRIMARY KEY (id);

--
-- Name: consent_records consent_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY consent_records
    ADD CONSTRAINT consent_records_pkey PRIMARY KEY (id);

--
-- Name: countries countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY countries
    ADD CONSTRAINT countries_pkey PRIMARY KEY (code);

--
-- Name: currencies currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY currencies
    ADD CONSTRAINT currencies_pkey PRIMARY KEY (code);

--
-- Name: data_subject_requests data_subject_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY data_subject_requests
    ADD CONSTRAINT data_subject_requests_pkey PRIMARY KEY (id);

--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id);

--
-- Name: metric_snapshots metric_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY metric_snapshots
    ADD CONSTRAINT metric_snapshots_pkey PRIMARY KEY (id);

--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (id);

--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

--
-- Name: outbox_messages outbox_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY outbox_messages
    ADD CONSTRAINT outbox_messages_pkey PRIMARY KEY (id);

--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);

--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);

--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);

--
-- Name: tenant_countries tenant_countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY tenant_countries
    ADD CONSTRAINT tenant_countries_pkey PRIMARY KEY (tenant_id, country_code);

--
-- Name: tenant_domains tenant_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY tenant_domains
    ADD CONSTRAINT tenant_domains_pkey PRIMARY KEY (id);

--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);

--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

--
-- Name: analytics_events_tenant_id_name_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_tenant_id_name_occurred_at_idx ON analytics_events USING btree (tenant_id, name, occurred_at DESC);

--
-- Name: analytics_events_tenant_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_tenant_id_occurred_at_idx ON analytics_events USING btree (tenant_id, occurred_at DESC);

--
-- Name: audit_logs_tenant_id_actor_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_tenant_id_actor_id_idx ON audit_logs USING btree (tenant_id, actor_id);

--
-- Name: audit_logs_tenant_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_tenant_id_created_at_idx ON audit_logs USING btree (tenant_id, created_at);

--
-- Name: audit_logs_tenant_id_resource_type_resource_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_tenant_id_resource_type_resource_id_idx ON audit_logs USING btree (tenant_id, resource_type, resource_id);

--
-- Name: auth_challenges_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_challenges_expires_at_idx ON auth_challenges USING btree (expires_at);

--
-- Name: auth_challenges_tenant_id_identifier_purpose_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_challenges_tenant_id_identifier_purpose_idx ON auth_challenges USING btree (tenant_id, identifier, purpose);

--
-- Name: auth_sessions_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions USING btree (expires_at);

--
-- Name: auth_sessions_refresh_token_hash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX auth_sessions_refresh_token_hash_key ON auth_sessions USING btree (refresh_token_hash);

--
-- Name: auth_sessions_tenant_id_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_sessions_tenant_id_user_id_idx ON auth_sessions USING btree (tenant_id, user_id);

--
-- Name: consent_definitions_tenant_id_is_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_definitions_tenant_id_is_active_idx ON consent_definitions USING btree (tenant_id, is_active);

--
-- Name: consent_definitions_tenant_id_key_version_locale_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX consent_definitions_tenant_id_key_version_locale_key ON consent_definitions USING btree (tenant_id, key, version, locale);

--
-- Name: consent_records_tenant_id_consent_key_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_records_tenant_id_consent_key_occurred_at_idx ON consent_records USING btree (tenant_id, consent_key, occurred_at DESC);

--
-- Name: consent_records_tenant_id_subject_type_subject_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consent_records_tenant_id_subject_type_subject_id_idx ON consent_records USING btree (tenant_id, subject_type, subject_id);

--
-- Name: data_subject_requests_tenant_id_status_due_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX data_subject_requests_tenant_id_status_due_at_idx ON data_subject_requests USING btree (tenant_id, status, due_at);

--
-- Name: idempotency_keys_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idempotency_keys_expires_at_idx ON idempotency_keys USING btree (expires_at);

--
-- Name: idempotency_keys_tenant_id_key_endpoint_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idempotency_keys_tenant_id_key_endpoint_key ON idempotency_keys USING btree (tenant_id, key, endpoint);

--
-- Name: metric_snapshots_tenant_id_key_bucket_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX metric_snapshots_tenant_id_key_bucket_at_idx ON metric_snapshots USING btree (tenant_id, key, bucket_at DESC);

--
-- Name: metric_snapshots_tenant_id_key_granularity_bucket_at_dimens_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX metric_snapshots_tenant_id_key_granularity_bucket_at_dimens_key ON metric_snapshots USING btree (tenant_id, key, granularity, bucket_at, dimensions);

--
-- Name: notification_templates_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_templates_tenant_id_idx ON notification_templates USING btree (tenant_id);

--
-- Name: notification_templates_tenant_id_key_channel_locale_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_templates_tenant_id_key_channel_locale_key ON notification_templates USING btree (tenant_id, key, channel, locale);

--
-- Name: notifications_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_tenant_id_status_idx ON notifications USING btree (tenant_id, status);

--
-- Name: notifications_tenant_id_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_tenant_id_user_id_created_at_idx ON notifications USING btree (tenant_id, user_id, created_at DESC);

--
-- Name: outbox_messages_processed_at_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_messages_processed_at_occurred_at_idx ON outbox_messages USING btree (processed_at, occurred_at);

--
-- Name: outbox_messages_tenant_id_aggregate_type_aggregate_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX outbox_messages_tenant_id_aggregate_type_aggregate_id_idx ON outbox_messages USING btree (tenant_id, aggregate_type, aggregate_id);

--
-- Name: permissions_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX permissions_key_key ON permissions USING btree (key);

--
-- Name: permissions_resource_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX permissions_resource_idx ON permissions USING btree (resource);

--
-- Name: roles_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX roles_tenant_id_idx ON roles USING btree (tenant_id);

--
-- Name: roles_tenant_id_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX roles_tenant_id_key_key ON roles USING btree (tenant_id, key);

--
-- Name: tenant_domains_domain_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenant_domains_domain_key ON tenant_domains USING btree (domain);

--
-- Name: tenant_domains_tenant_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenant_domains_tenant_id_idx ON tenant_domains USING btree (tenant_id);

--
-- Name: tenants_schema_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenants_schema_name_key ON tenants USING btree (schema_name);

--
-- Name: tenants_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX tenants_slug_key ON tenants USING btree (slug);

--
-- Name: tenants_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tenants_status_idx ON tenants USING btree (status);

--
-- Name: user_roles_tenant_id_role_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_roles_tenant_id_role_id_idx ON user_roles USING btree (tenant_id, role_id);

--
-- Name: users_tenant_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_tenant_id_created_at_idx ON users USING btree (tenant_id, created_at);

--
-- Name: users_tenant_id_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_tenant_id_email_key ON users USING btree (tenant_id, email);

--
-- Name: users_tenant_id_phone_e164_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_tenant_id_phone_e164_key ON users USING btree (tenant_id, phone_e164);

--
-- Name: users_tenant_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_tenant_id_status_idx ON users USING btree (tenant_id, status);

--
-- Name: auth_sessions auth_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY auth_sessions
    ADD CONSTRAINT auth_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: consent_records consent_records_definition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY consent_records
    ADD CONSTRAINT consent_records_definition_id_fkey FOREIGN KEY (definition_id) REFERENCES consent_definitions(id) ON UPDATE CASCADE ON DELETE RESTRICT;

--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES permissions(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: tenant_domains tenant_domains_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY tenant_domains
    ADD CONSTRAINT tenant_domains_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON UPDATE CASCADE ON DELETE CASCADE;

--
--
