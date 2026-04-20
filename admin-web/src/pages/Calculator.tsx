import { useEffect, useMemo, useState } from 'react'
import { apiJson } from '../utils/api'

// ── Types ────────────────────────────────────────────────────────────────

interface KbField {
  name: string
  type: string
  value: any
}
interface KbPage {
  slug: string
  fields: KbField[]
}

interface ModelCosts {
  primary_name: string
  primary_input_per_m: number
  primary_output_per_m: number
  heavy_name: string
  heavy_input_per_m: number
  heavy_output_per_m: number
  whisper_per_minute: number
  tool_per_1000: number
  usd_to_eur: number
}

interface UserAllowance {
  steve_uses_per_month: number
  whisper_minutes_per_month: number
  monthly_spend_ceiling_eur: number
  internal_weights: Record<string, number>
  early_price: number
  standard_price: number
}

const DEFAULT_MODEL_COSTS: ModelCosts = {
  primary_name: 'grok-4-1-fast-reasoning',
  primary_input_per_m: 0.20,
  primary_output_per_m: 0.50,
  heavy_name: 'grok-4-20-reasoning',
  heavy_input_per_m: 2.0,
  heavy_output_per_m: 6.0,
  whisper_per_minute: 0.006,
  tool_per_1000: 5.0,
  usd_to_eur: 0.92,
}

// ── Helpers ──────────────────────────────────────────────────────────────

const fieldValue = (page: KbPage | null, name: string, fallback: any): any => {
  if (!page) return fallback
  const f = page.fields.find((x) => x.name === name)
  if (!f || f.value === undefined || f.value === null) return fallback
  return f.value
}

const num = (v: any, fallback = 0): number => {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return isFinite(n) ? n : fallback
}

const fmtUsd = (v: number) => `$${v.toFixed(4)}`
const fmtEur = (v: number) => `€${v.toFixed(4)}`
const fmtEur2 = (v: number) => `€${v.toFixed(2)}`
const fmtPct = (v: number) => `${v.toFixed(1)}%`

// ── Single call cost estimator ───────────────────────────────────────────

function SingleCallTab({ costs }: { costs: ModelCosts }) {
  const [model, setModel] = useState<'primary' | 'heavy'>('primary')
  const [inputTokens, setInputTokens] = useState(4000)
  const [outputTokens, setOutputTokens] = useState(400)
  const [toolCalls, setToolCalls] = useState(0)
  const [whisperMin, setWhisperMin] = useState(0)

  const inputPerM = model === 'primary' ? costs.primary_input_per_m : costs.heavy_input_per_m
  const outputPerM = model === 'primary' ? costs.primary_output_per_m : costs.heavy_output_per_m
  const modelName = model === 'primary' ? costs.primary_name : costs.heavy_name

  const inputCost = (inputTokens / 1_000_000) * inputPerM
  const outputCost = (outputTokens / 1_000_000) * outputPerM
  const toolCost = (toolCalls / 1000) * costs.tool_per_1000
  const whisperCost = whisperMin * costs.whisper_per_minute
  const totalUsd = inputCost + outputCost + toolCost + whisperCost
  const totalEur = totalUsd * costs.usd_to_eur

  const presets = [
    { name: 'Typical DM reply', input: 2_000, output: 300, tool: 0, whisper: 0 },
    { name: 'Typical group reply', input: 8_000, output: 600, tool: 1, whisper: 0 },
    { name: 'Typical feed reply', input: 6_000, output: 500, tool: 1, whisper: 0 },
    { name: 'Worst-case group turn', input: 30_000, output: 1500, tool: 3, whisper: 0 },
    { name: '30s voice memo summary', input: 1_500, output: 200, tool: 0, whisper: 0.5 },
  ]

  const applyPreset = (p: typeof presets[number]) => {
    setInputTokens(p.input)
    setOutputTokens(p.output)
    setToolCalls(p.tool)
    setWhisperMin(p.whisper)
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card title="Inputs" icon="fa-sliders">
          <label className="block text-xs text-muted mb-1">Model</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as 'primary' | 'heavy')}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm mb-3"
          >
            <option value="primary">{costs.primary_name} (primary)</option>
            <option value="heavy">{costs.heavy_name} (heavy)</option>
          </select>

          <NumberInput label="Input tokens" value={inputTokens} onChange={setInputTokens} />
          <NumberInput label="Output tokens" value={outputTokens} onChange={setOutputTokens} />
          <NumberInput label="Tool calls (web / X / code-exec)" value={toolCalls} onChange={setToolCalls} />
          <NumberInput label="Whisper minutes (voice)" value={whisperMin} onChange={setWhisperMin} step={0.1} />
        </Card>

        <Card title="Presets" icon="fa-wand-magic-sparkles">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.name}
                onClick={() => applyPreset(p)}
                className="text-xs bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg px-3 py-1.5 transition"
              >
                {p.name}
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Result" icon="fa-calculator">
          <CostRow label={`Input (${inputTokens.toLocaleString()} tok @ $${inputPerM}/1M)`} usd={inputCost} eur={inputCost * costs.usd_to_eur} />
          <CostRow label={`Output (${outputTokens.toLocaleString()} tok @ $${outputPerM}/1M)`} usd={outputCost} eur={outputCost * costs.usd_to_eur} />
          <CostRow label={`Tools (${toolCalls} @ $${costs.tool_per_1000}/1000)`} usd={toolCost} eur={toolCost * costs.usd_to_eur} />
          <CostRow label={`Whisper (${whisperMin} min @ $${costs.whisper_per_minute}/min)`} usd={whisperCost} eur={whisperCost * costs.usd_to_eur} />
          <div className="border-t border-white/10 mt-3 pt-3 flex justify-between items-center">
            <span className="font-semibold">Total per call</span>
            <div className="text-right">
              <div className="text-lg font-bold text-accent">{fmtEur(totalEur)}</div>
              <div className="text-xs text-muted">{fmtUsd(totalUsd)} · {modelName}</div>
            </div>
          </div>
        </Card>

        <Card title="Sensitivity" icon="fa-arrows-turn-to-dots">
          <p className="text-xs text-muted mb-2">If every call looked like this, the monthly budget would cover:</p>
          <ul className="text-sm space-y-1">
            <li><span className="text-muted">€1 ceiling →</span> {totalEur > 0 ? Math.floor(1 / totalEur) : '∞'} calls</li>
            <li><span className="text-muted">€3.99 ceiling →</span> {totalEur > 0 ? Math.floor(3.99 / totalEur) : '∞'} calls</li>
            <li><span className="text-muted">€50 ceiling →</span> {totalEur > 0 ? Math.floor(50 / totalEur) : '∞'} calls</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}

// ── Month simulator ──────────────────────────────────────────────────────

function MonthTab({ costs, allowance }: { costs: ModelCosts; allowance: UserAllowance }) {
  const [dmCount, setDmCount] = useState(20)
  const [groupCount, setGroupCount] = useState(40)
  const [feedCount, setFeedCount] = useState(20)
  const [postSummaryCount, setPostSummaryCount] = useState(10)
  const [whisperMin, setWhisperMin] = useState(30)

  const callTypes = [
    { name: 'DM', count: dmCount, setter: setDmCount, input: 2000, output: 300, tool: 0 },
    { name: 'Group chat', count: groupCount, setter: setGroupCount, input: 8000, output: 600, tool: 1 },
    { name: 'Community feed', count: feedCount, setter: setFeedCount, input: 6000, output: 500, tool: 1 },
    { name: 'Post summary', count: postSummaryCount, setter: setPostSummaryCount, input: 3000, output: 400, tool: 0 },
  ]

  const costs_by_type = callTypes.map((t) => {
    const tokenCost =
      (t.input / 1_000_000) * costs.primary_input_per_m +
      (t.output / 1_000_000) * costs.primary_output_per_m
    const toolCost = (t.tool / 1000) * costs.tool_per_1000
    const per = tokenCost + toolCost
    return {
      name: t.name,
      count: t.count,
      per_usd: per,
      total_usd: per * t.count,
    }
  })
  const whisperTotalUsd = whisperMin * costs.whisper_per_minute
  const totalUsd = costs_by_type.reduce((s, x) => s + x.total_usd, 0) + whisperTotalUsd
  const totalEur = totalUsd * costs.usd_to_eur
  const ceiling = allowance.monthly_spend_ceiling_eur
  const pctOfCeiling = ceiling > 0 ? (totalEur / ceiling) * 100 : 0

  const totalCalls = dmCount + groupCount + feedCount + postSummaryCount
  const userFacingUses = totalCalls
  const allowanceLimit = allowance.steve_uses_per_month
  const allowancePct = allowanceLimit > 0 ? (userFacingUses / allowanceLimit) * 100 : 0

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card title="Monthly usage profile" icon="fa-calendar">
          {callTypes.map((t) => (
            <NumberInput
              key={t.name}
              label={`${t.name} (~${t.input.toLocaleString()} in / ${t.output} out${t.tool ? ` + ${t.tool} tool call` : ''})`}
              value={t.count}
              onChange={t.setter}
            />
          ))}
          <NumberInput label="Whisper minutes" value={whisperMin} onChange={setWhisperMin} step={1} />
        </Card>

        <Card title="Quick profiles" icon="fa-user-group">
          <div className="flex flex-wrap gap-2">
            <PresetButton label="Light (p25)" onClick={() => { setDmCount(10); setGroupCount(10); setFeedCount(5); setPostSummaryCount(3); setWhisperMin(5) }} />
            <PresetButton label="Median (p50)" onClick={() => { setDmCount(20); setGroupCount(40); setFeedCount(20); setPostSummaryCount(10); setWhisperMin(30) }} />
            <PresetButton label="Heavy (p90)" onClick={() => { setDmCount(50); setGroupCount(100); setFeedCount(60); setPostSummaryCount(30); setWhisperMin(80) }} />
            <PresetButton label="Ceiling (164 uses)" onClick={() => { setDmCount(40); setGroupCount(60); setFeedCount(40); setPostSummaryCount(24); setWhisperMin(100) }} />
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Monthly cost" icon="fa-calculator">
          {costs_by_type.map((c) => (
            <CostRow
              key={c.name}
              label={`${c.name}: ${c.count} × ${fmtEur(c.per_usd * costs.usd_to_eur)}`}
              usd={c.total_usd}
              eur={c.total_usd * costs.usd_to_eur}
            />
          ))}
          <CostRow label={`Whisper: ${whisperMin} min`} usd={whisperTotalUsd} eur={whisperTotalUsd * costs.usd_to_eur} />
          <div className="border-t border-white/10 mt-3 pt-3 flex justify-between items-center">
            <span className="font-semibold">Total / user / month</span>
            <div className="text-right">
              <div className="text-lg font-bold text-accent">{fmtEur2(totalEur)}</div>
              <div className="text-xs text-muted">{fmtUsd(totalUsd)}</div>
            </div>
          </div>
        </Card>

        <Card title="Against user-facing allowance" icon="fa-user-check">
          <MeterBar
            label={`Steve uses: ${userFacingUses} / ${allowanceLimit}`}
            pct={allowancePct}
            dangerPct={100}
          />
          <MeterBar
            label={`Against €${ceiling.toFixed(2)} spend ceiling: ${fmtEur2(totalEur)} / ${fmtEur2(ceiling)}`}
            pct={pctOfCeiling}
            dangerPct={100}
          />
          {pctOfCeiling > 100 && (
            <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
              This profile would exceed the circuit breaker. User would be frozen for the rest of the month.
            </div>
          )}
          {allowancePct > 100 && pctOfCeiling <= 100 && (
            <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-300 text-xs">
              User would hit the public allowance cap before burning the budget — good (this is the design).
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ── Pricing what-if ──────────────────────────────────────────────────────

function PricingTab({ costs, allowance }: { costs: ModelCosts; allowance: UserAllowance }) {
  const [price, setPrice] = useState(allowance.standard_price)
  const [channel, setChannel] = useState<'web' | 'iap_y1' | 'iap_y2'>('iap_y2')
  const [aiSpendEur, setAiSpendEur] = useState(allowance.monthly_spend_ceiling_eur)
  const [vatPct, setVatPct] = useState(23)
  const [corpTaxPct, setCorpTaxPct] = useState(12.5)

  // Channel fees
  const storeFeePct = channel === 'web' ? 0 : channel === 'iap_y1' ? 30 : 15
  const stripeFeePct = channel === 'web' ? 1.5 : 0
  const stripeFeeFixed = channel === 'web' ? 0.25 : 0

  const gross = price
  const storeFee = gross * (storeFeePct / 100)
  const stripeVariable = gross * (stripeFeePct / 100)
  const stripeFixed = stripeFeeFixed
  const afterFees = gross - storeFee - stripeVariable - stripeFixed

  // VAT is charged to the consumer; for most store channels it's collected and remitted separately.
  // Simplification: we treat the published price as including VAT and back it out of the net.
  const vatAbsorbed = afterFees * (vatPct / (100 + vatPct))
  const netRevenue = afterFees - vatAbsorbed

  const preTaxMargin = netRevenue - aiSpendEur
  const corpTax = preTaxMargin > 0 ? preTaxMargin * (corpTaxPct / 100) : 0
  const netProfit = preTaxMargin - corpTax

  const rows = [
    { label: 'Gross price', value: gross, sign: '+' as const },
    { label: `Store fee (${storeFeePct}%)`, value: storeFee, sign: '-' as const },
    stripeFeePct > 0
      ? { label: `Stripe fee (${stripeFeePct}% + €${stripeFeeFixed})`, value: stripeVariable + stripeFixed, sign: '-' as const }
      : null,
    { label: `VAT (${vatPct}% absorbed)`, value: vatAbsorbed, sign: '-' as const },
    { label: '= Net revenue', value: netRevenue, sign: '=' as const },
    { label: 'AI cost (xAI + Whisper)', value: aiSpendEur, sign: '-' as const },
    { label: '= Pre-tax margin', value: preTaxMargin, sign: '=' as const },
    { label: `Corporation tax (${corpTaxPct}%)`, value: corpTax, sign: '-' as const },
  ].filter(Boolean) as { label: string; value: number; sign: '+' | '-' | '=' }[]

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <Card title="Inputs" icon="fa-sliders">
          <NumberInput label="Subscription price (€ / month)" value={price} onChange={setPrice} step={0.01} />
          <label className="block text-xs text-muted mt-3 mb-1">Sales channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as any)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
          >
            <option value="web">Web (Stripe) — no store fee</option>
            <option value="iap_y1">iOS / Android IAP — year 1 (30%)</option>
            <option value="iap_y2">iOS / Android IAP — year 2+ (15%)</option>
          </select>
          <NumberInput label="Monthly AI spend per user (€)" value={aiSpendEur} onChange={setAiSpendEur} step={0.01} />
          <NumberInput label="VAT %" value={vatPct} onChange={setVatPct} step={0.1} />
          <NumberInput label="Corporation tax %" value={corpTaxPct} onChange={setCorpTaxPct} step={0.1} />
        </Card>

        <Card title="Quick scenarios" icon="fa-wand-magic-sparkles">
          <div className="flex flex-wrap gap-2">
            <PresetButton label="€4.99 early · web · p50 AI" onClick={() => { setPrice(4.99); setChannel('web'); setAiSpendEur(1.99) }} />
            <PresetButton label="€4.99 early · iOS y2 · p50 AI" onClick={() => { setPrice(4.99); setChannel('iap_y2'); setAiSpendEur(1.99) }} />
            <PresetButton label="€7.99 · web · ceiling AI" onClick={() => { setPrice(7.99); setChannel('web'); setAiSpendEur(3.99) }} />
            <PresetButton label="€7.99 · iOS y2 · ceiling AI" onClick={() => { setPrice(7.99); setChannel('iap_y2'); setAiSpendEur(3.99) }} />
            <PresetButton label="€7.99 · iOS y1 · ceiling AI" onClick={() => { setPrice(7.99); setChannel('iap_y1'); setAiSpendEur(3.99) }} />
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="Margin breakdown" icon="fa-calculator">
          <div className="space-y-1.5 text-sm">
            {rows.map((r, i) => (
              <div key={i} className="flex justify-between">
                <span className={r.sign === '=' ? 'font-semibold' : 'text-white/80'}>{r.label}</span>
                <span className={`font-mono ${r.sign === '=' ? 'font-semibold' : ''} ${r.sign === '-' ? 'text-red-300' : ''}`}>
                  {r.sign === '-' ? '−' : ''}{fmtEur2(Math.abs(r.value))}
                </span>
              </div>
            ))}
            <div className="border-t border-white/10 mt-3 pt-3 flex justify-between items-center">
              <span className="font-semibold">= Net profit / user / month</span>
              <span className={`text-lg font-bold ${netProfit > 1.5 ? 'text-green-400' : netProfit > 0 ? 'text-yellow-300' : 'text-red-400'}`}>
                {fmtEur2(netProfit)}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Vs target" icon="fa-bullseye">
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted">Target min net profit</span>
              <span>€1.50</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Actual</span>
              <span className={netProfit >= 1.5 ? 'text-green-400' : 'text-red-400'}>
                {fmtEur2(netProfit)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Headroom</span>
              <span className={netProfit - 1.5 >= 0 ? 'text-green-400' : 'text-red-400'}>
                {fmtEur2(netProfit - 1.5)}
              </span>
            </div>
            <div className="flex justify-between pt-2 border-t border-white/10 mt-2">
              <span className="text-muted">Margin %</span>
              <span>{fmtPct((netProfit / Math.max(gross, 0.01)) * 100)}</span>
            </div>
          </div>
          {netProfit < 1.5 && netProfit > 0 && (
            <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-300 text-xs">
              Below target. Drop AI ceiling or raise price.
            </div>
          )}
          {netProfit <= 0 && (
            <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
              Negative margin — you're losing money on every user here.
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ── Shared components ────────────────────────────────────────────────────

function Card({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-2 border border-white/10 rounded-xl p-5">
      <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
        <i className={`fa-solid ${icon} text-accent`} />
        {title}
      </h3>
      {children}
    </div>
  )
}

function NumberInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="mb-2">
      <label className="block text-xs text-muted mb-1">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
      />
    </div>
  )
}

function CostRow({ label, usd, eur }: { label: string; usd: number; eur: number }) {
  return (
    <div className="flex justify-between text-sm mb-1.5">
      <span className="text-white/80 truncate pr-3">{label}</span>
      <span className="text-right">
        <span className="font-mono text-white">{fmtEur(eur)}</span>
        <span className="text-[11px] text-muted ml-2">{fmtUsd(usd)}</span>
      </span>
    </div>
  )
}

function PresetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs bg-white/5 border border-white/10 hover:bg-white/10 rounded-lg px-3 py-1.5 transition"
    >
      {label}
    </button>
  )
}

function MeterBar({ label, pct, dangerPct }: { label: string; pct: number; dangerPct: number }) {
  const pctClamped = Math.max(0, Math.min(pct, 200))
  const color = pct >= dangerPct ? 'bg-red-500' : pct >= dangerPct * 0.8 ? 'bg-yellow-500' : 'bg-accent'
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-white/80">{label}</span>
        <span className={pct >= dangerPct ? 'text-red-400' : 'text-muted'}>{fmtPct(pct)}</span>
      </div>
      <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(pctClamped, 100)}%` }} />
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function Calculator() {
  const [tab, setTab] = useState<'single' | 'month' | 'pricing'>('single')
  const [creditsPage, setCreditsPage] = useState<KbPage | null>(null)
  const [userTiersPage, setUserTiersPage] = useState<KbPage | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      apiJson<{ page?: KbPage }>('/api/admin/kb/pages/credits-entitlements').then((d) => d.page || null).catch(() => null),
      apiJson<{ page?: KbPage }>('/api/admin/kb/pages/user-tiers').then((d) => d.page || null).catch(() => null),
    ]).then(([credits, tiers]) => {
      setCreditsPage(credits)
      setUserTiersPage(tiers)
      setLoading(false)
    })
  }, [])

  const costs: ModelCosts = useMemo(() => ({
    primary_name: String(fieldValue(creditsPage, 'model_primary', DEFAULT_MODEL_COSTS.primary_name)),
    primary_input_per_m: num(fieldValue(creditsPage, 'model_primary_input_per_m_usd', DEFAULT_MODEL_COSTS.primary_input_per_m)),
    primary_output_per_m: num(fieldValue(creditsPage, 'model_primary_output_per_m_usd', DEFAULT_MODEL_COSTS.primary_output_per_m)),
    heavy_name: String(fieldValue(creditsPage, 'model_heavy', DEFAULT_MODEL_COSTS.heavy_name)),
    heavy_input_per_m: num(fieldValue(creditsPage, 'model_heavy_input_per_m_usd', DEFAULT_MODEL_COSTS.heavy_input_per_m)),
    heavy_output_per_m: num(fieldValue(creditsPage, 'model_heavy_output_per_m_usd', DEFAULT_MODEL_COSTS.heavy_output_per_m)),
    whisper_per_minute: num(fieldValue(creditsPage, 'whisper_per_minute_usd', DEFAULT_MODEL_COSTS.whisper_per_minute)),
    tool_per_1000: num(fieldValue(creditsPage, 'tool_call_per_1000_usd', DEFAULT_MODEL_COSTS.tool_per_1000)),
    usd_to_eur: num(fieldValue(creditsPage, 'usd_to_eur_rate', DEFAULT_MODEL_COSTS.usd_to_eur)),
  }), [creditsPage])

  const allowance: UserAllowance = useMemo(() => ({
    steve_uses_per_month: num(fieldValue(creditsPage, 'steve_uses_per_month_user_facing', 100)),
    whisper_minutes_per_month: num(fieldValue(creditsPage, 'whisper_minutes_per_month', 100)),
    monthly_spend_ceiling_eur: num(fieldValue(creditsPage, 'monthly_spend_ceiling_eur', 3.99)),
    internal_weights: (fieldValue(creditsPage, 'internal_weights', {}) as Record<string, number>) || {},
    early_price: num(fieldValue(userTiersPage, 'premium_price_early_eur', 4.99)),
    standard_price: num(fieldValue(userTiersPage, 'premium_price_standard_eur', 7.99)),
  }), [creditsPage, userTiersPage])

  if (loading) {
    return <div className="text-muted text-center py-20">Loading calculator…</div>
  }

  return (
    <div className="max-w-6xl space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-3">
            <i className="fa-solid fa-calculator text-accent" />
            Usage / Credit Calculator
          </h2>
          <p className="text-muted text-sm mt-1">
            Plug model costs and usage assumptions into the pricing math. Model costs are pulled
            live from{' '}
            <a href="/kb" className="text-accent hover:underline">Credits &amp; Entitlements</a>.
          </p>
        </div>
        <div className="text-[11px] text-muted bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
          <span className="text-white/90 font-mono">{costs.primary_name}</span> · input ${costs.primary_input_per_m}/1M · output ${costs.primary_output_per_m}/1M · USD→EUR {costs.usd_to_eur}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10">
        <TabButton active={tab === 'single'} onClick={() => setTab('single')}>
          <i className="fa-solid fa-message mr-2" />
          Single call
        </TabButton>
        <TabButton active={tab === 'month'} onClick={() => setTab('month')}>
          <i className="fa-solid fa-calendar mr-2" />
          Monthly simulator
        </TabButton>
        <TabButton active={tab === 'pricing'} onClick={() => setTab('pricing')}>
          <i className="fa-solid fa-euro-sign mr-2" />
          Pricing what-if
        </TabButton>
      </div>

      {tab === 'single' && <SingleCallTab costs={costs} />}
      {tab === 'month' && <MonthTab costs={costs} allowance={allowance} />}
      {tab === 'pricing' && <PricingTab costs={costs} allowance={allowance} />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
        active
          ? 'border-accent text-accent'
          : 'border-transparent text-muted hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}
