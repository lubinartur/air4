import requests

# Тест загрузки CSV
with open("../s4.csv", "rb") as f:
    response = requests.post(
        "http://localhost:8000/api/upload",
        files={"file": ("s4.csv", f, "text/csv")},
    )
    print(response.json())
