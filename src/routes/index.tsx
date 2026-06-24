import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { getCurrentUser, doRequireAuth, doSignOut, runAudit } from './-index.api'
import type { AuditReport, CheckItem, CheckStatus } from './-index.api'
import { downloadNotionDoc } from '../lib/notion-export'
import type { CriticalAlert } from './-index.api'

// These imports are only here to keep the build happy if the old -index.api.ts
// is still in place. They are never actually called.
// @ts-ignore
const _unused = { getCounter: null, listFiles: null, incrementCounter: null, uploadFile: null }

export const Route = createFileRoute('/')({
  loader: async () => {
    const user = await getCurrentUser()
    if (!user) await doRequireAuth()
    return { user: user! }
  },
  component: IndexPage,
})

// ─── Status helpers ────────────────────────────────────────────────────────

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: '✅ Pass',
  fail: '❌ Fail',
  warning: '⚠️ Warning',
  na: '➖ N/A',
  pending: '🔲 Pending',
}

const STATUS_COLOR: Record<CheckStatus, string> = {
  pass: '#166534',
  fail: '#991b1b',
  warning: '#92400e',
  na: '#6b7280',
  pending: '#374151',
}

const STATUS_BG: Record<CheckStatus, string> = {
  pass: '#dcfce7',
  fail: '#fee2e2',
  warning: '#fef3c7',
  na: '#f3f4f6',
  pending: '#f9fafb',
}

const HEALTH_EMOJI: Record<string, string> = {
  healthy: '🟢',
  'needs-work': '🟡',
  critical: '🔴',
  unknown: '⬜',
}

// ─── Sub-components ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CheckStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 500,
        background: STATUS_BG[status],
        color: STATUS_COLOR[status],
        whiteSpace: 'nowrap',
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function CheckTable({ title, checks }: { title: string; checks: CheckItem[] }) {
  const fails = checks.filter((c) => c.status === 'fail').length
  const warnings = checks.filter((c) => c.status === 'warning').length
  const passes = checks.filter((c) => c.status === 'pass').length

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: 0 }}>{title}</h3>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          {passes} pass · {warnings} warning · {fails} fail
        </span>
      </div>
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#f9fafb' }}>
              <th
                style={{
                  padding: '8px 14px',
                  textAlign: 'left',
                  fontWeight: 500,
                  color: '#6b7280',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  width: '40%',
                  borderBottom: '1px solid #e5e7eb',
                }}
              >
                Check
              </th>
              <th
                style={{
                  padding: '8px 14px',
                  textAlign: 'left',
                  fontWeight: 500,
                  color: '#6b7280',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  width: '15%',
                  borderBottom: '1px solid #e5e7eb',
                }}
              >
                Status
              </th>
              <th
                style={{
                  padding: '8px 14px',
                  textAlign: 'left',
                  fontWeight: 500,
                  color: '#6b7280',
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderBottom: '1px solid #e5e7eb',
                }}
              >
                Detail
              </th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c, i) => (
              <tr
                key={c.id}
                style={{
                  borderTop: i > 0 ? '1px solid #f3f4f6' : undefined,
                  background: c.status === 'fail' ? '#fff9f9' : 'white',
                }}
              >
                <td
                  style={{
                    padding: '9px 14px',
                    color: '#111827',
                    fontWeight: 500,
                    verticalAlign: 'top',
                  }}
                >
                  {c.label}
                </td>
                <td style={{ padding: '9px 14px', verticalAlign: 'top' }}>
                  <StatusBadge status={c.status} />
                </td>
                <td
                  style={{
                    padding: '9px 14px',
                    color: '#6b7280',
                    verticalAlign: 'top',
                    lineHeight: 1.5,
                  }}
                >
                  {c.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
function CriticalAlerts({ alerts }: { alerts: CriticalAlert[] }) {
  if (!alerts || alerts.length === 0) return null
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>🚨</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>Critical Issues</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            background: '#fef2f2',
            color: '#dc2626',
            border: '1px solid #fecaca',
            borderRadius: 4,
            padding: '2px 8px',
          }}
        >
          {alerts.filter((a) => a.severity === 'P0').length} P0
          {alerts.filter((a) => a.severity === 'P1').length > 0 &&
            ` · ${alerts.filter((a) => a.severity === 'P1').length} P1`}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {alerts.map((alert) => (
          <div
            key={alert.id}
            style={{
              background: alert.severity === 'P0' ? '#fff5f5' : '#fffbeb',
              border: `1px solid ${alert.severity === 'P0' ? '#fecaca' : '#fde68a'}`,
              borderLeft: `4px solid ${alert.severity === 'P0' ? '#dc2626' : '#f59e0b'}`,
              borderRadius: 8,
              padding: '12px 16px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: alert.severity === 'P0' ? '#dc2626' : '#d97706',
                    background: alert.severity === 'P0' ? '#fef2f2' : '#fef3c7',
                    border: `1px solid ${alert.severity === 'P0' ? '#fecaca' : '#fde68a'}`,
                    borderRadius: 4,
                    padding: '1px 6px',
                    flexShrink: 0,
                  }}
                >
                  {alert.severity}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#111827', lineHeight: 1.3 }}>
                  {alert.title}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', flexShrink: 0, textAlign: 'right' }}>
                <div>Detected: {alert.detectedAt}</div>
                {alert.estimatedSince && (
                  <div style={{ color: '#dc2626' }}>Est. since: {alert.estimatedSince}</div>
                )}
              </div>
            </div>
            <p style={{ fontSize: 12, color: '#374151', margin: '0 0 8px 0', lineHeight: 1.5 }}>
              {alert.description}
            </p>
            <div
              style={{
                fontSize: 12,
                color: alert.severity === 'P0' ? '#dc2626' : '#92400e',
                fontWeight: 500,
                display: 'flex',
                gap: 6,
              }}
            >
              <span>→</span>
              <span>{alert.action}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
// ─── Main page ─────────────────────────────────────────────────────────────

function IndexPage() {
  const { user } = Route.useLoaderData()
  const [locationId, setLocationId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<AuditReport | null>(null)

  async function handleSignOut() {
    const { logoutUrl } = await doSignOut()
    window.location.href = logoutUrl
  }

  async function handleRun(e: React.FormEvent) {
    e.preventDefault()
    if (!locationId.trim()) return
    setLoading(true)
    setError(null)
    setReport(null)
    try {
      const result = await runAudit({ data: { locationId: locationId.trim() } })
      setReport(result)
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong. Check the location ID and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Header */}
      <header style={{ background: 'white', borderBottom: '1px solid #e5e7eb', padding: '0 24px' }}>
        <div
          style={{
            maxWidth: 1100,
            margin: '0 auto',
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{ fontSize: 18, fontWeight: 700, color: '#111827', letterSpacing: '-0.02em' }}
            >
              SEO Audit
            </span>
            <span
              style={{
                fontSize: 12,
                background: '#eff6ff',
                color: '#1d4ed8',
                padding: '2px 8px',
                borderRadius: 4,
                fontWeight: 500,
              }}
            >
              Under-Performing Locations
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#6b7280' }}>{user.email}</span>
            <button
              type="button"
              onClick={handleSignOut}
              style={{
                fontSize: 13,
                color: '#374151',
                background: 'white',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                padding: '5px 12px',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        {/* Search bar */}
        <div
          style={{
            background: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: 10,
            padding: '24px 28px',
            marginBottom: 28,
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, color: '#111827', margin: '0 0 6px' }}>
            Run SEO Diagnostic
          </h2>
          <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px' }}>
            Enter a location ID to pull all available data and run automated checks.
          </p>
          <form onSubmit={handleRun} style={{ display: 'flex', gap: 10 }}>
            <input
              type="text"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              placeholder="e.g. LOC-00423"
              style={{
                flex: 1,
                padding: '9px 14px',
                fontSize: 14,
                border: '1px solid #d1d5db',
                borderRadius: 7,
                outline: 'none',
                fontFamily: 'monospace',
              }}
            />
            <button
              type="submit"
              disabled={loading || !locationId.trim()}
              style={{
                padding: '9px 22px',
                fontSize: 14,
                fontWeight: 500,
                background: loading ? '#9ca3af' : '#1d4ed8',
                color: 'white',
                border: 'none',
                borderRadius: 7,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Running…' : 'Run Audit'}
            </button>
          </form>
          {error && (
            <div
              style={{
                marginTop: 12,
                padding: '10px 14px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 6,
                fontSize: 13,
                color: '#991b1b',
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Report */}
        {report && (
          <div>
            {/* Customer snapshot */}
            <div
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: '24px 28px',
                marginBottom: 24,
              }}
            >
              <CriticalAlerts alerts={report.criticalAlerts ?? []} />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  marginBottom: 16,
                }}
              >
                <div>
                  <h2
                    style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}
                  >
                    {report.brand}
                  </h2>
                  <a
                    href={report.website}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 13, color: '#2563eb' }}
                  >
                    {report.website}
                  </a>
                </div>
                <span
                  style={{
                    fontSize: 12,
                    background: '#f0fdf4',
                    color: '#166534',
                    border: '1px solid #bbf7d0',
                    borderRadius: 6,
                    padding: '4px 10px',
                    fontWeight: 500,
                  }}
                >
                  {report.status}
                </span>
                <button
                  onClick={() => downloadNotionDoc(report)}
                  style={{
                    marginLeft: 12,
                    padding: '4px 14px',
                    fontSize: 12,
                    fontWeight: 500,
                    background: '#000',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  ⬇ Download for Notion
                </button>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: 12,
                }}
              >
                {[
                  ['Location ID', report.locationId],
                  ['Primary market', report.primaryMarket],
                  ['CSM / AM', report.csm],
                  ['SEO owner', report.seoOwner],
                  ['Date opened', report.dateOpened],
                  ['Yext managed', report.yextManaged ? 'Yes' : 'No'],
                  ['Launch date', report.launchDate],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{ background: '#f9fafb', borderRadius: 6, padding: '10px 14px' }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        color: '#9ca3af',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        marginBottom: 4,
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Key metrics */}
            <div
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: '24px 28px',
                marginBottom: 24,
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: '0 0 14px' }}>
                📊 Key Metrics (last 30 days)
              </h3>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      {['Metric', 'Current', 'Trend (90d)', 'Benchmark'].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '8px 14px',
                            textAlign: 'left',
                            fontWeight: 500,
                            color: '#6b7280',
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            borderBottom: '1px solid #e5e7eb',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.metrics.map((m, i) => (
                      <tr
                        key={m.label}
                        style={{ borderTop: i > 0 ? '1px solid #f3f4f6' : undefined }}
                      >
                        <td style={{ padding: '9px 14px', fontWeight: 500, color: '#111827' }}>
                          {m.label}
                        </td>
                        <td
                          style={{ padding: '9px 14px', color: '#111827', fontFamily: 'monospace' }}
                        >
                          {m.current}
                        </td>
                        <td
                          style={{
                            padding: '9px 14px',
                            color: m.trend.startsWith('↓')
                              ? '#991b1b'
                              : m.trend.startsWith('↑')
                                ? '#166534'
                                : '#6b7280',
                          }}
                        >
                          {m.trend}
                        </td>
                        <td style={{ padding: '9px 14px', color: '#6b7280' }}>{m.benchmark}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Health summary */}
            <div
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: '24px 28px',
                marginBottom: 24,
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: '0 0 14px' }}>
                🏥 Health Summary
              </h3>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb' }}>
                      {['Area', 'Rating', 'Top issue', 'Priority'].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: '8px 14px',
                            textAlign: 'left',
                            fontWeight: 500,
                            color: '#6b7280',
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            borderBottom: '1px solid #e5e7eb',
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.healthSummary.map((h, i) => (
                      <tr
                        key={h.area}
                        style={{
                          borderTop: i > 0 ? '1px solid #f3f4f6' : undefined,
                          background: h.rating === 'critical' ? '#fff9f9' : 'white',
                        }}
                      >
                        <td style={{ padding: '9px 14px', fontWeight: 500, color: '#111827' }}>
                          {h.area}
                        </td>
                        <td style={{ padding: '9px 14px' }}>
                          {HEALTH_EMOJI[h.rating]} {h.rating}
                        </td>
                        <td style={{ padding: '9px 14px', color: '#6b7280' }}>{h.topIssue}</td>
                        <td style={{ padding: '9px 14px' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              background:
                                h.priority === 'P0'
                                  ? '#fee2e2'
                                  : h.priority === 'P1'
                                    ? '#fef3c7'
                                    : '#f3f4f6',
                              color:
                                h.priority === 'P0'
                                  ? '#991b1b'
                                  : h.priority === 'P1'
                                    ? '#92400e'
                                    : '#374151',
                            }}
                          >
                            {h.priority}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Diagnostics */}
            <div
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: '24px 28px',
                marginBottom: 24,
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: '0 0 20px' }}>
                🔎 Diagnostics
              </h3>
              <CheckTable title="1. Google Business Profile & Listings" checks={report.gbpChecks} />
              <CheckTable title="2. On-Page & Schema" checks={report.onPageChecks} />
              <CheckTable title="3. Technical & Indexing" checks={report.technicalChecks} />
              <CheckTable title="4. Rankings, Content & Reviews" checks={report.rankingsChecks} />
              <CheckTable title="5. Citations & Local Authority" checks={report.citationsChecks} />
              <CheckTable title="6. LLM / AEO Visibility ★" checks={report.llmChecks} />
            </div>

            {/* Summary */}
            <div
              style={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: '24px 28px',
                marginBottom: 24,
              }}
            >
              <h3 style={{ fontSize: 15, fontWeight: 600, color: '#111827', margin: '0 0 16px' }}>
                🧾 Summary & Recommendation
              </h3>
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: '#9ca3af',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 6,
                  }}
                >
                  Diagnosis
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: '#111827',
                    lineHeight: 1.6,
                    padding: '10px 14px',
                    background: '#f9fafb',
                    borderRadius: 6,
                  }}
                >
                  {report.diagnosis}
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: '#9ca3af',
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 6,
                  }}
                >
                  Top 3 actions
                </div>
                <ol style={{ margin: 0, paddingLeft: 20 }}>
                  {report.top3Actions.map((a, i) => (
                    <li
                      key={i}
                      style={{ fontSize: 13, color: '#111827', marginBottom: 4, lineHeight: 1.5 }}
                    >
                      {a}
                    </li>
                  ))}
                </ol>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <div
                  style={{ flex: 1, padding: '10px 14px', background: '#f9fafb', borderRadius: 6 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: '#9ca3af',
                      fontWeight: 500,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 4,
                    }}
                  >
                    Expected timeline
                  </div>
                  <div style={{ fontSize: 13, color: '#111827' }}>{report.timeline}</div>
                </div>
                <div
                  style={{ flex: 1, padding: '10px 14px', background: '#f9fafb', borderRadius: 6 }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: '#9ca3af',
                      fontWeight: 500,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 4,
                    }}
                  >
                    Status
                  </div>
                  <div style={{ fontSize: 13, color: '#111827' }}>{report.status}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!report && !loading && !error && (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: '#9ca3af' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: '#6b7280', marginBottom: 6 }}>
              Enter a location ID to get started
            </div>
            <div style={{ fontSize: 13 }}>
              The audit will run automated checks and pull all available data from your connected
              sources.
            </div>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: '#6b7280' }}>
            <div style={{ fontSize: 13 }}>Running audit… fetching data and crawling site…</div>
          </div>
        )}
      </main>
    </div>
  )
}
