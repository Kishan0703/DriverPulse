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

load_dotenv()

app = FastAPI(title="DriverIQ API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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

CITY_AVG = df.drop(columns=["ward", "cluster_label"], errors="ignore").mean().to_dict()

CLUSTER_DESCRIPTIONS = {
    "⭐ Reliable Performers": "High acceptance, low cancellations. Retain these drivers with loyalty incentives.",
    "⚠️ High-Risk Zones":     "Low acceptance and high cancellations. Needs urgent fare floor or supply push.",
    "🔄 Average Balanced":    "Moderate performers. Monitor and improve incentive structure.",
}

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
    X = pd.DataFrame([{
        "driver_cancellation_rate":    row["driver_cancellation_rate"],
        "driver_quote_acceptance_rate": row["driver_quote_acceptance_rate"],
        "conversion_rate":             row["conversion_rate"],
        "booking_cancellation_rate":   row["booking_cancellation_rate"],
        "user_cancellation_rate":      row["user_cancellation_rate"],
        "earnings_per_km":             row["earnings_per_km"],
        "avg_distance":                row["avg_distance"],
        "avg_fare":                    row["avg_fare"],
        "supply_gap":                  row["supply_gap"],
        "reliability_score":           row["reliability_score"],
    }])
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
                    "model": "qwen/qwen3-coder:free",
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
