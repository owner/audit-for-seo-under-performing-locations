// src/lib/notion-export.ts
// Generates a filled Notion-compatible markdown file from an AuditReport.
// Call generateNotionMarkdown(report) on the client, then trigger a download.

import type { AuditReport, CheckItem } from '../routes/-index.api'

function statusIcon(status: CheckItem['status']): string {
  switch (status) {
    case 'pass':
      return '✅'
    case 'fail':
      return '❌'
    case 'warning':
      return '⚠️'
    case 'na':
      return '➖'
    default:
      return '⬜'
  }
}

function healthIcon(rating: string): string {
  switch (rating) {
    case 'healthy':
      return '🟢'
    case 'needs-work':
      return '🟡'
    case 'critical':
      return '🔴'
    default:
      return '⬜'
  }
}

function checklist(items: CheckItem[]): string {
  return items
    .map(
      (item) =>
        `- ${statusIcon(item.status)}  ${item.label}${item.detail ? `\n  - *${item.detail}*` : ''}`,
    )
    .join('\n')
}

function trend(current: number, prior: number): string {
  if (!prior || prior === 0) return '—'
  const pct = Math.round(((current - prior) / prior) * 100)
  return pct >= 0 ? `↑ ${pct}%` : `↓ ${Math.abs(pct)}%`
}

export function generateNotionMarkdown(report: AuditReport): string {
  const today = new Date().toISOString().split('T')[0]

  const sessionMetric = report.metrics.find((m) => m.label === 'Organic sessions')
  const packMetric = report.metrics.find((m) => m.label === 'Local pack impressions')
  const rankMetric = report.metrics.find((m) => m.label === 'Avg. local rank')
  const indexedMetric = report.metrics.find((m) => m.label === 'Indexed pages')
  const callsMetric = report.metrics.find((m) => m.label.toLowerCase().includes('calls'))
  const viewsMetric = report.metrics.find((m) => m.label.toLowerCase().includes('views'))
  const reviewCountMetric = report.metrics.find((m) =>
    m.label.toLowerCase().includes('review count'),
  )
  const starMetric = report.metrics.find(
    (m) => m.label.toLowerCase().includes('star') || m.label.toLowerCase().includes('rating'),
  )

  const gbpHealth = report.healthSummary.find(
    (h) => h.area.toLowerCase().includes('google') || h.area.toLowerCase().includes('gbp'),
  )
  const onPageHealth = report.healthSummary.find(
    (h) => h.area.toLowerCase().includes('on-page') || h.area.toLowerCase().includes('schema'),
  )
  const technicalHealth = report.healthSummary.find(
    (h) => h.area.toLowerCase().includes('technical') || h.area.toLowerCase().includes('index'),
  )
  const rankingsHealth = report.healthSummary.find(
    (h) => h.area.toLowerCase().includes('ranking') || h.area.toLowerCase().includes('content'),
  )
  const llmHealth = report.healthSummary.find(
    (h) => h.area.toLowerCase().includes('llm') || h.area.toLowerCase().includes('aeo'),
  )

  return `# SEO Diagnostic & Action Plan — ${report.brand}

## 📌 Customer Snapshot

| Field | Value |
| --- | --- |
| Customer / Brand | ${report.brand} |
| Website | ${report.website} |
| Locations | 1 |
| Owner CSM / AM | ${report.csm ?? '—'} |
| SEO owner (this diagnosis) | ${report.seoOwner ?? 'Nadya'} |
| Date opened | ${report.dateOpened ?? '—'} |
| Reason for review | Underperforming location audit |
| Primary markets | ${report.primaryMarket ?? '—'} |
| Yext managed? | ${report.yextManaged ? 'Yes' : 'No'} |
| Launch date | ${report.launchDate ?? '—'} |
| Current Rank Tracking Tool | — |
| LLM Visibility Tracked? | — |

## 🎯 Presenting Problem

> *Automated SEO diagnostic run on ${today}. Location flagged as underperformer across one or more key metrics.*

**Key metrics at start of review**

| Metric | Current | Trend (90d) | Benchmark / target |
| --- | --- | --- | --- |
| Organic sessions | ${sessionMetric?.current ?? '—'} | ${sessionMetric?.trend ?? '—'} | — |
| Local pack impressions | ${packMetric?.current ?? '—'} | ${packMetric?.trend ?? '—'} | — |
| Avg. local rank (priority terms) | ${rankMetric?.current ?? '—'} | ${rankMetric?.trend ?? '—'} | — |
| Indexed location pages | ${indexedMetric?.current ?? '—'} | ${indexedMetric?.trend ?? '—'} | — |
| GBP calls / direction requests | ${callsMetric?.current ?? '—'} | ${callsMetric?.trend ?? '—'} | — |
| **GBP profile views** | ${viewsMetric?.current ?? '—'} | ${viewsMetric?.trend ?? '—'} | — |
| **Click-to-call conversion rate** | — | — | — |
| **Online orders / reservations (if tracked)** | — | — | — |
| **Google review count** | ${reviewCountMetric?.current ?? '—'} | ${reviewCountMetric?.trend ?? '—'} | Above top competitor |
| **Avg. star rating (Google)** | ${starMetric?.current ?? '—'} | ${starMetric?.trend ?? '—'} | 4.0+ |
| **AI Overview appearances (GSC)** | — | — | — |
| **LLM citations — ChatGPT / Perplexity / Gemini** | — | — | — |

## 📊 Health Summary

*Score each area after running the diagnostics below. Rating: 🟢 Healthy · 🟡 Needs work · 🔴 Critical.*

| Area | Rating | Top issue | Priority |
| --- | --- | --- | --- |
| Google Business Profile & listings | ${healthIcon(gbpHealth?.rating ?? 'unknown')} | ${gbpHealth?.topIssue ?? '—'} | ${gbpHealth?.priority ?? '—'} |
| On-page & schema | ${healthIcon(onPageHealth?.rating ?? 'unknown')} | ${onPageHealth?.topIssue ?? '—'} | ${onPageHealth?.priority ?? '—'} |
| Technical & indexing | ${healthIcon(technicalHealth?.rating ?? 'unknown')} | ${technicalHealth?.topIssue ?? '—'} | ${technicalHealth?.priority ?? '—'} |
| Rankings, content & reviews | ${healthIcon(rankingsHealth?.rating ?? 'unknown')} | ${rankingsHealth?.topIssue ?? '—'} | ${rankingsHealth?.priority ?? '—'} |
| LLM / AEO Visibility ★ NEW | ${healthIcon(llmHealth?.rating ?? 'unknown')} | ${llmHealth?.topIssue ?? '—'} | ${llmHealth?.priority ?? '—'} |

---

# 🔎 Diagnostics

## 1. Google Business Profile & Listings

**Checklist — mark each as ✅ pass / ⚠️ issue / ➖ N/A**

### GBP Content & Engagement

${checklist(report.gbpChecks.filter((_, i) => i < Math.ceil(report.gbpChecks.length / 2)))}

### Review Velocity & Sentiment

${checklist(report.gbpChecks.filter((_, i) => i >= Math.ceil(report.gbpChecks.length / 2)))}

> **Findings:** ${report.findings['gbp'] ?? '—'}

> **Suspected root cause:** ${report.rootCauses['gbp'] ?? '—'}

## 2. On-Page & Schema

### On-Page Fundamentals

${checklist(report.onPageChecks.filter((c) => !c.id.includes('schema') && !c.id.includes('visual')))}

### Structured Data / Schema

${checklist(report.onPageChecks.filter((c) => c.id.includes('schema')))}

### Multimodal & Visual Search Optimization ★ NEW

${checklist(report.onPageChecks.filter((c) => c.id.includes('visual') || c.id.includes('image')))}

> **Findings:** ${report.findings['onPage'] ?? '—'}

> **Suspected root cause:** ${report.rootCauses['onPage'] ?? '—'}

## 3. Technical & Indexing

### Crawl & Index Health

${checklist(report.technicalChecks.filter((c) => !c.id.includes('cwv') && !c.id.includes('perf') && !c.id.includes('llm')))}

### Performance & Core Web Vitals

${checklist(report.technicalChecks.filter((c) => c.id.includes('cwv') || c.id.includes('perf') || c.id.includes('speed') || c.id.includes('https')))}

### LLM Crawlability ★ NEW

${checklist(report.technicalChecks.filter((c) => c.id.includes('llm') || c.id.includes('bot') || c.id.includes('llms')))}

> **Findings:** ${report.findings['technical'] ?? '—'}

> **Suspected root cause:** ${report.rootCauses['technical'] ?? '—'}

## 4. Rankings, Content & Reviews

${checklist(report.rankingsChecks)}

> **Findings:** ${report.findings['rankings'] ?? '—'}

> **Suspected root cause:** ${report.rootCauses['rankings'] ?? '—'}

---

## 5. Citations & Local Authority

### Core Citation Health

${checklist((report.citationsChecks ?? []).filter((c) => !c.id.includes('link') && !c.id.includes('eeat')))}

### Local Link Building

${checklist((report.citationsChecks ?? []).filter((c) => c.id.includes('link')))}

### E-E-A-T & Trust Signals

${checklist((report.citationsChecks ?? []).filter((c) => c.id.includes('eeat') || c.id.includes('trust')))}

> **Findings:** ${report.findings['citations'] ?? '—'}

> **Suspected root cause:** ${report.rootCauses['citations'] ?? '—'}

## 6. LLM / AEO Visibility ★ NEW

### Current Visibility Audit

${checklist((report.llmChecks ?? []).filter((c) => c.id.includes('audit') || c.id.includes('query') || c.id.includes('check')))}

### Knowledge Graph & Entity Presence

${checklist((report.llmChecks ?? []).filter((c) => c.id.includes('kg') || c.id.includes('entity') || c.id.includes('wiki')))}

### Content Signals for LLM Training & RAG Retrieval

${checklist((report.llmChecks ?? []).filter((c) => c.id.includes('content') || c.id.includes('faq') || c.id.includes('html')))}

### Community Forum & UGC Sentiment ★ NEW

${checklist((report.llmChecks ?? []).filter((c) => c.id.includes('reddit') || c.id.includes('forum') || c.id.includes('ugc')))}

### AEO Attribution & Analytics ★ NEW

${checklist((report.llmChecks ?? []).filter((c) => c.id.includes('ga4') || c.id.includes('analytics') || c.id.includes('track')))}

> **Findings:** ${report.findings['llm'] ?? '—'}

> **Suspected root cause:** ${report.rootCauses['llm'] ?? '—'}

---

# ✅ Action Tracker

*Log every action taken to fix the issues found above. Update Status and Result as work progresses.*

| Action | Area | Owner | Priority | Status | Date | Expected impact | Result / outcome |
| --- | --- | --- | --- | --- | --- | --- | --- |
${report.top3Actions.map((action, i) => `| ${action} | — | ${report.csm ?? '—'} | P${i} | Not started | ${today} | — | — |`).join('\n')}
|  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |

# 📅 Review Log

*Check back after changes propagate (allow 2–4 weeks for indexing/listing updates).*

| Date | Reviewer | What changed | Metric movement | Next step |
| --- | --- | --- | --- | --- |
| ${today} | ${report.seoOwner ?? 'Nadya'} | Initial diagnostic run | — | Address P0 actions |
|  |  |  |  |  |

# 🧾 Summary & Recommendation

> **Diagnosis:** ${report.diagnosis}

> **Top 3 actions:** ${report.top3Actions.map((a, i) => `[${i + 1}] ${a}`).join(' · ')}

> **Expected timeline to recovery:** ${report.timeline}

> **Status:** ${report.status}
`
}

export function downloadNotionDoc(report: AuditReport): void {
  const md = generateNotionMarkdown(report)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `SEO-Audit-${report.brand.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.md`
  a.click()
  URL.revokeObjectURL(url)
}
