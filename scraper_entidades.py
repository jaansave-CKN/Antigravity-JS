import requests
from bs4 import BeautifulSoup
import time
import re
from datetime import datetime
from database import guardar_entidad, guardar_scraped_result, log_scraping, log_ejecucion, init_db
from realEntidades_scraper import ENTIDADES_RADAR

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

TIMEOUT = 15

def safe_request(url: str, timeout: int = TIMEOUT) -> tuple[str | None, str]:
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout, allow_redirects=True)
        r.raise_for_status()
        return r.text, None
    except Exception as e:
        return None, str(e)[:200]

def parse_fecha(texto: str) -> str | None:
    patterns = [
        r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
        r"(\d{4}[/-]\d{1,2}[/-]\d{1,2})",
        r"(\d{1,2}\s+[A-Za-z]+\s+\d{4})",
        r"([A-Za-z]+\s+\d{1,2},?\s+\d{4})",
    ]
    for p in patterns:
        m = re.search(p, texto)
        if m:
            return m.group(1)
    return None

def parse_monto(texto: str) -> tuple[float | None, str]:
    usd = re.search(r"USD\s*([\d,.+\-]+)", texto, re.I)
    eur = re.search(r"EUR\s*([\d,.+\-]+)", texto, re.I)
    cop = re.search(r"COP\s*([\d,.+\-]+)", texto, re.I)
    chf = re.search(r"CHF\s*([\d,.+\-]+)", texto, re.I)
    num = re.search(r"\$?\s*([\d,]+\.?\d*)M?", texto)
    if usd:
        val = float(usd.group(1).replace(",", ""))
        return val, "USD"
    if eur:
        val = float(eur.group(1).replace(",", ""))
        return val, "EUR"
    if cop:
        val = float(cop.group(1).replace(",", ""))
        return val * 1_000_000, "COP"
    if chf:
        val = float(chf.group(1).replace(",", ""))
        return val, "CHF"
    if num:
        val = float(num.group(1).replace(",", ""))
        if val < 1000:
            val *= 1_000_000
        return val, "USD"
    return None, "USD"

def scrape_entidad(entidad: dict) -> dict:
    url = entidad.get("url_convocatorias") or entidad.get("sitio_web")
    if not url:
        return {"entidad_id": entidad["id"], "url": "", "titulo": "", "monto": "", "fecha_cierre": "", "estado": "", "estado_detectado": "sin_url", "success": False, "error": "No URL"}

    start = time.time()
    html, err = safe_request(url)
    duracion = int((time.time() - start) * 1000)

    if err:
        log_scraping(entidad["id"], url, "error", duracion, err)
        return {
            "entidad_id": entidad["id"], "url": url,
            "titulo": "", "monto": "", "fecha_cierre": "", "estado": "error",
            "estado_detectado": "error", "success": False, "error": err
        }

    soup = BeautifulSoup(html, "html.parser")
    texto_pagina = soup.get_text(separator=" ", strip=True)

    resultados = []

    # Buscar tarjetas/items de convocatorias
    items = soup.find_all(["div", "article", "li", "tr"], class_=re.compile(
        r"call|grant|convocatoria|opportunity|funding|project|tender|proposal|item|row",
        re.I
    ))
    if not items:
        items = soup.find_all(["a", "div"], href=re.compile(r"convocatoria|call|grant|proposal|funding", re.I))

    for item in items[:30]:
        titulo_raw = ""
        titulo_el = item.find_next(["h1","h2","h3","h4","a","span","p","td","th"],
            class_=re.compile(r"title|name|grant|call|convocatoria", re.I))
        if not titulo_el:
            titulo_el = item.find_next(["a","span","p","div"], string=re.compile(r"convocatoria|call|grant|proposal", re.I))
        if titulo_el:
            titulo_raw = titulo_el.get_text(strip=True)

        monto_raw = item.get_text(strip=True)
        monto_val, moneda = parse_monto(monto_raw)

        fecha_raw = item.get_text(strip=True)
        fecha_cierre = parse_fecha(fecha_raw)

        # Detectar estado
        texto_lower = item.get_text(strip=True).lower()
        if any(k in texto_lower for k in ["cerrada", "closed", "finalizada", "finalizado", "caducada"]):
            estado = "cerrada"
        elif any(k in texto_lower for k in ["abierta", "open", "activa", "vigente", "convocatoria"]):
            estado = "abierta"
        elif any(k in texto_lower for k in ["próxima", "proximamente", "upcoming", "coming soon"]):
            estado = "proxima"
        else:
            estado = "abierta"

        if titulo_raw and len(titulo_raw) > 10:
            resultados.append({
                "entidad_id": entidad["id"],
                "url": url,
                "titulo": titulo_raw[:300],
                "monto": f"{moneda} {monto_val}" if monto_val else "",
                "fecha_cierre": fecha_cierre or "",
                "estado": estado,
                "estado_detectado": f"scraped_{estado}",
                "contenido_html": str(item)[:5000],
                "success": True,
                "error": ""
            })

    if not resultados:
        resultados.append({
            "entidad_id": entidad["id"],
            "url": url,
            "titulo": f"Pagina verificada - {entidad['nombre']}",
            "monto": "",
            "fecha_cierre": "",
            "estado": "verificada",
            "estado_detectado": "pagina_ok_sin_items",
            "contenido_html": texto_pagina[:3000],
            "success": True,
            "error": ""
        })

    log_scraping(entidad["id"], url, "ok", duracion, f"{len(resultados)} resultados")

    for r in resultados:
        guardar_scraped_result(r)

    return resultados[0]

def scrape_all_entidades() -> dict:
    init_db()
    log_ejecucion("SCRAPER", "inicio", f"Iniciando scraping de {len(ENTIDADES_RADAR)} entidades")
    total = 0
    ok = 0
    errors = 0

    for ent in ENTIDADES_RADAR:
        guardar_entidad(ent)
        result = scrape_entidad(ent)
        total += 1
        if result.get("success"):
            ok += 1
        else:
            errors += 1
        time.sleep(1.5)

    log_ejecucion("SCRAPER", "fin", f"Scraping completado: {total} entidades, {ok} ok, {errors} errores")
    return {"total": total, "ok": ok, "errors": errors}

if __name__ == "__main__":
    init_db()
    r = scrape_all_entidades()
    print(f"Scraping finalizado: {r}")