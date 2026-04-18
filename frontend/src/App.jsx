import { useState, useEffect, useRef, useCallback } from "react";

const API = "http://localhost:8000";

// ── Design tokens ──────────────────────────────────────────────
const RISK_COLOR = { High: "#ef4444", Medium: "#f59e0b", Low: "#22c55e" };
const RISK_BG    = { High: "#450a0a", Medium: "#451a03", Low: "#052e16" };

function fmt(n, type = "pct") {
  if (n == null) return "—";
  if (type === "pct")   return (n * 100).toFixed(1) + "%";
  if (type === "inr")   return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  if (type === "num")   return n.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return n;
}

// ── KPI Card ───────────────────────────────────────────────────
function KPICard({ label, value, avg, type }) {
  const val   = type === "pct" ? value * 100 : value;
  const avgV  = type === "pct" ? avg * 100   : avg;
  const diff  = avg != null ? val - avgV : null;
  const good  = label.includes("Acceptance") || label.includes("Conversion") || label.includes("Earnings");
  const color = diff == null ? "#94a3b8" : diff > 0 ? (good ? "#22c55e" : "#ef4444") : (good ? "#ef4444" : "#22c55e");

  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "18px 20px" }}>
      <div style={{ fontSize: 11, color: "#64748b", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#f1f5f9", fontFamily: "'DM Mono', monospace" }}>
        {type === "pct" ? fmt(value, "pct") : type === "inr" ? fmt(value, "inr") : fmt(value, "num")}
      </div>
      {diff != null && (
        <div style={{ fontSize: 12, color, marginTop: 6 }}>
          {diff > 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}{type === "pct" ? "pp" : ""} vs city avg
        </div>
      )}
    </div>
  );
}

// ── Gauge ──────────────────────────────────────────────────────
function Gauge({ value, label }) {
  const pct = Math.round(value * 100);
  const color = pct > 60 ? "#22c55e" : pct > 35 ? "#f59e0b" : "#ef4444";
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={130} height={130} viewBox="0 0 130 130">
        <circle cx={65} cy={65} r={54} fill="none" stroke="#1e293b" strokeWidth={10} />
        <circle cx={65} cy={65} r={54} fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.6s ease", transform: "rotate(-90deg)", transformOrigin: "50% 50%" }} />
        <text x={65} y={62} textAnchor="middle" fill={color} fontSize={22} fontWeight={700} fontFamily="DM Mono">{pct}%</text>
        <text x={65} y={80} textAnchor="middle" fill="#64748b" fontSize={10}>{label}</text>
      </svg>
    </div>
  );
}

// ── Insight stream ─────────────────────────────────────────────
function InsightBox({ ward }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    if (!ward) return;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setText(""); setLoading(true);
    try {
      const res = await fetch(`${API}/ward/${encodeURIComponent(ward)}/insight`, { signal: abortRef.current.signal });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setText(prev => prev + decoder.decode(value));
      }
    } catch (e) { if (e.name !== "AbortError") setText("Failed to load insight."); }
    finally { setLoading(false); }
  }, [ward]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "20px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em" }}>AI Insight</span>
        <button onClick={load} style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11 }}>
          ↻ Refresh
        </button>
      </div>
      <p style={{ color: "#cbd5e1", fontSize: 14, lineHeight: 1.7, margin: 0, minHeight: 60 }}>
        {loading && !text ? <span style={{ color: "#475569" }}>Analysing ward data…</span> : text}
        {loading && <span style={{ color: "#3b82f6", animation: "blink 1s infinite" }}>▌</span>}
      </p>
    </div>
  );
}

// ── Simulation panel ───────────────────────────────────────────
function SimPanel({ ward, currentAcceptance }) {
  const [fare, setFare]   = useState(1.0);
  const [dist, setDist]   = useState(1.0);
  const [result, setResult] = useState(null);
  const timer = useRef(null);

  const simulate = useCallback(async (f, d) => {
    if (!ward) return;
    const res = await fetch(`${API}/ward/${encodeURIComponent(ward)}/simulate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fare_adjustment: f, distance_adjustment: d }),
    });
    setResult(await res.json());
  }, [ward]);

  const debounce = (f, d) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => simulate(f, d), 300);
  };

  useEffect(() => { setFare(1.0); setDist(1.0); setResult(null); }, [ward]);

  const delta = result ? result.delta : 0;
  const simAcc = result ? result.simulated_acceptance : currentAcceptance;

  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "20px 24px" }}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Simulation Engine</div>
      <div style={{ display: "grid", gap: 16 }}>
        {[
          { label: "Fare adjustment", val: fare, set: v => { setFare(v); debounce(v, dist); }, min: 0.5, max: 2.0, step: 0.05, fmt: v => `${v >= 1 ? "+" : ""}${((v - 1) * 100).toFixed(0)}%` },
          { label: "Distance filter", val: dist, set: v => { setDist(v); debounce(fare, v); }, min: 0.5, max: 2.0, step: 0.05, fmt: v => `${v >= 1 ? "+" : ""}${((v - 1) * 100).toFixed(0)}%` },
        ].map(({ label, val, set, min, max, step, fmt: f }) => (
          <div key={label}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: "#94a3b8" }}>{label}</span>
              <span style={{ fontSize: 13, color: "#f1f5f9", fontFamily: "DM Mono" }}>{f(val)}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={val}
              onChange={e => set(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#3b82f6" }} />
          </div>
        ))}
      </div>
      {result && (
        <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
          <div style={{ flex: 1, background: "#0a0f1a", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>Current</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#94a3b8", fontFamily: "DM Mono" }}>{fmt(currentAcceptance, "pct")}</div>
          </div>
          <div style={{ flex: 1, background: "#0a0f1a", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>Simulated</div>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "DM Mono", color: delta > 0 ? "#22c55e" : "#ef4444" }}>
              {fmt(simAcc, "pct")}
            </div>
            <div style={{ fontSize: 12, color: delta > 0 ? "#22c55e" : "#ef4444" }}>
              {delta > 0 ? "▲ +" : "▼ "}{(Math.abs(delta) * 100).toFixed(1)}pp
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Comparison bar ─────────────────────────────────────────────
function CompBar({ label, ward, avg, type }) {
  const w = type === "pct" ? ward * 100 : ward;
  const a = type === "pct" ? avg * 100  : avg;
  const max = Math.max(w, a, 0.001);
  const good = label.includes("Accept") || label.includes("Convert") || label.includes("Earn");
  const wardBetter = good ? w >= a : w <= a;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748b", marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: wardBetter ? "#22c55e" : "#ef4444" }}>{type === "pct" ? w.toFixed(1) + "%" : w.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</span>
      </div>
      <div style={{ position: "relative", height: 6, background: "#1e293b", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ position: "absolute", height: "100%", width: `${(a / max) * 100}%`, background: "#334155", borderRadius: 4 }} />
        <div style={{ position: "absolute", height: "100%", width: `${(w / max) * 100}%`, background: wardBetter ? "#22c55e" : "#ef4444", borderRadius: 4, transition: "width 0.4s ease" }} />
      </div>
      <div style={{ fontSize: 11, color: "#475569", marginTop: 3 }}>City avg: {type === "pct" ? a.toFixed(1) + "%" : a.toLocaleString("en-IN", { maximumFractionDigits: 1 })}</div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────
export default function App() {
  const [wards, setWards]       = useState([]);
  const [selected, setSelected] = useState("");
  const [data, setData]         = useState(null);
  const [rankings, setRankings] = useState(null);
  const [search, setSearch]     = useState("");

  useEffect(() => {
    fetch(`${API}/wards`).then(r => r.json()).then(d => { setWards(d); if (d.length) setSelected(d[0].ward); });
    fetch(`${API}/rankings`).then(r => r.json()).then(setRankings);
  }, []);

  useEffect(() => {
    if (!selected) return;
    setData(null);
    fetch(`${API}/ward/${encodeURIComponent(selected)}`).then(r => r.json()).then(setData);
  }, [selected]);

  const filtered = wards.filter(w => w.ward.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display: "flex", height: "100vh", background: "#020817", color: "#f1f5f9", fontFamily: "'DM Sans', sans-serif", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0f172a; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
        @keyframes blink { 0%,100% { opacity:1 } 50% { opacity:0 } }
        input[type=range] { cursor: pointer; }
      `}</style>

      {/* Sidebar */}
      <div style={{ width: 260, background: "#0a0f1a", borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "24px 20px 16px" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.02em" }}>DriverIQ</div>
          <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Namma Yatri · Supply Intelligence</div>
        </div>
        <div style={{ padding: "0 12px 12px" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ward…"
            style={{ width: "100%", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 12px", color: "#f1f5f9", fontSize: 13, outline: "none" }} />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
          {filtered.map(w => (
            <div key={w.ward} onClick={() => setSelected(w.ward)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 12px", borderRadius: 8, cursor: "pointer", marginBottom: 2,
                background: selected === w.ward ? "#1e293b" : "transparent" }}>
              <span style={{ fontSize: 13, color: selected === w.ward ? "#f1f5f9" : "#94a3b8", fontWeight: selected === w.ward ? 600 : 400 }}>{w.ward}</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: RISK_COLOR[w.risk] || "#64748b",
                background: RISK_BG[w.risk] || "#0f172a", padding: "2px 7px", borderRadius: 4 }}>{w.risk}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 32px" }}>
        {!data ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#334155", fontSize: 14 }}>Loading ward data…</div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em" }}>{data.ward}</h1>
                <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: RISK_COLOR[data.risk], background: RISK_BG[data.risk], padding: "3px 10px", borderRadius: 6 }}>
                    {data.risk} Risk
                  </span>
                  <span style={{ fontSize: 12, color: "#64748b", background: "#0f172a", border: "1px solid #1e293b", padding: "3px 10px", borderRadius: 6 }}>
                    {data.cluster.label}
                  </span>
                </div>
                <p style={{ fontSize: 13, color: "#475569", marginTop: 8, maxWidth: 500 }}>{data.cluster.description}</p>
              </div>
              <Gauge value={data.predicted_acceptance} label="Acceptance" />
            </div>

            {/* KPIs */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
              <KPICard label="Driver Acceptance"  value={data.kpis.driver_quote_acceptance_rate} avg={data.city_avg.driver_quote_acceptance_rate} type="pct" />
              <KPICard label="Driver Cancellation" value={data.kpis.driver_cancellation_rate}     avg={data.city_avg.driver_cancellation_rate}     type="pct" />
              <KPICard label="Earnings/km"         value={data.kpis.earnings_per_km}              avg={data.city_avg.earnings_per_km}              type="inr" />
              <KPICard label="Conversion Rate"     value={data.kpis.conversion_rate}              avg={data.city_avg.conversion_rate}              type="pct" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
              <KPICard label="Revenue Leakage"    value={data.kpis.revenue_leakage}    avg={data.city_avg.revenue_leakage}    type="inr" />
              <KPICard label="Reliability Score"  value={data.kpis.reliability_score}  avg={null}                             type="num" />
              <KPICard label="Supply Gap"         value={data.kpis.supply_gap}         avg={null}                             type="num" />
            </div>

            {/* Middle row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
              {/* Comparison */}
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>vs City Average</div>
                <CompBar label="Acceptance Rate"    ward={data.kpis.driver_quote_acceptance_rate} avg={data.city_avg.driver_quote_acceptance_rate} type="pct" />
                <CompBar label="Cancellation Rate"  ward={data.kpis.driver_cancellation_rate}     avg={data.city_avg.driver_cancellation_rate}     type="pct" />
                <CompBar label="Conversion Rate"    ward={data.kpis.conversion_rate}              avg={data.city_avg.conversion_rate}              type="pct" />
                <CompBar label="Earnings/km (₹)"   ward={data.kpis.earnings_per_km}              avg={data.city_avg.earnings_per_km}              type="num" />
              </div>

              {/* Simulation */}
              <SimPanel ward={data.ward} currentAcceptance={data.kpis.driver_quote_acceptance_rate} />

              {/* Actions */}
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "20px 24px" }}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Recommended Actions</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {data.actions.map((a, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span style={{ color: "#3b82f6", fontSize: 14, marginTop: 1 }}>→</span>
                      <span style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 }}>{a}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Insight */}
            <div style={{ marginBottom: 24 }}>
              <InsightBox ward={data.ward} />
            </div>

            {/* Rankings */}
            {rankings && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[
                  { title: "Top Problem Wards", key: "top_problem_wards",     metric: "revenue_leakage", label: "Leakage", type: "inr" },
                  { title: "Opportunity Wards", key: "top_opportunity_wards", metric: "supply_gap",      label: "Supply gap", type: "num" },
                ].map(({ title, key, metric, label, type }) => (
                  <div key={key} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 12, padding: "20px 24px" }}>
                    <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>{title}</div>
                    {rankings[key].map((w, i) => (
                      <div key={w.ward} onClick={() => setSelected(w.ward)}
                        style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: i < 4 ? "1px solid #1e293b" : "none", cursor: "pointer" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: "#475569", fontFamily: "DM Mono", width: 16 }}>{i + 1}</span>
                          <span style={{ fontSize: 13, color: "#94a3b8" }}>{w.ward}</span>
                        </div>
                        <span style={{ fontSize: 13, color: "#f1f5f9", fontFamily: "DM Mono" }}>
                          {type === "inr" ? fmt(w[metric], "inr") : fmt(w[metric], "num")}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
