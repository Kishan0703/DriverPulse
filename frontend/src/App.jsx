import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Menu, RefreshCw, ArrowUp, ArrowDown, ChevronRight, X, Zap, Target, BarChart2 } from 'lucide-react';

// --- Constants ---
const API_BASE = 'http://localhost:8000';
const PLOT_COLORS = ['#1a1612', '#c84b2f', '#2d6a4f', '#e8a020', '#4a6fa5', '#7c4dab'];
const LAYOUT_DEFAULTS = {
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: { family: 'Instrument Sans', color: '#1a1612' },
  margin: { t: 40, r: 10, b: 40, l: 40 },
  showlegend: false,
};

// --- Utils ---
const formatCrores = (val) => `₹${(Math.abs(val) / 10000000).toFixed(2)}Cr`;
const formatPercent = (val) => `${(val * 100).toFixed(1)}%`;
const formatKM = (val) => `₹${val.toFixed(2)}`;

const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

// --- Components ---

const PlotlyChart = ({ data, layout, config = { displayModeBar: false }, style = { width: '100%', height: '100%' }, onClick }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (window.Plotly && ref.current) {
      window.Plotly.newPlot(ref.current, data, { ...LAYOUT_DEFAULTS, ...layout }, config);
      if (onClick) {
        ref.current.on('plotly_click', onClick);
      }
    }
    return () => {
      if (window.Plotly && ref.current) window.Plotly.purge(ref.current);
    };
  }, [data, layout, onClick]);

  useEffect(() => {
    if (window.Plotly && ref.current) {
      window.Plotly.react(ref.current, data, { ...LAYOUT_DEFAULTS, ...layout }, config);
    }
  }, [data, layout]);

  return <div ref={ref} style={style} />;
};

const StatCard = ({ label, value, subtext, color }) => (
  <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
    <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
    <div className="mono" style={{ fontSize: '36px', fontWeight: 800, color: color || 'inherit', letterSpacing: '-1.5px' }}>{value}</div>
    {subtext && <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '6px', fontWeight: 500 }}>{subtext}</div>}
  </div>
);

const KPICard = ({ label, value, delta, isPercent = false }) => {
  const deltaVal = parseFloat(delta);
  const isPositive = deltaVal > 0;
  const color = isPositive ? 'var(--positive)' : 'var(--negative)';
  const Icon = isPositive ? ArrowUp : ArrowDown;

  return (
    <div className="card">
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginTop: '12px' }}>
        <div className="mono" style={{ fontSize: '32px', fontWeight: 800, letterSpacing: '-1px' }}>{value}</div>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: '14px', color, fontWeight: 700, background: isPositive ? '#e6f4ea' : '#ffebeb', padding: '4px 8px', borderRadius: '20px' }}>
          <Icon size={14} /> {Math.abs(deltaVal).toFixed(1)}{isPercent ? '%' : ''}
        </div>
      </div>
    </div>
  );
};

// --- Tabs ---

const Tab1CityOverview = ({ data, onWardClick }) => {
  if (!data) return <div style={{ textAlign: 'center', padding: '100px', fontSize: '18px', color: 'var(--text-muted)' }}>Loading City Intelligence...</div>;

  // Business Plot: Opportunity Matrix (Supply Gap vs Acceptance)
  // Replaced Acceptance vs Earnings with a more actionable matrix.
  const opportunityMatrix = {
    data: [{
      x: data.acceptance_vs_earnings.map(d => {
        // We simulate supply gap from revenue leakage for the matrix view if gap is missing in this endpoint
        // Wait, acceptance_vs_earnings has revenue leakage. Let's use leakage vs acceptance as the opportunity matrix.
        return Math.abs(d.revenue_leakage) / 100000; 
      }),
      y: data.acceptance_vs_earnings.map(d => d.driver_quote_acceptance_rate * 100),
      mode: 'markers',
      marker: {
        size: data.acceptance_vs_earnings.map(d => d.earnings_per_km * 0.8), // Bubble size = earnings
        color: data.acceptance_vs_earnings.map(d => d.risk === 'High' ? '#c84b2f' : d.risk === 'Medium' ? '#e8a020' : '#2d6a4f'),
        opacity: 0.7,
        line: { width: 1, color: 'white' }
      },
      text: data.acceptance_vs_earnings.map(d => d.ward),
      hovertemplate: '<b>%{text}</b><br>Acceptance: %{y:.1f}%<br>Leakage: ₹%{x:.1f}L<extra></extra>'
    }],
    layout: {
      title: { text: 'Optimization Matrix: Acceptance vs. Revenue Leakage', font: { size: 16, weight: 700 } },
      xaxis: { title: 'Revenue Leakage (Lakhs)', gridcolor: '#f0ece6', zeroline: false },
      yaxis: { title: 'Driver Acceptance Rate (%)', gridcolor: '#f0ece6', zeroline: false },
      shapes: [
        { type: 'line', x0: 100, x1: 100, y0: 0, y1: 100, line: { dash: 'dash', width: 2, color: '#ccc' } },
        { type: 'line', x0: 0, x1: 600, y0: 50, y1: 50, line: { dash: 'dash', width: 2, color: '#ccc' } }
      ],
      annotations: [
        { x: 500, y: 15, text: 'CRITICAL (High Leakage, Low Acceptance)', showarrow: false, font: { color: '#c84b2f', size: 12, weight: 700 } },
        { x: 500, y: 90, text: 'OPPORTUNITY (High Demand Unmet)', showarrow: false, font: { color: '#e8a020', size: 12, weight: 700 } }
      ]
    }
  };

  const cancelVsConvert = {
    data: [{
      x: data.cancellation_vs_conversion.map(d => d.driver_cancellation_rate * 100),
      y: data.cancellation_vs_conversion.map(d => d.conversion_rate * 100),
      mode: 'markers',
      marker: {
        color: data.cancellation_vs_conversion.map(d => d.risk === 'High' ? '#c84b2f' : d.risk === 'Medium' ? '#e8a020' : '#2d6a4f'),
        size: 10,
        opacity: 0.8,
        line: { width: 1, color: 'white' }
      },
      text: data.cancellation_vs_conversion.map(d => d.ward),
      hovertemplate: '<b>%{text}</b><br>Cancel: %{x:.1f}%<br>Convert: %{y:.1f}%<extra></extra>'
    }],
    layout: {
      title: { text: 'Friction Analysis: Cancellation vs Conversion', font: { size: 16, weight: 700 } },
      xaxis: { title: 'Driver Cancellation Rate (%)', gridcolor: '#f0ece6', zeroline: false },
      yaxis: { title: 'User Conversion Rate (%)', gridcolor: '#f0ece6', zeroline: false },
      shapes: [
        { type: 'line', x0: data.city_avg_cancellation * 100, x1: data.city_avg_cancellation * 100, y0: 0, y1: 50, line: { dash: 'dot', width: 2, color: '#ccc' } },
        { type: 'line', x0: 0, x1: 60, y0: data.city_avg_conversion * 100, y1: data.city_avg_conversion * 100, line: { dash: 'dot', width: 2, color: '#ccc' } }
      ]
    }
  };

  const leakageByCluster = {
    data: [{
      y: data.leakage_by_cluster.map(d => d.cluster),
      x: data.leakage_by_cluster.map(d => Math.abs(d.avg_leakage) / 100000),
      type: 'bar',
      orientation: 'h',
      marker: { color: ['#c84b2f', '#2d6a4f', '#e8a020'], borderRadius: 6 }
    }],
    layout: {
      title: { text: 'Revenue At Risk by Driver Segment', font: { size: 16, weight: 700 } },
      xaxis: { title: 'Avg Revenue Leakage (Lakhs)', gridcolor: '#f0ece6', zeroline: false },
      yaxis: { automargin: true }
    }
  };

  const topLeakage = {
    data: [{
      y: data.top_leakage_wards.map(d => d.ward),
      x: data.top_leakage_wards.map(d => Math.abs(d.revenue_leakage) / 100000),
      type: 'bar',
      orientation: 'h',
      marker: { 
        color: data.top_leakage_wards.map(d => d.risk === 'High' ? '#c84b2f' : d.risk === 'Medium' ? '#e8a020' : '#2d6a4f'),
        borderRadius: 4
      }
    }],
    layout: {
      title: { text: 'Top 10 Wards: Highest Revenue Leakage', font: { size: 16, weight: 700 } },
      xaxis: { title: 'Total Leakage (Lakhs)', gridcolor: '#f0ece6', zeroline: false },
      yaxis: { automargin: true, autorange: 'reversed' },
      margin: { l: 150, r: 20, t: 40, b: 40 }
    }
  };

  return (
    <div className="main-container">
      <div className="kpi-grid">
        <StatCard label="High Risk Wards" value={data.high_risk_count} subtext="Requires immediate intervention" color="var(--negative)" />
        <StatCard label="City Acceptance Rate" value={formatPercent(data.city_avg_acceptance)} subtext={data.city_avg_acceptance > 0.6 ? "Above city baseline" : "Below city baseline"} />
        <StatCard label="Total Revenue Leakage" value={formatCrores(data.total_revenue_leakage)} subtext="Annualized estimate" />
        <StatCard label="Avg Earnings / km" value={formatKM(data.city_avg_earnings_per_km)} subtext="City-wide average" />
      </div>
      
      {/* 2024 Grid Layout: Actionable charts take priority */}
      <div className="bento-grid">
        <div className="card col-7" style={{ minHeight: '420px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1 }}><PlotlyChart {...opportunityMatrix} onClick={(d) => onWardClick(d.points[0].text)} /></div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '12px', background: '#f8f4f0', padding: '8px', borderRadius: '8px' }}>
            <Target size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
            Wards in the <b>bottom-right</b> represent high financial impact with severe supply-side rejection. Click bubbles to investigate.
          </div>
        </div>

        <div className="card col-5" style={{ minHeight: '420px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1 }}><PlotlyChart {...topLeakage} onClick={(d) => onWardClick(d.points[0].y)} /></div>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '12px', background: '#f8f4f0', padding: '8px', borderRadius: '8px' }}>
            These 10 wards account for <b>{((data.top_leakage_wards.reduce((a,b)=>a+Math.abs(b.revenue_leakage), 0) / Math.abs(data.total_revenue_leakage))*100).toFixed(1)}%</b> of total city leakage.
          </div>
        </div>

        <div className="card col-6" style={{ minHeight: '380px' }}>
          <PlotlyChart {...cancelVsConvert} onClick={(d) => onWardClick(d.points[0].text)} />
        </div>

        <div className="card col-6" style={{ minHeight: '380px' }}>
          <PlotlyChart {...leakageByCluster} />
        </div>
      </div>
    </div>
  );
};

const Tab2WardAnalysis = ({ selectedWardName, wards, onWardSelect }) => {
  const [wardData, setWardData] = useState(null);
  const [trends, setTrends] = useState(null);
  const [insight, setInsight] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('alpha');

  const [simFare, setSimFare] = useState(1.0);
  const [simDist, setSimDist] = useState(1.0);
  const [simResult, setSimResult] = useState(null);

  const debouncedSim = useDebounce({ fare: simFare, dist: simDist }, 300);

  useEffect(() => {
    if (selectedWardName) {
      setWardData(null); // Clear previous
      setTrends(null);
      fetch(`${API_BASE}/ward/${selectedWardName}`).then(r => r.json()).then(setWardData);
      fetch(`${API_BASE}/ward/${selectedWardName}/trends`).then(r => r.json()).then(setTrends);
      setInsight('Generating AI strategic insight for ' + selectedWardName + '...');
      const eventSource = new EventSource(`${API_BASE}/ward/${selectedWardName}/insight`);
      let accumulated = '';
      eventSource.onmessage = (e) => {
        accumulated += e.data;
        setInsight(accumulated);
      };
      eventSource.onerror = () => eventSource.close();
      return () => eventSource.close();
    }
  }, [selectedWardName]);

  useEffect(() => {
    if (selectedWardName && debouncedSim && wardData) {
      fetch(`${API_BASE}/ward/${selectedWardName}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fare_adjustment: debouncedSim.fare, distance_adjustment: debouncedSim.dist })
      }).then(r => r.json()).then(setSimResult);
    }
  }, [selectedWardName, debouncedSim, wardData]);

  const sortedWards = useMemo(() => {
    let filtered = wards.filter(w => w.ward.toLowerCase().includes(searchTerm.toLowerCase()));
    if (sortBy === 'alpha') return filtered.sort((a, b) => a.ward.localeCompare(b.ward));
    const riskOrder = { 'High': 0, 'Medium': 1, 'Low': 2 };
    return filtered.sort((a, b) => riskOrder[a.risk] - riskOrder[b.risk]);
  }, [wards, searchTerm, sortBy]);

  const radarData = wardData && {
    data: [
      {
        type: 'scatterpolar',
        r: [wardData.kpis.driver_quote_acceptance_rate, wardData.kpis.conversion_rate, wardData.kpis.earnings_per_km / 30, wardData.kpis.reliability_score, 1 - wardData.kpis.driver_cancellation_rate],
        theta: ['Acceptance', 'Conversion', 'Earnings/km', 'Reliability', '1-Cancellation'],
        fill: 'toself',
        fillcolor: 'rgba(200, 75, 47, 0.3)',
        line: { color: '#c84b2f', width: 3 },
        name: wardData.ward
      },
      {
        type: 'scatterpolar',
        r: [wardData.city_avg.driver_quote_acceptance_rate, wardData.city_avg.conversion_rate, wardData.city_avg.earnings_per_km / 30, 0.5, 1 - wardData.city_avg.driver_cancellation_rate],
        theta: ['Acceptance', 'Conversion', 'Earnings/km', 'Reliability', '1-Cancellation'],
        fill: 'none',
        line: { color: '#6b6560', dash: 'dash', width: 2 },
        name: 'City Avg'
      }
    ],
    layout: {
      polar: { radialaxis: { visible: false, range: [0, 1] }, angularaxis: { font: { size: 11, weight: 600 } } },
      title: { text: 'Ward vs City Profile', font: { size: 16, weight: 700 } },
      margin: { t: 60, r: 40, b: 40, l: 40 }
    }
  };

  const peerData = (trends && wardData) && {
    data: [
      {
        x: trends.cluster_peers.map(p => p.earnings_per_km),
        y: trends.cluster_peers.map(p => p.driver_quote_acceptance_rate * 100),
        mode: 'markers',
        marker: { color: '#e0d8d0', size: 10, opacity: 0.7 },
        name: 'Peers',
        hovertemplate: 'Peer<br>Acceptance: %{y:.1f}%<br>Earnings: ₹%{x:.2f}<extra></extra>'
      },
      {
        x: [wardData.kpis.earnings_per_km],
        y: [wardData.kpis.driver_quote_acceptance_rate * 100],
        mode: 'markers+text',
        marker: { color: '#c84b2f', size: 16, line: { color: 'white', width: 2 } },
        text: [wardData.ward],
        textposition: 'top center',
        textfont: { weight: 800, size: 14 },
        name: 'Selected',
        hovertemplate: '<b>%{text}</b><br>Acceptance: %{y:.1f}%<br>Earnings: ₹%{x:.2f}<extra></extra>'
      }
    ],
    layout: {
      title: { text: 'Performance vs Cluster Peers', font: { size: 16, weight: 700 } },
      xaxis: { title: 'Earnings/km', gridcolor: '#f0ece6', zeroline: false },
      yaxis: { title: 'Acceptance Rate (%)', gridcolor: '#f0ece6', zeroline: false }
    }
  };

  return (
    <div className="main-container" style={{ padding: '0 24px' }}>
      <div className="ward-layout">
        <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
          <div style={{ padding: '24px', borderBottom: '1px solid var(--border-color)', background: '#fafafa' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '20px' }}>Wards Directory</h3>
              <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={20} /></button>
            </div>
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <Search size={16} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input 
                placeholder="Search wards..." 
                style={{ width: '100%', padding: '12px 14px 12px 40px', borderRadius: '10px', border: '1px solid var(--border-color)', fontSize: '14px', outline: 'none', transition: 'border-color 0.2s' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border-color)'}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setSortBy('alpha')} className="tab-button" style={{ flex: 1, padding: '8px', fontSize: '12px', background: sortBy === 'alpha' ? 'white' : 'transparent', border: sortBy === 'alpha' ? '1px solid var(--accent)' : '1px solid var(--border-color)' }}>A-Z</button>
              <button onClick={() => setSortBy('risk')} className="tab-button" style={{ flex: 1, padding: '8px', fontSize: '12px', background: sortBy === 'risk' ? 'white' : 'transparent', border: sortBy === 'risk' ? '1px solid var(--accent)' : '1px solid var(--border-color)' }}>Risk Level</button>
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {sortedWards.map(w => (
              <div key={w.ward} className={`ward-list-item ${selectedWardName === w.ward ? 'active' : ''}`} onClick={() => onWardSelect(w.ward)}>
                <div className={`risk-dot risk-${w.risk}`} />
                <span style={{ fontSize: '15px', fontWeight: selectedWardName === w.ward ? 700 : 500 }}>{w.ward}</span>
              </div>
            ))}
          </div>
        </aside>

        <div className="ward-content">
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} style={{ position: 'fixed', left: '24px', bottom: '40px', width: '56px', height: '56px', borderRadius: '50%', background: 'var(--accent)', color: 'white', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 24px rgba(200, 75, 47, 0.4)', zIndex: 1000, cursor: 'pointer', transition: 'transform 0.2s' }} onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
              <Menu size={24} />
            </button>
          )}

          {!selectedWardName ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: '#f0ece6', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
                <Search size={32} style={{ color: '#c0b8b0' }} />
              </div>
              <h2 style={{ fontFamily: 'Fraunces', margin: '0 0 12px 0', color: 'var(--text-primary)' }}>Select a Ward</h2>
              <p style={{ fontSize: '15px', maxWidth: '400px', textAlign: 'center' }}>Choose a ward from the directory to unlock deep insights, simulate policy changes, and view AI recommendations.</p>
            </div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: '24px', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
                <div>
                  <h2 className="heading-fraunces" style={{ margin: '0 0 12px 0', fontSize: '36px' }}>{selectedWardName}</h2>
                  {wardData && (
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <span className={`badge badge-risk-${wardData.risk}`}>{wardData.risk} Risk</span>
                      <span className="cluster-tag">{wardData.cluster.label}</span>
                      <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 500 }}>{wardData.cluster.description}</span>
                    </div>
                  )}
                </div>
                {wardData && (
                  <div style={{ textAlign: 'right' }}>
                     <div style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Revenue Leakage</div>
                     <div className="mono" style={{ fontSize: '28px', fontWeight: 800, color: 'var(--negative)' }}>{formatLakhs(wardData.kpis.revenue_leakage)}</div>
                  </div>
                )}
              </div>

              {wardData ? (
                <>
                  <div className="kpi-grid">
                    <KPICard label="Driver Acceptance" value={formatPercent(wardData.kpis.driver_quote_acceptance_rate)} delta={(wardData.kpis.driver_quote_acceptance_rate - wardData.city_avg.driver_quote_acceptance_rate)*100} isPercent />
                    <KPICard label="Driver Cancellation" value={formatPercent(wardData.kpis.driver_cancellation_rate)} delta={(wardData.kpis.driver_cancellation_rate - wardData.city_avg.driver_cancellation_rate)*100} isPercent />
                    <KPICard label="Earnings/km" value={formatKM(wardData.kpis.earnings_per_km)} delta={wardData.kpis.earnings_per_km - wardData.city_avg.earnings_per_km} />
                    <KPICard label="Conversion Rate" value={formatPercent(wardData.kpis.conversion_rate)} delta={(wardData.kpis.conversion_rate - wardData.city_avg.conversion_rate)*100} isPercent />
                  </div>

                  <div className="bento-grid">
                    <div className="card col-4" style={{ minHeight: '400px' }}><PlotlyChart {...radarData} /></div>
                    <div className="card col-4" style={{ minHeight: '400px' }}>{peerData && <PlotlyChart {...peerData} />}</div>
                    <div className="card col-4" style={{ display: 'flex', flexDirection: 'column' }}>
                      <h4 style={{ margin: '0 0 20px 0', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Zap size={18} color="var(--amber)" /> Supply Simulation Engine
                      </h4>
                      <div className="slider-group">
                        <div className="slider-label"><span>Fare Adjustment</span><span className="mono">{simFare.toFixed(1)}x (₹{simResult?.new_fare || wardData.kpis.avg_fare})</span></div>
                        <input type="range" min="0.8" max="2.0" step="0.1" value={simFare} onChange={e => setSimFare(parseFloat(e.target.value))} />
                      </div>
                      <div className="slider-group">
                        <div className="slider-label"><span>Distance Multiplier</span><span className="mono">{simDist.toFixed(1)}x ({simResult?.new_distance || wardData.kpis.avg_distance}km)</span></div>
                        <input type="range" min="0.5" max="2.0" step="0.1" value={simDist} onChange={e => setSimDist(parseFloat(e.target.value))} />
                      </div>
                      {simResult && (
                        <div style={{ background: '#f8f4f0', padding: '20px', borderRadius: '12px', textAlign: 'center', marginBottom: '20px', border: '1px solid #e8e0d5' }}>
                          <div style={{ fontSize: '13px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Simulated Acceptance</div>
                          <div className="mono" style={{ fontSize: '36px', fontWeight: 800, margin: '8px 0' }}>{formatPercent(simResult.simulated_acceptance)}</div>
                          <div style={{ fontSize: '15px', fontWeight: 800, color: simResult.delta >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                            {simResult.delta >= 0 ? '↗ +' : '↘ '}{(simResult.delta * 100).toFixed(1)}% vs Current
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="card col-6" style={{ minHeight: '280px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h4 style={{ margin: 0, fontSize: '18px' }}>AI Strategic Insight</h4>
                        <RefreshCw size={18} style={{ color: 'var(--text-muted)', cursor: 'pointer' }} />
                      </div>
                      <div style={{ background: '#fdfaf5', borderLeft: '4px solid var(--amber)', padding: '20px', borderRadius: '0 8px 8px 0', fontSize: '15px', lineHeight: '1.7', color: '#333' }}>
                        {insight}
                      </div>
                    </div>

                    <div className="card col-6" style={{ minHeight: '280px', overflowY: 'auto' }}>
                      <h4 style={{ margin: '0 0 20px 0', fontSize: '18px' }}>Action Plan</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {wardData.actions.map((a, i) => (
                           <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', background: '#f8f9fa', padding: '12px 16px', borderRadius: '8px' }}>
                             <div style={{ background: 'var(--accent)', color: 'white', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', flexShrink: 0 }}>{i+1}</div>
                             <div style={{ fontSize: '14px', fontWeight: 500, lineHeight: '1.5' }}>{a}</div>
                           </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                 <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading ward metrics...</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const Tab3MLPredictionLab = ({ wards, onWardSelect }) => {
  // We make the sliders look more like control levers for business logic.
  const [riskIn, setRiskIn] = useState({ cancel: 0.2, accept: 0.5, convert: 0.2 });
  const [riskRes, setRiskRes] = useState(null);
  const [accIn, setAccIn] = useState({ earnings: 18, dist: 8, fare: 150, gap: 100000 });
  const [accRes, setAccRes] = useState(null);
  const [clusIn, setClusIn] = useState({ cancel: 0.2, accept: 0.5, earnings: 18, dist: 8 });
  const [clusRes, setClusRes] = useState(null);
  const [shapWard, setShapWard] = useState('');
  const [shapRes, setShapRes] = useState(null);

  const predictRisk = () => {
    fetch(`${API_BASE}/predict/risk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_cancellation_rate: riskIn.cancel, driver_quote_acceptance_rate: riskIn.accept, conversion_rate: riskIn.convert })
    }).then(r => r.json()).then(setRiskRes);
  };

  const predictAcceptance = () => {
    fetch(`${API_BASE}/predict/acceptance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ earnings_per_km: accIn.earnings, avg_distance: accIn.dist, avg_fare: accIn.fare, supply_gap: accIn.gap })
    }).then(r => r.json()).then(setAccRes);
  };

  const predictCluster = () => {
    fetch(`${API_BASE}/predict/cluster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ driver_cancellation_rate: clusIn.cancel, driver_quote_acceptance_rate: clusIn.accept, earnings_per_km: clusIn.earnings, avg_distance: clusIn.dist })
    }).then(r => r.json()).then(setClusRes);
  };

  const explainModel = () => {
    if (shapWard) {
      setShapRes(null); // Clear previous
      fetch(`${API_BASE}/predict/shap/${shapWard}`)
        .then(r => r.json())
        .then(setShapRes)
        .catch(err => alert("Failed to fetch explainability data. Backend might be unavailable."));
    }
  };

  return (
    <div className="main-container">
      <div className="card" style={{ marginBottom: '24px', background: 'var(--text-primary)', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <BarChart2 size={32} color="var(--accent)" />
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '24px', fontFamily: 'Instrument Sans', fontWeight: 800 }}>Predictive AI Laboratory</h2>
            <p style={{ margin: 0, fontSize: '15px', color: '#bbb' }}>Simulate extreme market conditions and unpack the "why" behind the algorithms.</p>
          </div>
        </div>
      </div>

      <div className="bento-grid">
        {/* Risk Column */}
        <div className="card col-4" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Ward Risk Classifier</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: '1.5' }}>Input hypothetical friction metrics to foresee ward degradation risk.</p>
          
          <div style={{ flex: 1 }}>
            <div className="slider-group">
              <div className="slider-label"><span>Cancellation Rate</span><span className="mono">{(riskIn.cancel*100).toFixed(0)}%</span></div>
              <input type="range" min="0" max="0.6" step="0.01" value={riskIn.cancel} onChange={e => setRiskIn({...riskIn, cancel: parseFloat(e.target.value)})} />
            </div>
            <div className="slider-group">
              <div className="slider-label"><span>Acceptance Rate</span><span className="mono">{(riskIn.accept*100).toFixed(0)}%</span></div>
              <input type="range" min="0" max="1" step="0.01" value={riskIn.accept} onChange={e => setRiskIn({...riskIn, accept: parseFloat(e.target.value)})} />
            </div>
            <div className="slider-group">
              <div className="slider-label"><span>User Conversion</span><span className="mono">{(riskIn.convert*100).toFixed(0)}%</span></div>
              <input type="range" min="0" max="0.5" step="0.01" value={riskIn.convert} onChange={e => setRiskIn({...riskIn, convert: parseFloat(e.target.value)})} />
            </div>
          </div>
          
          <button className="primary" onClick={predictRisk}>Evaluate Risk</button>
          
          {riskRes && (
            <div style={{ marginTop: '24px', padding: '20px', background: '#f8f4f0', borderRadius: '12px', border: '1px solid #e8e0d5' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Predicted Future State</div>
              <div style={{ fontSize: '28px', fontWeight: 800, color: riskRes.risk === 'High' ? 'var(--negative)' : riskRes.risk === 'Medium' ? 'var(--amber)' : 'var(--positive)', margin: '8px 0' }}>{riskRes.risk} Risk</div>
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px' }}>PROBABILITY DISTRIBUTION</div>
                {Object.entries(riskRes.probabilities).map(([k, v]) => (
                  <div key={k} style={{ marginBottom: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}><span>{k}</span><span>{(v*100).toFixed(1)}%</span></div>
                    <div style={{ height: '6px', background: '#e8e0d5', borderRadius: '3px' }}><div style={{ height: '100%', width: `${v*100}%`, background: k === 'High' ? '#c84b2f' : k === 'Medium' ? '#e8a020' : '#2d6a4f', borderRadius: 3 }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Acceptance Column */}
        <div className="card col-4" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '18px', margin: 0 }}>Driver Acceptance Model</h3>
            <button onClick={() => setAccIn({earnings: 25, dist: 15, fare: 350, gap: 50000})} style={{ background: '#f0ece6', border: 'none', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>Preset: Surge</button>
          </div>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: '1.5' }}>Model the impact of dynamic pricing and demand shocks.</p>
          
          <div style={{ flex: 1 }}>
            <div className="slider-group"><div className="slider-label"><span>Earnings Lever (₹/km)</span><span className="mono">₹{accIn.earnings}</span></div><input type="range" min="5" max="50" step="1" value={accIn.earnings} onChange={e => setAccIn({...accIn, earnings: parseFloat(e.target.value)})} /></div>
            <div className="slider-group"><div className="slider-label"><span>Trip Distance Profile</span><span className="mono">{accIn.dist}km</span></div><input type="range" min="1" max="20" step="1" value={accIn.dist} onChange={e => setAccIn({...accIn, dist: parseFloat(e.target.value)})} /></div>
            <div className="slider-group"><div className="slider-label"><span>Base Fare</span><span className="mono">₹{accIn.fare}</span></div><input type="range" min="50" max="500" step="10" value={accIn.fare} onChange={e => setAccIn({...accIn, fare: parseFloat(e.target.value)})} /></div>
            <div className="slider-group"><div className="slider-label"><span>Market Supply Gap</span><span className="mono">{accIn.gap/1000}K</span></div><input type="range" min="0" max="500000" step="10000" value={accIn.gap} onChange={e => setAccIn({...accIn, gap: parseFloat(e.target.value)})} /></div>
          </div>
          
          <button className="primary" onClick={predictAcceptance}>Simulate Market</button>
          
          {accRes && (
            <div style={{ marginTop: '24px', padding: '20px', background: '#f8f4f0', borderRadius: '12px', border: '1px solid #e8e0d5' }}>
               <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Forecasted Acceptance</div>
               <div style={{ fontSize: '36px', fontWeight: 800, margin: '8px 0' }}>{formatPercent(accRes.predicted_acceptance)}</div>
               <div style={{ height: '8px', background: '#e8e0d5', borderRadius: '4px', margin: '16px 0', overflow: 'hidden' }}>
                 <div style={{ height: '100%', width: `${accRes.predicted_acceptance*100}%`, background: accRes.predicted_acceptance > 0.6 ? 'var(--positive)' : accRes.predicted_acceptance > 0.4 ? 'var(--amber)' : 'var(--negative)' }} />
               </div>
               <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: '1.5' }}>{accRes.interpretation}</div>
            </div>
          )}
        </div>

        {/* Cluster Column */}
        <div className="card col-4" style={{ display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: '18px', marginBottom: '8px' }}>Cohort Engine (K-Means)</h3>
          <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: '1.5' }}>Identify which behavioral archetype these metrics map to.</p>
          
          <div style={{ flex: 1 }}>
            <div className="slider-group"><div className="slider-label"><span>Cancellation Rate</span><span className="mono">{(clusIn.cancel*100).toFixed(0)}%</span></div><input type="range" min="0" max="0.6" step="0.01" value={clusIn.cancel} onChange={e => setClusIn({...clusIn, cancel: parseFloat(e.target.value)})} /></div>
            <div className="slider-group"><div className="slider-label"><span>Acceptance Rate</span><span className="mono">{(clusIn.accept*100).toFixed(0)}%</span></div><input type="range" min="0" max="1" step="0.01" value={clusIn.accept} onChange={e => setClusIn({...clusIn, accept: parseFloat(e.target.value)})} /></div>
            <div className="slider-group"><div className="slider-label"><span>Earnings/km</span><span className="mono">₹{clusIn.earnings}</span></div><input type="range" min="5" max="40" step="1" value={clusIn.earnings} onChange={e => setClusIn({...clusIn, earnings: parseFloat(e.target.value)})} /></div>
            <div className="slider-group"><div className="slider-label"><span>Avg Distance</span><span className="mono">{clusIn.dist}km</span></div><input type="range" min="1" max="20" step="1" value={clusIn.dist} onChange={e => setClusIn({...clusIn, dist: parseFloat(e.target.value)})} /></div>
          </div>

          <button className="primary" onClick={predictCluster}>Profile Cohort</button>
          
          {clusRes && (
            <div style={{ marginTop: '24px', padding: '20px', background: '#f8f4f0', borderRadius: '12px', border: '1px solid #e8e0d5' }}>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Matched Segment</div>
              <div style={{ fontSize: '20px', fontWeight: 800, margin: '8px 0', color: 'var(--accent)' }}>{clusRes.cluster_label}</div>
              <p style={{ fontSize: '14px', color: '#444', margin: '0 0 20px 0', lineHeight: '1.6' }}>{clusRes.description}</p>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase' }}>Peers in Cohort</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {clusRes.similar_wards.map(w => <span key={w} className="cluster-tag" style={{ cursor: 'pointer', background: 'white', border: '1px solid #ddd' }} onClick={() => onWardSelect(w)}>{w}</span>)}
              </div>
            </div>
          )}
        </div>

        {/* SHAP Bottom Strip */}
        <div className="card col-12" style={{ padding: '32px', background: 'white', borderTop: '4px solid #1a1612' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '20px' }}>
            <div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>Model Explainability (SHAP)</h3>
              <p style={{ margin: 0, fontSize: '15px', color: 'var(--text-muted)', maxWidth: '600px' }}>
                Black-box models aren't enough for business strategy. Select a ward to deconstruct <i>exactly</i> which features pushed the model's predictions higher or lower.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <select value={shapWard} onChange={e => setShapWard(e.target.value)} style={{ padding: '12px 20px', borderRadius: '8px', border: '1px solid var(--border-color)', outline: 'none', fontSize: '15px', minWidth: '200px', fontWeight: 600, background: '#f8f9fa' }}>
                <option value="">-- Select Target Ward --</option>
                {wards.map(w => <option key={w.ward} value={w.ward}>{w.ward}</option>)}
              </select>
              <button onClick={explainModel} className="primary" style={{ width: 'auto', padding: '12px 24px', background: '#1a1612' }}>Explain Decisions</button>
            </div>
          </div>
          
          {shapRes && (
            <div className="bento-grid">
               <div className="col-6" style={{ background: '#fcfbf9', padding: '24px', borderRadius: '12px', border: '1px solid #f0ece6' }}>
                 <div style={{ fontSize: '13px', fontWeight: 800, marginBottom: '24px', color: '#1a1612', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', background: 'var(--negative)', borderRadius: '50%' }}></div> Risk Model Drivers
                 </div>
                 {shapRes.risk_shap.slice(0, 6).map(s => (
                   <div key={s.feature} style={{ marginBottom: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                        <span>{s.feature.replace(/_/g, ' ').toUpperCase()}</span>
                        <span style={{ color: s.impact > 0 ? 'var(--negative)' : 'var(--positive)' }}>
                          {s.impact > 0 ? '+' : ''}{s.impact.toFixed(3)}
                        </span>
                      </div>
                      <div style={{ height: '10px', background: '#e8e0d5', borderRadius: '5px', position: 'relative' }}>
                         {s.impact > 0 ? (
                           <div style={{ position: 'absolute', right: '50%', height: '100%', width: `${Math.min(50, Math.abs(s.impact)*500)}%`, background: 'var(--negative)', borderRadius: '5px 0 0 5px' }} />
                         ) : (
                           <div style={{ position: 'absolute', left: '50%', height: '100%', width: `${Math.min(50, Math.abs(s.impact)*500)}%`, background: 'var(--positive)', borderRadius: '0 5px 5px 0' }} />
                         )}
                         {/* Center line */}
                         <div style={{ position: 'absolute', left: '50%', top: '-2px', height: '14px', width: '2px', background: '#1a1612' }} />
                      </div>
                   </div>
                 ))}
                 <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>← Decreases Risk | Increases Risk →</div>
               </div>

               <div className="col-6" style={{ background: '#fcfbf9', padding: '24px', borderRadius: '12px', border: '1px solid #f0ece6' }}>
                 <div style={{ fontSize: '13px', fontWeight: 800, marginBottom: '24px', color: '#1a1612', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ width: '8px', height: '8px', background: 'var(--positive)', borderRadius: '50%' }}></div> Acceptance Model Drivers
                 </div>
                 {shapRes.acceptance_shap.slice(0, 6).map(s => (
                   <div key={s.feature} style={{ marginBottom: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                        <span>{s.feature.replace(/_/g, ' ').toUpperCase()}</span>
                        <span style={{ color: s.impact > 0 ? 'var(--positive)' : 'var(--negative)' }}>
                          {s.impact > 0 ? '+' : ''}{s.impact.toFixed(3)}
                        </span>
                      </div>
                      <div style={{ height: '10px', background: '#e8e0d5', borderRadius: '5px', position: 'relative' }}>
                         {s.impact > 0 ? (
                           <div style={{ position: 'absolute', left: '50%', height: '100%', width: `${Math.min(50, Math.abs(s.impact)*500)}%`, background: 'var(--positive)', borderRadius: '0 5px 5px 0' }} />
                         ) : (
                           <div style={{ position: 'absolute', right: '50%', height: '100%', width: `${Math.min(50, Math.abs(s.impact)*500)}%`, background: 'var(--negative)', borderRadius: '5px 0 0 5px' }} />
                         )}
                         <div style={{ position: 'absolute', left: '50%', top: '-2px', height: '14px', width: '2px', background: '#1a1612' }} />
                      </div>
                   </div>
                 ))}
                 <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '12px', color: 'var(--text-muted)' }}>← Decreases Acceptance | Increases Acceptance →</div>
               </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [activeTab, setActiveTab] = useState(1);
  const [selectedWard, setSelectedWard] = useState(null);
  const [wards, setWards] = useState([]);
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/wards`).then(r => r.json()).then(setWards);
    fetch(`${API_BASE}/overview`).then(r => r.json()).then(setOverview);
  }, []);

  const handleWardClick = (wardName) => {
    setSelectedWard(wardName);
    setActiveTab(2);
    window.scrollTo(0, 0);
  };

  return (
    <div id="root">
      <nav className="pill-switcher" style={{ borderBottom: '1px solid var(--border-color)', marginBottom: '32px' }}>
        <button className={`tab-button ${activeTab === 1 ? 'active' : ''}`} onClick={() => setActiveTab(1)}>City Intelligence</button>
        <button className={`tab-button ${activeTab === 2 ? 'active' : ''}`} onClick={() => setActiveTab(2)}>Ward Deep Dive</button>
        <button className={`tab-button ${activeTab === 3 ? 'active' : ''}`} onClick={() => setActiveTab(3)}>AI Prediction Lab</button>
      </nav>

      <main style={{ flex: 1 }}>
        {activeTab === 1 && <Tab1CityOverview data={overview} onWardClick={handleWardClick} />}
        {activeTab === 2 && <Tab2WardAnalysis selectedWardName={selectedWard} wards={wards} onWardSelect={handleWardClick} />}
        {activeTab === 3 && <Tab3MLPredictionLab wards={wards} onWardSelect={handleWardClick} />}
      </main>
    </div>
  );
}
