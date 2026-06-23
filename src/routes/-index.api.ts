import { createServerFn } from '@tanstack/react-start'

async function getWorkerEnv() {
  const mod = await import('cloudflare:workers')
  return mod.env as unknown as Env
}

export const getCurrentUser = createServerFn({ method: 'GET' }).handler(async () => {
  const { getAuthUser } = await import('../lib/auth.server')
  return getAuthUser()
})

export const doRequireAuth = createServerFn({ method: 'GET' }).handler(async () => {
  const { requireAuth } = await import('../lib/auth.server')
  await requireAuth()
})

export const doSignOut = createServerFn({ method: 'POST' }).handler(async () => {
  const { signOut } = await import('../lib/auth.server')
  return signOut()
})

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'warning' | 'na' | 'pending'

export interface CheckItem {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

export interface MetricRow {
  label: string
  current: string
  trend: string
  benchmark: string
}

export interface AuditReport {
  locationId: string
  brand: string
  website: string
  primaryMarket: string
  csm: string
  seoOwner: string
  dateOpened: string
  yextManaged: boolean
  launchDate: string
  metrics: MetricRow[]
  healthSummary: {
    area: string
    rating: 'healthy' | 'needs-work' | 'critical' | 'unknown'
    topIssue: string
    priority: string
  }[]
  gbpChecks: CheckItem[]
  onPageChecks: CheckItem[]
  technicalChecks: CheckItem[]
  rankingsChecks: CheckItem[]
  citationsChecks: CheckItem[]
  llmChecks: CheckItem[]
  findings: Record<string, string>
  rootCauses: Record<string, string>
  diagnosis: string
  top3Actions: string[]
  timeline: string
  status: 'Diagnosing' | 'Actioning' | 'Monitoring' | 'Resolved'
}

// ─── Helper: fetch a URL and return basic info ─────────────────────────────

async function fetchPage(url: string): Promise<{ ok: boolean; html: string; status: number }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SEO-Audit-Bot/1.0' },
      redirect: 'follow',
    })
    const html = res.ok ? await res.text() : ''
    return { ok: res.ok, html, status: res.status }
  } catch {
    return { ok: false, html: '', status: 0 }
  }
}

function extractJsonLd(html: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (Array.isArray(parsed)) results.push(...parsed)
      else results.push(parsed)
    } catch {}
  }
  return results
}

function check(id: string, label: string, status: CheckStatus, detail: string): CheckItem {
  return { id, label, status, detail }
}

// ─── Main audit function ───────────────────────────────────────────────────

export const runAudit = createServerFn({ method: 'POST' })
  .validator((data: { locationId: string }) => data)
  .handler(async ({ data }): Promise<AuditReport> => {
    const { requireAuth } = await import('../lib/auth.server')
    await requireAuth()

    const env = await getWorkerEnv()
    const { locationId } = data

    // ── 1. Load location profile from D1 ──────────────────────────────────
    const location = await env.DB.prepare(`SELECT * FROM locations WHERE location_id = ? LIMIT 1`)
      .bind(locationId)
      .first<{
        location_id: string
        brand_name: string
        website_url: string
        primary_market: string
        csm_name: string
        seo_owner: string
        date_opened: string
        yext_managed: number
        launch_date: string
        gbp_listing_url: string
        avg_star_rating: number
        review_count: number
        gbp_profile_views_30d: number
        gbp_calls_30d: number
        gbp_directions_30d: number
        gbp_calls_90d: number
        gbp_profile_views_90d: number
        organic_sessions_30d: number
        organic_sessions_prior_30d: number
        local_pack_impressions_30d: number
        local_pack_impressions_prior_30d: number
        indexed_pages: number
        avg_local_rank: number
        yext_sync_status: string
      }>()

    if (!location) {
      throw new Error(`Location "${locationId}" not found. Check the ID and try again.`)
    }

    const website = location.website_url?.replace(/\/$/, '') ?? ''

    // ── 2. Fetch website for crawl-based checks ────────────────────────────
    const [homePage, robotsPage, llmsTxt, sitemapXml] = await Promise.all([
      fetchPage(website),
      fetchPage(`${website}/robots.txt`),
      fetchPage(`${website}/llms.txt`),
      fetchPage(`${website}/sitemap.xml`),
    ])

    const html = homePage.html
    const robotsTxt = robotsPage.html
    const jsonLd = extractJsonLd(html)

    const hasSchema = (type: string) =>
      jsonLd.some(
        (s) =>
          s['@type'] === type ||
          (Array.isArray(s['@type']) && (s['@type'] as string[]).includes(type)),
      )

    const getSchema = (type: string) =>
      jsonLd.find(
        (s) =>
          s['@type'] === type ||
          (Array.isArray(s['@type']) && (s['@type'] as string[]).includes(type)),
      )

    const botBlocked = (bot: string) => {
      const lines = robotsTxt.split('\n')
      let inBlock = false
      for (const line of lines) {
        if (line.toLowerCase().includes(`user-agent: ${bot.toLowerCase()}`)) inBlock = true
        if (inBlock && line.toLowerCase().startsWith('disallow: /')) return true
        if (inBlock && line.trim() === '') inBlock = false
      }
      return false
    }

    // ── 3. Pull review stats from D1 ──────────────────────────────────────
    const reviewStats = await env.DB.prepare(
      `SELECT
        COUNT(*) as total_reviews,
        SUM(CASE WHEN owner_response IS NOT NULL THEN 1 ELSE 0 END) as responded,
        SUM(CASE WHEN created_at >= date('now', '-30 days') THEN 1 ELSE 0 END) as last_30d
      FROM reviews WHERE location_id = ?`,
    )
      .bind(locationId)
      .first<{ total_reviews: number; responded: number; last_30d: number }>()

    const responseRate =
      reviewStats && reviewStats.total_reviews > 0
        ? Math.round((reviewStats.responded / reviewStats.total_reviews) * 100)
        : 0

    // ── 4. Yext listing health from D1 ────────────────────────────────────
    const yextListings = await env.DB.prepare(
      `SELECT publisher, status, nap_match FROM yext_listings WHERE location_id = ?`,
    )
      .bind(locationId)
      .all<{ publisher: string; status: string; nap_match: number }>()

    const allYextGreen = yextListings.results?.every((l) => l.status === 'synced') ?? false
    const napConsistent = yextListings.results?.every((l) => l.nap_match === 1) ?? false

    // ── 5. Compute metrics ─────────────────────────────────────────────────
    const sessionsTrend =
      location.organic_sessions_prior_30d > 0
        ? Math.round(
            ((location.organic_sessions_30d - location.organic_sessions_prior_30d) /
              location.organic_sessions_prior_30d) *
              100,
          )
        : 0

    const packTrend =
      location.local_pack_impressions_prior_30d > 0
        ? Math.round(
            ((location.local_pack_impressions_30d - location.local_pack_impressions_prior_30d) /
              location.local_pack_impressions_prior_30d) *
              100,
          )
        : 0

    const metrics: MetricRow[] = [
      {
        label: 'Organic sessions',
        current: location.organic_sessions_30d?.toLocaleString() ?? '—',
        trend: sessionsTrend >= 0 ? `↑ ${sessionsTrend}%` : `↓ ${Math.abs(sessionsTrend)}%`,
        benchmark: '—',
      },
      {
        label: 'Local pack impressions',
        current: location.local_pack_impressions_30d?.toLocaleString() ?? '—',
        trend: packTrend >= 0 ? `↑ ${packTrend}%` : `↓ ${Math.abs(packTrend)}%`,
        benchmark: '—',
      },
      {
        label: 'Avg. local rank (priority terms)',
        current: location.avg_local_rank ? `#${location.avg_local_rank}` : '—',
        trend: '—',
        benchmark: 'Top 3',
      },
      {
        label: 'Indexed location pages',
        current: location.indexed_pages?.toString() ?? '—',
        trend: '—',
        benchmark: '—',
      },
      {
        label: 'GBP calls (30d)',
        current: location.gbp_calls_30d?.toLocaleString() ?? '—',
        trend: '—',
        benchmark: '—',
      },
      {
        label: 'GBP profile views (30d)',
        current: location.gbp_profile_views_30d?.toLocaleString() ?? '—',
        trend: '—',
        benchmark: '—',
      },
      {
        label: 'Google review count',
        current: location.review_count?.toLocaleString() ?? '—',
        trend: '—',
        benchmark: 'Above top competitor',
      },
      {
        label: 'Avg. star rating (Google)',
        current: location.avg_star_rating ? `${location.avg_star_rating} ★` : '—',
        trend: '—',
        benchmark: '4.0+',
      },
    ]

    // ── 6. GBP Checks ─────────────────────────────────────────────────────
    const gbpChecks: CheckItem[] = [
      check(
        'gbp-photos',
        'Photos present and recent (min 10)',
        'pending',
        'Check GBP photo count manually — no photo count in D1 yet.',
      ),
      check(
        'gbp-posts',
        'GBP posts published within last 30 days',
        'pending',
        'Check GBP posts table when available.',
      ),
      check('gbp-qa', 'Q&A seeded with 5–10 entries', 'pending', 'Requires manual GBP review.'),
      check(
        'gbp-menu',
        'Menu / ordering links live',
        homePage.ok ? 'pass' : 'fail',
        homePage.ok
          ? 'Website is live and accessible.'
          : `Website returned status ${homePage.status}.`,
      ),
      check(
        'gbp-description',
        'Business description keyword-rich (≤750 chars)',
        'pending',
        'Pull from GBP API or Yext sync.',
      ),
      check(
        'gbp-review-response',
        '100% review response rate (90d)',
        responseRate === 100 ? 'pass' : responseRate >= 80 ? 'warning' : 'fail',
        `Current response rate: ${responseRate}% of reviews have an owner reply.`,
      ),
      check(
        'gbp-star-rating',
        'Star rating 4.0+',
        (location.avg_star_rating ?? 0) >= 4.0
          ? 'pass'
          : (location.avg_star_rating ?? 0) >= 3.5
            ? 'warning'
            : 'fail',
        `Current rating: ${location.avg_star_rating ?? 'unknown'} ★`,
      ),
      check(
        'gbp-recent-reviews',
        'Reviews received in last 30 days',
        (reviewStats?.last_30d ?? 0) > 0 ? 'pass' : 'fail',
        `${reviewStats?.last_30d ?? 0} reviews in the last 30 days.`,
      ),
    ]

    // ── 7. On-Page & Schema Checks ────────────────────────────────────────
    const hasTitle = /<title[^>]*>[^<]{10,60}<\/title>/i.test(html)
    const hasH1 = /<h1[^>]*>[^<]+<\/h1>/i.test(html)
    const hasMeta = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{100,160}["']/i.test(
      html,
    )
    const hasTelLink = /href=["']tel:/i.test(html)
    const hasLocalBusiness =
      hasSchema('LocalBusiness') || hasSchema('Restaurant') || hasSchema('FoodEstablishment')
    const lbSchema =
      getSchema('LocalBusiness') ?? getSchema('Restaurant') ?? getSchema('FoodEstablishment')
    const hasSameAs =
      Array.isArray((lbSchema as Record<string, unknown> | undefined)?.sameAs) &&
      ((lbSchema as Record<string, unknown>).sameAs as unknown[]).length > 0
    const hasAggRating =
      hasSchema('AggregateRating') ||
      !!(lbSchema as Record<string, unknown> | undefined)?.aggregateRating
    const hasFaq = hasSchema('FAQPage')
    const hasSpeakable = !!(lbSchema as Record<string, unknown> | undefined)?.speakable
    const hasBreadcrumb = hasSchema('BreadcrumbList')
    const hasMenuSchema = !!(lbSchema as Record<string, unknown> | undefined)?.hasMenu

    const imgAltMissing = (html.match(/<img[^>]+>/gi) ?? []).filter(
      (img) => !/alt=["'][^"']+["']/i.test(img),
    ).length
    const imgBadNames = (html.match(/src=["'][^"']+["']/gi) ?? []).filter((src) =>
      /IMG_\d+|DSC\d+|image\d+/i.test(src),
    ).length

    const onPageChecks: CheckItem[] = [
      check(
        'op-title',
        'Title tag unique & 10–60 chars',
        hasTitle ? 'pass' : 'fail',
        hasTitle
          ? 'Title tag found within length range.'
          : 'Title tag missing or outside 10–60 char range.',
      ),
      check(
        'op-h1',
        'H1 present on page',
        hasH1 ? 'pass' : 'fail',
        hasH1 ? 'H1 tag found.' : 'No H1 tag detected on homepage.',
      ),
      check(
        'op-meta',
        'Meta description 100–160 chars',
        hasMeta ? 'pass' : 'warning',
        hasMeta
          ? 'Meta description found within range.'
          : 'Meta description missing or outside range.',
      ),
      check(
        'op-tel',
        'Click-to-call tel: href present',
        hasTelLink ? 'pass' : 'fail',
        hasTelLink ? 'tel: link found.' : 'No tel: href found — mobile callers cannot tap to call.',
      ),
      check(
        'op-schema-lb',
        'LocalBusiness / Restaurant schema valid',
        hasLocalBusiness ? 'pass' : 'fail',
        hasLocalBusiness
          ? 'LocalBusiness-type schema found in JSON-LD.'
          : 'No LocalBusiness, Restaurant, or FoodEstablishment schema found.',
      ),
      check(
        'op-sameas',
        'sameAs array present in schema',
        hasSameAs ? 'pass' : 'warning',
        hasSameAs
          ? 'sameAs links found in schema.'
          : 'No sameAs array in schema — limits LLM entity grounding.',
      ),
      check(
        'op-aggrating',
        'AggregateRating schema present',
        hasAggRating ? 'pass' : 'warning',
        hasAggRating
          ? 'AggregateRating found.'
          : 'No AggregateRating schema — missing star snippet in SERPs.',
      ),
      check(
        'op-faq',
        'FAQ schema present',
        hasFaq ? 'pass' : 'warning',
        hasFaq ? 'FAQPage schema found.' : 'No FAQ schema detected.',
      ),
      check(
        'op-speakable',
        'speakable schema present',
        hasSpeakable ? 'pass' : 'warning',
        hasSpeakable
          ? 'speakable property found.'
          : 'No speakable schema — reduces voice search and AI Overview eligibility.',
      ),
      check(
        'op-breadcrumb',
        'BreadcrumbList schema present',
        hasBreadcrumb ? 'pass' : 'na',
        hasBreadcrumb
          ? 'BreadcrumbList schema found.'
          : 'No breadcrumb schema (may be N/A for single-page sites).',
      ),
      check(
        'op-menu-schema',
        'Menu schema (hasMenu) present',
        hasMenuSchema ? 'pass' : 'warning',
        hasMenuSchema
          ? 'hasMenu property found in schema.'
          : 'No hasMenu property — menu not linked to structured data.',
      ),
      check(
        'op-alt-text',
        'All images have alt text',
        imgAltMissing === 0 ? 'pass' : 'fail',
        imgAltMissing === 0
          ? 'All detected images have alt text.'
          : `${imgAltMissing} image(s) missing alt text.`,
      ),
      check(
        'op-img-names',
        'Image file names descriptive',
        imgBadNames === 0 ? 'pass' : 'warning',
        imgBadNames === 0
          ? 'No generic image filenames detected.'
          : `${imgBadNames} image(s) with generic names (IMG_####, DSC####).`,
      ),
    ]

    // ── 8. Technical Checks ───────────────────────────────────────────────
    const isHttps = website.startsWith('https://')
    const hasNoindex =
      /content=["'][^"']*noindex[^"']*["']/i.test(html) || /X-Robots-Tag.*noindex/i.test(html)
    const hasCanonical = /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html)
    const hasSitemap = sitemapXml.ok
    const hasLlmsTxt = llmsTxt.ok
    const gptBotBlocked = botBlocked('GPTBot')
    const claudeBotBlocked = botBlocked('ClaudeBot')
    const perplexityBotBlocked = botBlocked('PerplexityBot')
    const anyLlmBlocked = gptBotBlocked || claudeBotBlocked || perplexityBotBlocked
    const blockedBots = [
      gptBotBlocked ? 'GPTBot' : null,
      claudeBotBlocked ? 'ClaudeBot' : null,
      perplexityBotBlocked ? 'PerplexityBot' : null,
    ]
      .filter(Boolean)
      .join(', ')

    const hasAddressInHtml =
      /\d{1,5}\s+\w+\s+(st|ave|blvd|rd|dr|ln|way|court|ct)\b/i.test(html) ||
      html.includes('address') ||
      html.includes('phone')

    const technicalChecks: CheckItem[] = [
      check(
        'tech-https',
        'HTTPS enforced',
        isHttps ? 'pass' : 'fail',
        isHttps
          ? 'Site uses HTTPS.'
          : 'Site is not on HTTPS — critical security and ranking issue.',
      ),
      check(
        'tech-noindex',
        'No noindex on key pages',
        hasNoindex ? 'fail' : 'pass',
        hasNoindex
          ? 'noindex directive detected on this page — it may be excluded from Google.'
          : 'No noindex detected on homepage.',
      ),
      check(
        'tech-canonical',
        'Canonical tag present',
        hasCanonical ? 'pass' : 'warning',
        hasCanonical ? 'Canonical tag found.' : 'No canonical tag found.',
      ),
      check(
        'tech-sitemap',
        'XML sitemap accessible',
        hasSitemap ? 'pass' : 'fail',
        hasSitemap ? 'sitemap.xml returns 200.' : 'sitemap.xml not found or not accessible.',
      ),
      check(
        'tech-llms-txt',
        'llms.txt present at site root',
        hasLlmsTxt ? 'pass' : 'warning',
        hasLlmsTxt
          ? 'llms.txt found.'
          : 'No llms.txt — AI crawlers have no structured guide to this site.',
      ),
      check(
        'tech-llm-bots',
        'LLM bots not blocked in robots.txt',
        anyLlmBlocked ? 'fail' : 'pass',
        anyLlmBlocked
          ? `These bots are blocked in robots.txt: ${blockedBots}`
          : 'GPTBot, ClaudeBot, and PerplexityBot are not blocked.',
      ),
      check(
        'tech-content-html',
        'Key content in rendered HTML',
        hasAddressInHtml ? 'pass' : 'warning',
        hasAddressInHtml
          ? 'Address/contact info detected in raw HTML.'
          : 'No address-like content found in raw HTML — may be JavaScript-rendered only.',
      ),
      check(
        'tech-site-live',
        'Site is live and loading',
        homePage.ok ? 'pass' : 'fail',
        homePage.ok
          ? `Site returned HTTP ${homePage.status}.`
          : `Site returned HTTP ${homePage.status} — may be down or blocked.`,
      ),
    ]

    // ── 9. Rankings / Content Checks ──────────────────────────────────────
    const rankingsChecks: CheckItem[] = [
      check(
        'rank-indexed',
        'Priority pages indexed',
        location.indexed_pages > 0 ? 'pass' : 'fail',
        `${location.indexed_pages ?? 0} indexed pages detected from Snowflake sync.`,
      ),
      check(
        'rank-local-rank',
        'Avg local rank tracked',
        location.avg_local_rank ? 'pass' : 'pending',
        location.avg_local_rank
          ? `Current avg rank: #${location.avg_local_rank}`
          : 'No rank data in D1 yet — connect SEMrush Position Tracking.',
      ),
      check(
        'rank-dup-content',
        'No duplicate/thin content',
        'pending',
        'Run SEMrush Site Audit duplicate content report.',
      ),
      check(
        'rank-internal-links',
        'Internal linking: location → menu → catering',
        'pending',
        'Run Ahrefs internal links report for this domain.',
      ),
      check(
        'rank-review-velocity',
        'Review velocity — no stagnation',
        (reviewStats?.last_30d ?? 0) > 0 ? 'pass' : 'warning',
        `${reviewStats?.last_30d ?? 0} new reviews in last 30 days.`,
      ),
    ]

    // ── 10. Citations Checks ──────────────────────────────────────────────
    const citationsChecks: CheckItem[] = [
      check(
        'cit-yext-health',
        'Yext sync health — all listings green',
        allYextGreen ? 'pass' : 'fail',
        allYextGreen
          ? 'All Yext-managed listings are synced.'
          : 'Some Yext listings have sync errors or are not synced.',
      ),
      check(
        'cit-nap',
        'NAP consistent across directories',
        napConsistent ? 'pass' : 'fail',
        napConsistent
          ? 'NAP is consistent across all tracked listings.'
          : 'NAP inconsistency detected in one or more listings.',
      ),
      check(
        'cit-apple-maps',
        'Apple Business Connect claimed & verified',
        'pending',
        'Check Apple Business Connect dashboard manually.',
      ),
      check(
        'cit-bing',
        'Bing Places listing claimed',
        'pending',
        'Check Bing Places for Business manually.',
      ),
      check(
        'cit-waze',
        'Waze / HERE Maps listing correct',
        'pending',
        'Verify in Waze for Cities or HERE Map Creator.',
      ),
      check(
        'cit-local-links',
        'Local backlinks (chamber, press, sponsors)',
        'pending',
        'Run Ahrefs referring domains report filtered by local sources.',
      ),
      check(
        'cit-about-page',
        'About page with team/story present',
        /href=["'][^"']*about["']/i.test(html) ? 'pass' : 'warning',
        /href=["'][^"']*about["']/i.test(html)
          ? 'About page link found on homepage.'
          : 'No link to About page detected on homepage.',
      ),
      check(
        'cit-contact-page',
        'Contact page with full NAP present',
        /href=["'][^"']*contact["']/i.test(html) ? 'pass' : 'warning',
        /href=["'][^"']*contact["']/i.test(html)
          ? 'Contact page link found.'
          : 'No link to Contact page detected on homepage.',
      ),
    ]

    // ── 11. LLM / AEO Checks ─────────────────────────────────────────────
    const llmChecks: CheckItem[] = [
      check(
        'llm-queried',
        'Brand queried in ChatGPT, Perplexity, Gemini',
        'pending',
        'Manual audit required — document results in findings field.',
      ),
      check(
        'llm-knowledge-panel',
        'Google Knowledge Panel exists',
        'pending',
        'Check Google search for brand name Knowledge Panel.',
      ),
      check(
        'llm-wikidata',
        'Wikidata entity exists',
        'pending',
        'Query Wikidata SPARQL endpoint for brand name.',
      ),
      check(
        'llm-reddit',
        'Reddit / Quora sentiment checked',
        'pending',
        'Manual review required — search brand on Reddit.',
      ),
      check(
        'llm-ga4-channel',
        'GA4 AI referral channel group configured',
        'pending',
        'Check GA4 Admin > Channel Groups for AI referral definition.',
      ),
      check(
        'llm-branded-gsc',
        'Branded organic impressions baselined in GSC',
        'pending',
        'Pull GSC Search Analytics filtered by brand name queries.',
      ),
      check(
        'llm-speakable',
        'speakable schema on key pages',
        hasSpeakable ? 'pass' : 'warning',
        hasSpeakable
          ? 'speakable property detected.'
          : 'No speakable schema — voice search and AI Overview eligibility reduced.',
      ),
      check(
        'llm-llms-txt',
        'llms.txt file at site root',
        hasLlmsTxt ? 'pass' : 'warning',
        hasLlmsTxt ? 'llms.txt found.' : 'No llms.txt file — LLM crawlers have no site guide.',
      ),
      check(
        'llm-apple-siri',
        'Apple Business Connect + Siri checked',
        'pending',
        'Test key queries on Siri and document results.',
      ),
    ]

    // ── 12. Health summary (auto-scored) ──────────────────────────────────
    const score = (checks: CheckItem[]): 'healthy' | 'needs-work' | 'critical' | 'unknown' => {
      const fails = checks.filter((c) => c.status === 'fail').length
      const warnings = checks.filter((c) => c.status === 'warning').length
      if (fails >= 3 || (fails >= 1 && warnings >= 2)) return 'critical'
      if (fails >= 1 || warnings >= 3) return 'needs-work'
      if (checks.every((c) => c.status === 'pending')) return 'unknown'
      return 'healthy'
    }

    const topIssue = (checks: CheckItem[]) =>
      checks.find((c) => c.status === 'fail')?.label ??
      checks.find((c) => c.status === 'warning')?.label ??
      '—'

    const healthSummary: AuditReport['healthSummary'] = [
      {
        area: 'Google Business Profile & listings',
        rating: score(gbpChecks),
        topIssue: topIssue(gbpChecks),
        priority:
          score(gbpChecks) === 'critical' ? 'P0' : score(gbpChecks) === 'needs-work' ? 'P1' : 'P2',
      },
      {
        area: 'On-page & schema',
        rating: score(onPageChecks),
        topIssue: topIssue(onPageChecks),
        priority:
          score(onPageChecks) === 'critical'
            ? 'P0'
            : score(onPageChecks) === 'needs-work'
              ? 'P1'
              : 'P2',
      },
      {
        area: 'Technical & indexing',
        rating: score(technicalChecks),
        topIssue: topIssue(technicalChecks),
        priority:
          score(technicalChecks) === 'critical'
            ? 'P0'
            : score(technicalChecks) === 'needs-work'
              ? 'P1'
              : 'P2',
      },
      {
        area: 'Rankings, content & reviews',
        rating: score(rankingsChecks),
        topIssue: topIssue(rankingsChecks),
        priority:
          score(rankingsChecks) === 'critical'
            ? 'P0'
            : score(rankingsChecks) === 'needs-work'
              ? 'P1'
              : 'P2',
      },
      {
        area: 'Citations & local authority',
        rating: score(citationsChecks),
        topIssue: topIssue(citationsChecks),
        priority:
          score(citationsChecks) === 'critical'
            ? 'P0'
            : score(citationsChecks) === 'needs-work'
              ? 'P1'
              : 'P2',
      },
      {
        area: 'LLM / AEO Visibility',
        rating: score(llmChecks),
        topIssue: topIssue(llmChecks),
        priority:
          score(llmChecks) === 'critical' ? 'P0' : score(llmChecks) === 'needs-work' ? 'P1' : 'P2',
      },
    ]

    // ── 13. Auto-generate diagnosis ───────────────────────────────────────
    const criticalAreas = healthSummary.filter((h) => h.rating === 'critical').map((h) => h.area)

    const diagnosis =
      criticalAreas.length > 0
        ? `Critical issues detected in: ${criticalAreas.join(', ')}. Immediate action required.`
        : 'No critical issues auto-detected. Review pending items manually.'

    const top3Actions = [
      ...gbpChecks.filter((c) => c.status === 'fail').map((c) => c.label),
      ...technicalChecks.filter((c) => c.status === 'fail').map((c) => c.label),
      ...onPageChecks.filter((c) => c.status === 'fail').map((c) => c.label),
    ]
      .slice(0, 3)
      .concat(['—', '—', '—'])
      .slice(0, 3)

    return {
      locationId,
      brand: location.brand_name ?? locationId,
      website: location.website_url ?? '—',
      primaryMarket: location.primary_market ?? '—',
      csm: location.csm_name ?? '—',
      seoOwner: location.seo_owner ?? '—',
      dateOpened: location.date_opened ?? '—',
      yextManaged: !!location.yext_managed,
      launchDate: location.launch_date ?? '—',
      metrics,
      healthSummary,
      gbpChecks,
      onPageChecks,
      technicalChecks,
      rankingsChecks,
      citationsChecks,
      llmChecks,
      findings: {},
      rootCauses: {},
      diagnosis,
      top3Actions,
      timeline: 'TBD after manual review',
      status: 'Diagnosing',
    }
  })
