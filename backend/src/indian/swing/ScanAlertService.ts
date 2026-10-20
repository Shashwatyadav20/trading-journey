/**
 * ScanAlertService — Scan lifecycle notification dispatcher
 *
 * Phase 1: Console logging + Supabase `scan_alerts` row.
 * Phase 2: Set ALERT_WEBHOOK_URL in backend/.env to dispatch to
 *          Telegram, Slack, or any HTTP webhook endpoint.
 *
 * Usage:
 *   await scanAlertService.send({ type: 'SCAN_COMPLETED', ... });
 *
 * This is intentionally fire-and-forget from the worker perspective:
 * alert delivery failures are logged but never throw.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AlertType =
  | 'SCAN_COMPLETED'
  | 'SCAN_PARTIAL'
  | 'SCAN_FAILED'
  | 'SCAN_STALLED'
  | 'SCHEDULER_TRIGGERED'
  | 'SCHEDULER_SKIPPED';

export interface ScanAlert {
  type: AlertType;
  scanDate: string;
  jobId?: string;
  summary: string;
  details: Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

class ScanAlertService {
  private supabase: SupabaseClient | null = null;

  private getClient(): SupabaseClient | null {
    if (this.supabase) return this.supabase;
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
    this.supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return this.supabase;
  }

  /**
   * Dispatches a scan alert. Non-throwing — all errors are logged.
   */
  async send(alert: ScanAlert): Promise<void> {
    const logPrefix = `[ScanAlertService][${alert.type}]`;

    // ── 1. Console log (always) ───────────────────────────────────────────
    console.log(`${logPrefix} ${alert.summary}`, JSON.stringify(alert.details, null, 2));

    // ── 2. Supabase row (Phase 1) ─────────────────────────────────────────
    const client = this.getClient();
    let webhookSent = false;
    let webhookError: string | undefined;

    if (client) {
      try {
        await client.from('scan_alerts').insert({
          alert_type: alert.type,
          scan_date: alert.scanDate,
          job_id: alert.jobId ?? null,
          summary: alert.summary,
          details: alert.details,
          webhook_sent: false,
          created_at: new Date().toISOString(),
        });
      } catch (dbErr: any) {
        console.error(`${logPrefix} Supabase write failed (non-fatal): ${dbErr?.message}`);
      }
    }

    // ── 3. Webhook (Phase 2 — only if configured) ────────────────────────
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `*[NSE Scanner]* ${alert.type}: ${alert.summary}`,
            alert,
          }),
          signal: AbortSignal.timeout(5000),
        });
        webhookSent = response.ok;
        if (!response.ok) {
          webhookError = `HTTP ${response.status}`;
          console.warn(`${logPrefix} Webhook delivery failed: ${webhookError}`);
        }
      } catch (whErr: any) {
        webhookError = whErr?.message || 'unknown webhook error';
        console.warn(`${logPrefix} Webhook exception (non-fatal): ${webhookError}`);
      }

      // Update webhook delivery status in DB if we wrote a row
      if (client && (webhookSent || webhookError)) {
        try {
          await client
            .from('scan_alerts')
            .update({ webhook_sent: webhookSent, webhook_error: webhookError ?? null })
            .eq('scan_date', alert.scanDate)
            .eq('alert_type', alert.type)
            .order('created_at', { ascending: false })
            .limit(1);
        } catch {
          // Non-fatal
        }
      }
    }
  }
}

export const scanAlertService = new ScanAlertService();
