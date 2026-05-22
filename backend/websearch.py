import os
import requests
import json
import time
from typing import Optional, Dict, Any, List

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
MINIMAX_MODEL = "minimax/minimax-m2.5:free"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

def websearch(query: str, numResults: int = 10, livecrawl: str = "fallback", type: str = "auto") -> Dict[str, Any]:
    """
    Realiza búsqueda web usando múltiples métodos.
    
    Args:
        query: Query de búsqueda
        numResults: Número de resultados
        livecrawl: Modo de crawl (preferred/fallback)
        type: Tipo de búsqueda (auto/fast/deep)
    
    Returns:
        Dict con 'results' contendo lista de {title, url, content}
    """
    
    print(f"[WebSearch] Query: {query}")
    print(f"[WebSearch] Mode: {type}, Live: {livecrawl}")
    
    # Método 1: Usar MiniMax M2.5 para búsqueda
    if OPENROUTER_API_KEY:
        try:
            result = _minimax_web_search(query, numResults)
            if result:
                return result
        except Exception as e:
            print(f"[WebSearch] MiniMax failed: {e}")
    
    # Método 2: DuckDuckGo HTML (sin API key)
    try:
        result = _duckduckgo_search(query, numResults)
        if result:
            return result
    except Exception as e:
        print(f"[WebSearch] DuckDuckGo failed: {e}")
    
    # Método 3: Fallback - buscar en base de datos existente
    print("[WebSearch] Usando datos existentes como fallback")
    return _fallback_from_db(query, numResults)


def _minimax_web_search(query: str, numResults: int) -> Optional[Dict[str, Any]]:
    """Usa MiniMax M2.5 para hacer búsqueda"""
    if not OPENROUTER_API_KEY:
        return None
        
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json"
    }
    
    system_prompt = f"""Eres un asistente de búsqueda web. Dado el query: "{query}"
Busca y proporciona información sobre convocatorias de fondos, grants, ayudas económicas o financiamiento internacional para Colombia y América Latina.

Proporciona {numResults} resultados relevantes en formato JSON con:
- title: título de la convocatoria
- url: enlace a la fuente
- content: descripción breve (máx 200 caracteres)

Si no hay resultados reales, devuelve un array vacío."""

    payload = {
        "model": MINIMAX_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Busca: {query}"}
        ],
        "temperature": 0.3,
        "max_tokens": 2000
    }
    
    try:
        response = requests.post(
            OPENROUTER_URL,
            headers=headers,
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            
            try:
                results = json.loads(content)
                return {"results": results}
            except:
                return {"results": [{"title": query, "url": "", "content": content[:300]}]}
    except Exception as e:
        print(f"[MiniMax error] {e}")
    
    return None


def _duckduckgo_search(query: str, numResults: int) -> Optional[Dict[str, Any]]:
    """Búsqueda usando DuckDuckGo (sin API key)"""
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
        
        # ddg API no requiere API key
        url = f"https://html.duckduckgo.com/html/?q={requests.utils.quote(query)}"
        
        response = requests.get(url, headers=headers, timeout=15)
        
        if response.status_code == 200:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(response.text, 'html.parser')
            
            results = []
            for result in soup.select('.result')[:numResults]:
                title_elem = result.select_one('.result__a')
                snippet_elem = result.select_one('.result__snippet')
                link = title_elem.get('href', '') if title_elem else ''
                
                if title_elem:
                    results.append({
                        "title": title_elem.get_text(strip=True),
                        "url": link,
                        "content": snippet_elem.get_text(strip=True) if snippet_elem else ''
                    })
            
            if results:
                return {"results": results}
    except Exception as e:
        print(f"[DuckDuckGo error] {e}")
    
    return None


def _fallback_from_db(query: str, numResults: int) -> Dict[str, Any]:
    """Fallback: usa convocatorias existentes de la base de datos"""
    try:
        from database import get_convocatorias
        todas = get_convocatorias()
        
        # Filtrar por query
        query_lower = query.lower()
        coincidencias = [
            {
                "title": c.get("titulo", ""),
                "url": c.get("url", ""),
                "content": c.get("descripcion", "")[:200]
            }
            for c in todas
            if query_lower in c.get("titulo", "").lower() or 
               query_lower in c.get("donante", "").lower() or
               query_lower in c.get("descripcion", "").lower()
        ][:numResults]
        
        return {"results": coincidencias}
    except Exception as e:
        print(f"[Fallback DB error] {e}")
        return {"results": []}


if __name__ == "__main__":
    # Test
    result = websearch("convocatorias Colombia 2026", 5)
    print(json.dumps(result, indent=2, ensure_ascii=False))