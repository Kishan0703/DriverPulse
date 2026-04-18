# 🚗 DriverPulse — Namma Yatri Ward-Level Insights

**DriverPulse** is an end-to-end data analytics and machine learning pipeline that analyzes ward-level ride data from Namma Yatri (Bengaluru). It uncovers business insights, quantifies driver reliability, and segments operational areas based on performance metrics.

## 📁 Repository Structure

```text
.
├── backend/
│   ├── data/
│   │   ├── namma_yatri_bengaluru_ward_wise_all_time_data.csv  # Raw data
│   │   └── cleaned.csv                                        # Cleaned + engineered data
│   ├── models/                                                # Saved ML models & artifacts
│   ├── analysis.ipynb                                         # Data Cleaning & EDA
│   ├── train.ipynb                                            # Model Training Pipeline
│   └── main.py                                                # FastAPI Server
├── frontend/
│   └── App.jsx                                                # React UI
└── README.md                                                  # Project Overview
```

## 🛠️ Pipeline Overview

### 1. Data Cleaning & Feature Engineering (`analysis.ipynb`)
- Parses Indian-style numbers (commas) and removes currency/percentage symbols formatting.
- Engineers **4 actionable business metrics**:
  - `earnings_per_km`: A measure of driver revenue efficiency.
  - `supply_gap`: Unmet demand (Searches missing Quotes).
  - `revenue_leakage`: Potential revenue lost (Searches vs Completed Trips).
  - `reliability_score`: A composite score derived from low cancellation and high quote acceptance.
- Conducts comprehensive **EDA** with histograms, correlation matrices, outlier detection (IQR), and multivariable scatter plots charting behavior vs earnings.

### 2. Machine Learning Models (`train.ipynb`)
Three models are trained and persisted in the `models/` directory for downstream use.

1. **Ward Risk Classifier (Random Forest)**
   - Automatically labels wards into `High`, `Medium`, and `Low` risk using percentile thresholds computed from composite cancellation & conversion rates.
   - Evaluated using Accuracy, F1 (macro), and Confusion Matrices.

2. **Acceptance Predictor (RF Regressor)**
   - Predicts the `driver_quote_acceptance_rate` dynamically given metrics like `supply_gap`, `avg_fare`, and `avg_distance`.

3. **Driver Behavior Clustering (KMeans, k=3)**
   - Segments wards into exactly **3 distinct operational zones** based on driver reliability and efficiency.
   - Features used: `driver_cancellation_rate`, `driver_quote_acceptance_rate`, `earnings_per_km`, and `avg_distance`.
   - Produces business-ready labels mapping wards to profiles: *⭐ Reliable Performers*, *⚠️ High-Risk Zones*, and *🔄 Average Balanced*.

*(Note: Model 1 and Model 2 also incorporate **SHAP** explainer visualizations to outline feature importance).*

## 🚀 Setup

Run the following commands to install dependencies using `uv` and replicate the environment locally:

```bash
cd backend
uv sync
```

## 🖥️ Running the Application

The project consists of a FastAPI backend and a React/Vite frontend. 

### 1. Setup Environment
Create a `.env` file in the `backend/` directory and add your OpenRouter API key for the live LLM insights (which streaming uses the `qwen/qwen3-coder:free` model):
```env
OPENROUTER_API=sk-or-v1-...
```

### 2. Start the Backend (FastAPI)
Run the following command to start the backend API server on port `8000`:
```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```

### 3. Start the Frontend (react/vite)
Open a new terminal and run the frontend development server (typically on port `5173`):
```bash
cd frontend
npm install
npm run dev
```
