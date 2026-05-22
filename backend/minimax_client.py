import os
import requests
import json

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
MINIMAX_MODEL = "minimax/minimax-m2.5:free"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

def call_minimax(messages, temperature=0.3, max_tokens=2000, response_format=None):
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY no configurada en .env")
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }
    body = {
        "model": MINIMAX_MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens
    }
    if response_format:
        body["response_format"] = response_format
    response = requests.post(OPENROUTER_URL, headers=headers, json=body, timeout=120)
    if response.status_code != 200:
        raise Exception(f"MiniMax API error {response.status_code}: {response.text}")
    data = response.json()
    return data["choices"][0]["message"]["content"]
