import { Client } from 'pg';

import { createOneTimeToken } from '../../apps/api/src/modules/auth/auth-token.crypto';

const m1RateLimitScopes = [
  'EMAIL_VERIFICATION_EMAIL',
  'EMAIL_VERIFICATION_IP',
  'LOGIN_EMAIL',
  'LOGIN_IP',
  'PASSWORD_RESET_EMAIL',
  'PASSWORD_RESET_IP',
  'SIGN_UP_EMAIL',
  'SIGN_UP_IP',
  'TOKEN_IP',
  'TOKEN_VALUE',
  'WORKSPACE_INVITATION_EMAIL',
];

async function withDatabase<T>(run: (database: Client) => Promise<T>): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('M1 E2E fixture requires DATABASE_URL.');
  }

  const database = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
  });
  await database.connect();

  try {
    return await run(database);
  } finally {
    await database.end();
  }
}

export async function clearM1RateLimits(): Promise<void> {
  await withDatabase(async (database) => {
    await database.query('DELETE FROM auth_rate_limit_buckets WHERE scope = ANY($1::text[])', [
      m1RateLimitScopes,
    ]);
  });
}

export async function getLatestM1Token(
  email: string,
  purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
): Promise<string> {
  return withDatabase(async (database) => {
    const result = await database.query<{ id: string }>(
      `SELECT token.id
       FROM one_time_tokens AS token
       INNER JOIN users AS account ON account.id = token.user_id
       WHERE account.normalized_email = $1
         AND token.purpose::text = $2
       ORDER BY token.created_at DESC
       LIMIT 1`,
      [email.trim().toLowerCase(), purpose],
    );
    const tokenId = result.rows[0]?.id;
    if (!tokenId) {
      throw new Error(`M1 E2E token was not created for ${purpose}.`);
    }

    const hmacKey = process.env.ONE_TIME_TOKEN_HMAC_KEY;
    if (!hmacKey) {
      throw new Error('M1 E2E fixture requires ONE_TIME_TOKEN_HMAC_KEY.');
    }

    return createOneTimeToken(purpose, hmacKey, tokenId).token;
  });
}

export async function getLatestWorkspaceInvitationToken(email: string): Promise<string> {
  return withDatabase(async (database) => {
    const result = await database.query<{ id: string }>(
      `SELECT token.id
       FROM one_time_tokens AS token
       INNER JOIN workspace_invitations AS invitation
         ON invitation.id = token.invitation_id
       WHERE invitation.normalized_email = $1
         AND token.purpose::text = 'WORKSPACE_INVITATION'
         AND token.used_at IS NULL
         AND token.revoked_at IS NULL
       ORDER BY token.created_at DESC
       LIMIT 1`,
      [email.trim().toLowerCase()],
    );
    const tokenId = result.rows[0]?.id;
    if (!tokenId) {
      throw new Error('M2 E2E workspace invitation token was not created.');
    }

    const hmacKey = process.env.ONE_TIME_TOKEN_HMAC_KEY;
    if (!hmacKey) {
      throw new Error('M2 E2E fixture requires ONE_TIME_TOKEN_HMAC_KEY.');
    }

    return createOneTimeToken('WORKSPACE_INVITATION', hmacKey, tokenId).token;
  });
}

export async function cleanupM2Users(emails: string[]): Promise<void> {
  await withDatabase(async (database) => {
    await database.query('BEGIN');
    try {
      const normalizedEmails = emails.map((email) => email.trim().toLowerCase());
      const users = await database.query<{ id: string }>(
        'SELECT id FROM users WHERE normalized_email = ANY($1::text[]) FOR UPDATE',
        [normalizedEmails],
      );
      const userIds = users.rows.map(({ id }) => id);
      if (userIds.length === 0) {
        await database.query('COMMIT');
        return;
      }

      const workspaces = await database.query<{ id: string }>(
        'SELECT id FROM workspaces WHERE created_by_user_id = ANY($1::uuid[]) FOR UPDATE',
        [userIds],
      );
      const workspaceIds = workspaces.rows.map(({ id }) => id);
      const memberships = await database.query<{ id: string }>(
        `SELECT id
         FROM workspace_memberships
         WHERE workspace_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])
         FOR UPDATE`,
        [workspaceIds, userIds],
      );
      const membershipIds = memberships.rows.map(({ id }) => id);
      const invitations = await database.query<{ id: string }>(
        `SELECT id
         FROM workspace_invitations
         WHERE workspace_id = ANY($1::uuid[])
         FOR UPDATE`,
        [workspaceIds],
      );
      const invitationIds = invitations.rows.map(({ id }) => id);
      const outboxEvents = await database.query<{ id: string }>(
        `SELECT id
         FROM outbox_events
         WHERE workspace_id = ANY($1::uuid[])
            OR aggregate_id = ANY($2::uuid[])
            OR aggregate_id = ANY($3::uuid[])
            OR actor_membership_id = ANY($4::uuid[])
         FOR UPDATE`,
        [workspaceIds, userIds, invitationIds, membershipIds],
      );
      const outboxEventIds = outboxEvents.rows.map(({ id }) => id);

      await database.query(
        `DELETE FROM web_push_deliveries
         WHERE subscription_id IN (
           SELECT id FROM web_push_subscriptions
           WHERE workspace_id = ANY($1::uuid[]) OR membership_id = ANY($2::uuid[])
         )`,
        [workspaceIds, membershipIds],
      );
      await database.query(
        `DELETE FROM web_push_subscriptions
         WHERE workspace_id = ANY($1::uuid[]) OR membership_id = ANY($2::uuid[])`,
        [workspaceIds, membershipIds],
      );
      await database.query('DELETE FROM notifications WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM email_deliveries WHERE outbox_event_id = ANY($1::uuid[])', [
        outboxEventIds,
      ]);
      await database.query('DELETE FROM outbox_events WHERE id = ANY($1::uuid[])', [
        outboxEventIds,
      ]);
      await database.query(
        `DELETE FROM one_time_tokens
         WHERE user_id = ANY($1::uuid[]) OR invitation_id = ANY($2::uuid[])`,
        [userIds, invitationIds],
      );
      await database.query('DELETE FROM activity_events WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM import_source_rows WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM import_runs WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query(
        `DELETE FROM export_audits
         WHERE workspace_id = ANY($1::uuid[])
            OR requested_by_membership_id = ANY($2::uuid[])`,
        [workspaceIds, membershipIds],
      );
      await database.query('DELETE FROM api_handoff_targets WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM api_handoffs WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM issue_subscriptions WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM issue_labels WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query(
        'DELETE FROM issue_file_attachments WHERE workspace_id = ANY($1::uuid[])',
        [workspaceIds],
      );
      await database.query('DELETE FROM mentions WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM comments WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM team_works WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM issues WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query(
        'DELETE FROM issue_template_labels WHERE workspace_id = ANY($1::uuid[])',
        [workspaceIds],
      );
      await database.query('DELETE FROM issue_templates WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM project_role_teams WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM projects WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query(
        `DELETE FROM team_members
         WHERE workspace_id = ANY($1::uuid[]) OR membership_id = ANY($2::uuid[])`,
        [workspaceIds, membershipIds],
      );
      await database.query('DELETE FROM workflow_states WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM teams WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM labels WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query('DELETE FROM workspace_invitations WHERE id = ANY($1::uuid[])', [
        invitationIds,
      ]);
      await database.query(
        `DELETE FROM saved_views
         WHERE workspace_id = ANY($1::uuid[]) OR membership_id = ANY($2::uuid[])`,
        [workspaceIds, membershipIds],
      );
      await database.query('DELETE FROM product_feedback WHERE workspace_id = ANY($1::uuid[])', [
        workspaceIds,
      ]);
      await database.query(
        `DELETE FROM product_event_states
         WHERE workspace_id = ANY($1::uuid[]) OR membership_id = ANY($2::uuid[])`,
        [workspaceIds, membershipIds],
      );
      await database.query(
        `UPDATE workspace_memberships
         SET invited_by_membership_id = NULL
         WHERE invited_by_membership_id = ANY($1::uuid[])`,
        [membershipIds],
      );
      await database.query(
        `DELETE FROM workspace_memberships
         WHERE workspace_id = ANY($1::uuid[]) OR user_id = ANY($2::uuid[])`,
        [workspaceIds, userIds],
      );
      await database.query('UPDATE users SET avatar_file_id = NULL WHERE id = ANY($1::uuid[])', [
        userIds,
      ]);
      await database.query(
        'DELETE FROM files WHERE workspace_id = ANY($1::uuid[]) OR uploaded_by_user_id = ANY($2::uuid[])',
        [workspaceIds, userIds],
      );
      await database.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [workspaceIds]);
      await database.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [userIds]);
      await database.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }
  });
}

export async function cleanupM1User(email: string): Promise<void> {
  await withDatabase(async (database) => {
    await database.query('BEGIN');
    try {
      const userResult = await database.query<{ id: string }>(
        'SELECT id FROM users WHERE normalized_email = $1 FOR UPDATE',
        [email.trim().toLowerCase()],
      );
      const userId = userResult.rows[0]?.id;
      if (!userId) {
        await database.query('COMMIT');
        return;
      }

      const workspaceSubquery = 'SELECT id FROM workspaces WHERE created_by_user_id = $1';
      const outboxSubquery = `SELECT id FROM outbox_events
                              WHERE aggregate_id = $1
                                 OR workspace_id IN (${workspaceSubquery})`;

      await database.query(
        `DELETE FROM web_push_deliveries
         WHERE subscription_id IN (
           SELECT id FROM web_push_subscriptions
           WHERE workspace_id IN (${workspaceSubquery})
         )`,
        [userId],
      );
      await database.query(
        `DELETE FROM web_push_subscriptions
         WHERE workspace_id IN (${workspaceSubquery})`,
        [userId],
      );
      await database.query(
        `DELETE FROM email_deliveries WHERE outbox_event_id IN (${outboxSubquery})`,
        [userId],
      );
      await database.query(
        `DELETE FROM outbox_events
         WHERE aggregate_id = $1 OR workspace_id IN (${workspaceSubquery})`,
        [userId],
      );
      for (const table of [
        'issue_template_labels',
        'issue_templates',
        'product_feedback',
        'product_event_states',
        'saved_views',
        'workflow_states',
        'team_members',
        'teams',
        'workspace_memberships',
      ]) {
        await database.query(`DELETE FROM ${table} WHERE workspace_id IN (${workspaceSubquery})`, [
          userId,
        ]);
      }
      await database.query('DELETE FROM workspaces WHERE created_by_user_id = $1', [userId]);
      await database.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await database.query('DELETE FROM one_time_tokens WHERE user_id = $1', [userId]);
      await database.query('DELETE FROM users WHERE id = $1', [userId]);
      await database.query('COMMIT');
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    }
  });
}
