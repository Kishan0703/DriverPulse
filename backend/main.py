import joblib
import os
import pandas as pd
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pathlib import Path
from dotenv import load_dotenv
import httpx
import json
import shap

load_dotenv()

app = FastAPI(title="DriverIQ API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Updated to allow all origins for dev flexibility
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load artifacts ──────────────────────────────────────────────
BASE = Path(__file__).parent
df = pd.read_csv(BASE / "data/cleaned.csv")

risk_clf = joblib.load(BASE / "models/ward_risk_classifier.pkl")
acceptance_reg = joblib.load(BASE / "models/acceptance_predictor.pkl")
kmeans = joblib.load(BASE / "models/driver_behavior_kmeans.pkl")
cluster_scaler = joblib.load(BASE / "models/cluster_scaler.pkl")
cluster_label_map = joblib.load(BASE / "models/cluster_label_map.pkl")
risk_encoder = joblib.load(BASE / "models/risk_label_encoder.pkl")

ward_clusters = pd.read_csv(BASE / "models/ward_cluster_labels.csv")
df = df.merge(ward_clusters[["ward", "cluster_label"]], on="ward", how="left")

# Initialize SHAP explainers
risk_features = ["driver_cancellation_rate", "driver_quote_acceptance_rate", "conversion_rate", "booking_cancellation_rate", "user_cancellation_rate", "earnings_per_km", "avg_distance", "avg_fare", "supply_gap", "reliability_score"]
acceptance_features = ["earnings_per_km", "avg_distance", "avg_fare", "supply_gap"]

risk_explainer = shap.Explainer(risk_clf, df[risk_features])
acceptance_explainer = shap.Explainer(acceptance_reg, df[acceptance_features])

CITY_AVG = df.drop(columns=["ward", "cluster_label"], errors="ignore").mean().to_dict()

CLUSTER_DESCRIPTIONS = {
    "⭐ Reliable Performers": "High acceptance, low cancellations. Retain these drivers with loyalty incentives.",
    "⚠️ High-Risk Zones":     "Low acceptance and high cancellations. Needs urgent fare floor or supply push.",
    "🔄 Average Balanced":    "Moderate performers. Monitor and improve incentive structure.",
}

# ── Models ──────────────────────────────────────────────────────
class PredictRiskRequest(BaseModel):
    driver_cancellation_rate: float
    driver_quote_acceptance_rate: float
    conversion_rate: float

class PredictAcceptanceRequest(BaseModel):
    earnings_per_km: float
    avg_distance: float
    avg_fare: float
    supply_gap: float

class PredictClusterRequest(BaseModel):
    driver_cancellation_rate: float
    driver_quote_acceptance_rate: float
    earnings_per_km: float
    avg_distance: float

# ── Helpers ─────────────────────────────────────────────────────
def get_ward_row(ward_name: str) -> pd.Series:
    row = df[df["ward"].str.lower() == ward_name.lower()]
    if row.empty:
        raise HTTPException(status_code=404, detail=f"Ward '{ward_name}' not found")
    return row.iloc[0]

def predict_acceptance(earnings_per_km, avg_distance, avg_fare, supply_gap) -> float:
    X = pd.DataFrame([{
        "earnings_per_km": earnings_per_km,
        "avg_distance":    avg_distance,
        "avg_fare":        avg_fare,
        "supply_gap":      supply_gap,
    }])
    return float(np.clip(acceptance_reg.predict(X)[0], 0, 1))

def predict_risk(row: pd.Series) -> str:
    X = pd.DataFrame([{f: row[f] for f in risk_features}])
    label_idx = risk_clf.predict(X)[0]
    return risk_encoder.inverse_transform([label_idx])[0] if hasattr(risk_encoder, "inverse_transform") else str(label_idx)

def recommend_actions(row: pd.Series) -> list[str]:
    actions = []
    if row["driver_quote_acceptance_rate"] < 0.45:
        actions.append("Raise minimum fare/km — drivers rejecting low-value quotes")
    if row["driver_cancellation_rate"] > 0.25:
        actions.append("Penalise post-booking cancellations — driver reliability low")
    if row["supply_gap"] > CITY_AVG["supply_gap"]:
        actions.append("Supply push needed — demand significantly outpacing driver availability")
    if row["avg_distance"] < 3:
        actions.append("Introduce short-trip incentive — drivers avoiding <3km rides")
    if row["earnings_per_km"] < CITY_AVG["earnings_per_km"]:
        actions.append("Earnings/km below city average — unattractive for drivers")
    if not actions:
        actions.append("Ward performing well — maintain current incentive structure")
    return actions

# ── Routes ───────────────────────────────────────────────────────

@app.get("/overview")
def get_overview():
    tmp = df.copy()
    tmp["risk"] = tmp.apply(predict_risk, axis=1)
    
    risk_counts = tmp["risk"].value_counts().to_dict()
    
    top_leakage = tmp.nlargest(10, "revenue_leakage")[["ward", "revenue_leakage", "risk"]].to_dict(orient="records")
    
    leakage_by_cluster = tmp.groupby("cluster_label").agg(
        avg_leakage=("revenue_leakage", "mean"),
        count=("ward", "count")
    ).reset_index().rename(columns={"cluster_label": "cluster"}).to_dict(orient="records")
    
    return {
        "total_wards": len(df),
        "high_risk_count": risk_counts.get("High", 0),
        "medium_risk_count": risk_counts.get("Medium", 0),
        "low_risk_count": risk_counts.get("Low", 0),
        "city_avg_acceptance": CITY_AVG["driver_quote_acceptance_rate"],
        "city_avg_cancellation": CITY_AVG["driver_cancellation_rate"],
        "city_avg_conversion": CITY_AVG["conversion_rate"],
        "city_avg_earnings_per_km": CITY_AVG["earnings_per_km"],
        "total_revenue_leakage": df["revenue_leakage"].sum(),
        "top_leakage_wards": top_leakage,
        "acceptance_vs_earnings": tmp[["ward", "driver_quote_acceptance_rate", "earnings_per_km", "revenue_leakage", "risk"]].to_dict(orient="records"),
        "cancellation_vs_conversion": tmp[["ward", "driver_cancellation_rate", "conversion_rate", "risk"]].to_dict(orient="records"),
        "leakage_by_cluster": leakage_by_cluster
    }

@app.get("/ward/{ward_name}/trends")
def get_ward_trends(ward_name: str):
    row = get_ward_row(ward_name)
    
    # Calculate percentiles
    metrics = {
        "acceptance": "driver_quote_acceptance_rate",
        "cancellation": "driver_cancellation_rate",
        "conversion": "conversion_rate",
        "earnings": "earnings_per_km",
        "leakage": "revenue_leakage"
    }
    
    percentiles = {}
    for key, col in metrics.items():
        percentiles[f"{key}_percentile"] = float((df[col] <= row[col]).mean() * 100)
    
    cluster_peers = df[df["cluster_label"] == row["cluster_label"]][["ward", "driver_quote_acceptance_rate", "earnings_per_km"]].to_dict(orient="records")
    
    return {**percentiles, "cluster_peers": cluster_peers}

@app.post("/predict/risk")
def route_predict_risk(body: PredictRiskRequest):
    # For prediction, we use city averages for missing features
    input_data = {f: CITY_AVG.get(f, 0) for f in risk_features}
    input_data.update(body.model_dump())
    
    X = pd.DataFrame([input_data])
    label_idx = risk_clf.predict(X)[0]
    risk = risk_encoder.inverse_transform([label_idx])[0] if hasattr(risk_encoder, "inverse_transform") else str(label_idx)
    
    probs = risk_clf.predict_proba(X)[0]
    prob_dict = {risk_encoder.inverse_transform([i])[0]: float(probs[i]) for i in range(len(probs))}
    
    return {"risk": risk, "probabilities": prob_dict}

@app.post("/predict/acceptance")
def route_predict_acceptance(body: PredictAcceptanceRequest):
    pred = predict_acceptance(body.earnings_per_km, body.avg_distance, body.avg_fare, body.supply_gap)
    avg_acc = CITY_AVG["driver_quote_acceptance_rate"]
    interpretation = f"{'High' if pred > avg_acc else 'Low'} — {'above' if pred > avg_acc else 'below'} city avg of {avg_acc:.1%}"
    
    return {"predicted_acceptance": pred, "interpretation": interpretation}

@app.post("/predict/cluster")
def route_predict_cluster(body: PredictClusterRequest):
    # Cluster features are defined in cluster_scaler/kmeans. 
    # Usually: driver_cancellation_rate, driver_quote_acceptance_rate, earnings_per_km, avg_distance
    X_raw = pd.DataFrame([body.model_dump()])
    X_scaled = cluster_scaler.transform(X_raw)
    cluster_idx = kmeans.predict(X_scaled)[0]
    
    # Map cluster index to label
    cluster_label = cluster_label_map.get(cluster_idx, f"Cluster {cluster_idx}")
    description = CLUSTER_DESCRIPTIONS.get(cluster_label, "Driver behavior segment.")
    
    similar_wards = df[df["cluster_label"] == cluster_label]["ward"].head(5).tolist()
    
    return {"cluster_label": cluster_label, "description": description, "similar_wards": similar_wards}

@app.get("/predict/shap/{ward_name}")
def get_shap_values(ward_name: str):
    row = get_ward_row(ward_name)
    
    # Risk SHAP
    X_risk = pd.DataFrame([{f: row[f] for f in risk_features}])
    shap_risk = risk_explainer(X_risk)
    label_idx = risk_clf.predict(X_risk)[0]
    
    risk_shap_list = []
    for i, f in enumerate(risk_features):
        val = shap_risk.values[0][i]
        impact = float(val[label_idx]) if isinstance(val, (list, np.ndarray)) else float(val)
        risk_shap_list.append({"feature": f, "value": float(X_risk[f].iloc[0]), "impact": impact})
    
    # Acceptance SHAP
    X_acc = pd.DataFrame([{f: row[f] for f in acceptance_features}])
    shap_acc = acceptance_explainer(X_acc)
    
    acc_shap_list = []
    for i, f in enumerate(acceptance_features):
        val = shap_acc.values[0][i]
        impact = float(val[0]) if isinstance(val, (list, np.ndarray)) else float(val)
        acc_shap_list.append({"feature": f, "value": float(X_acc[f].iloc[0]), "impact": impact})
    
    return {
        "risk_shap": sorted(risk_shap_list, key=lambda x: abs(x["impact"]), reverse=True),
        "acceptance_shap": sorted(acc_shap_list, key=lambda x: abs(x["impact"]), reverse=True)
    }

@app.get("/wards")
def list_wards():
    return df[["ward"]].assign(
        risk=df.apply(lambda r: predict_risk(r), axis=1)
    ).to_dict(orient="records")


@app.get("/ward/{ward_name}")
def get_ward(ward_name: str):
    row = get_ward_row(ward_name)
    acceptance = predict_acceptance(
        row["earnings_per_km"], row["avg_distance"], row["avg_fare"], row["supply_gap"]
    )
    risk = predict_risk(row)
    cluster = row.get("cluster_label", "Unknown")
    cluster_desc = CLUSTER_DESCRIPTIONS.get(cluster, "No description available.")
    actions = recommend_actions(row)

    return {
        "ward": row["ward"],
        "kpis": {
            "driver_quote_acceptance_rate": row["driver_quote_acceptance_rate"],
            "driver_cancellation_rate":     row["driver_cancellation_rate"],
            "earnings_per_km":              row["earnings_per_km"],
            "conversion_rate":              row["conversion_rate"],
            "revenue_leakage":              row["revenue_leakage"],
            "reliability_score":            row["reliability_score"],
            "supply_gap":                   row["supply_gap"],
            "avg_fare":                     row["avg_fare"],
            "avg_distance":                 row["avg_distance"],
        },
        "predicted_acceptance": acceptance,
        "risk": risk,
        "cluster": {"label": cluster, "description": cluster_desc},
        "actions": actions,
        "city_avg": {
            "driver_quote_acceptance_rate": CITY_AVG["driver_quote_acceptance_rate"],
            "driver_cancellation_rate":     CITY_AVG["driver_cancellation_rate"],
            "earnings_per_km":              CITY_AVG["earnings_per_km"],
            "conversion_rate":              CITY_AVG["conversion_rate"],
            "revenue_leakage":              CITY_AVG["revenue_leakage"],
        },
    }


class SimulateRequest(BaseModel):
    fare_adjustment: float   # multiplier, e.g. 1.1 = +10%
    distance_adjustment: float

@app.post("/ward/{ward_name}/simulate")
def simulate(ward_name: str, body: SimulateRequest):
    row = get_ward_row(ward_name)
    new_fare          = row["avg_fare"] * body.fare_adjustment
    new_distance      = row["avg_distance"] * body.distance_adjustment
    new_earnings_km   = (row["earnings_per_km"] * body.fare_adjustment)
    current           = predict_acceptance(row["earnings_per_km"], row["avg_distance"], row["avg_fare"], row["supply_gap"])
    simulated         = predict_acceptance(new_earnings_km, new_distance, new_fare, row["supply_gap"])
    return {
        "current_acceptance":   current,
        "simulated_acceptance": simulated,
        "delta":                round(simulated - current, 4),
        "new_fare":             round(new_fare, 2),
        "new_distance":         round(new_distance, 2),
    }


@app.get("/ward/{ward_name}/insight")
async def stream_insight(ward_name: str):
    row = get_ward_row(ward_name)
    risk    = predict_risk(row)
    cluster = row.get("cluster_label", "Unknown")
    actions = recommend_actions(row)

    prompt = f"""Ward: {row['ward']}
Risk: {risk} | Cluster: {cluster}
Acceptance rate: {row['driver_quote_acceptance_rate']:.1%}
Driver cancellation: {row['driver_cancellation_rate']:.1%}
Earnings/km: ₹{row['earnings_per_km']:.2f}
Revenue leakage: ₹{row['revenue_leakage']:,.0f}
Supply gap: {row['supply_gap']:,.0f}
Avg distance: {row['avg_distance']:.1f}km | Avg fare: ₹{row['avg_fare']:.0f}
Recommended actions: {', '.join(actions)}

In 3-4 sentences, explain what is happening in this ward and why, in plain business English. Be specific and direct."""

    api_key = os.getenv("OPENROUTER_API", "")

    async def generate():
        in_think = False
        buffer = ""
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream(
                "POST",
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "google/gemini-2.0-flash-lite-preview-02-05:free",
                    "max_tokens": 300,
                    "stream": True,
                    "messages": [
                        {"role": "system", "content": "You are a data analyst at a ride-hailing startup. Give sharp, specific insights. No bullet points. Do not use <think> tags or show reasoning. Answer directly."},
                        {"role": "user", "content": prompt},
                    ],
                },
            ) as response:
                if response.status_code != 200:
                    try:
                        err_text = await response.aread()
                        err_json = json.loads(err_text)
                        msg = err_json.get("error", {}).get("message", "API Error")
                        yield f"Service unavailable: {msg}. Please try again later."
                    except Exception:
                        yield f"HTTP Error {response.status_code}: Insight generation failed."
                    return
                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:]
                    if payload.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(payload)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "")
                        if not content:
                            continue
                        # Filter out <think>...</think> reasoning blocks
                        buffer += content
                        while True:
                            if in_think:
                                end_idx = buffer.find("</think>")
                                if end_idx == -1:
                                    buffer = ""
                                    break
                                buffer = buffer[end_idx + 8:]
                                in_think = False
                            else:
                                start_idx = buffer.find("<think>")
                                if start_idx == -1:
                                    if buffer:
                                        yield buffer
                                        buffer = ""
                                    break
                                if start_idx > 0:
                                    yield buffer[:start_idx]
                                buffer = buffer[start_idx + 7:]
                                in_think = True
                    except json.JSONDecodeError:
                        continue

    return StreamingResponse(generate(), media_type="text/plain")


@app.get("/rankings")
def get_rankings():
    tmp = df.copy()
    tmp["predicted_acceptance"] = tmp.apply(
        lambda r: predict_acceptance(r["earnings_per_km"], r["avg_distance"], r["avg_fare"], r["supply_gap"]), axis=1
    )
    top_leakage    = tmp.nlargest(5, "revenue_leakage")[["ward", "revenue_leakage", "predicted_acceptance"]].to_dict(orient="records")
    # Opportunity = high supply_gap but moderate acceptance (fixable)
    opportunity    = tmp[tmp["driver_quote_acceptance_rate"] > 0.35].nlargest(5, "supply_gap")[["ward", "supply_gap", "predicted_acceptance"]].to_dict(orient="records")
    return {"top_problem_wards": top_leakage, "top_opportunity_wards": opportunity}


@app.get("/city-average")
def city_average():
    return {k: round(v, 4) for k, v in CITY_AVG.items() if k != "ward"}
