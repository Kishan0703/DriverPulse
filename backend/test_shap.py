import sys
from main import app
from fastapi.testclient import TestClient

client = TestClient(app)
response = client.get("/predict/shap/Adugodi")
print(response.status_code)
print(response.json())
