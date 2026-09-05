"""
agents/pdf_extractor.py
========================
Lectura de PDF de convocatorias (Ley 3 del pipeline de Radar):
    markitdown -> indexacion regex -> extractor LLM solo sobre objetivo validado

Este modulo cubre las dos primeras fases. Convierte el PDF a texto plano una
sola vez (sin LLM) y filtra por regex antes de que cualquier fragmento llegue
a un modelo de lenguaje -- nunca se pasa el documento completo a un LLM.
"""
import logging
import re
from io import BytesIO
from typing import Optional

import requests
from markitdown import MarkItDown

logger = logging.getLogger("pdf_extractor")

_md = MarkItDown()

MAX_FRAGMENTO_CHARS = 4000

PATRONES_RELEVANTES = [
    r"[^.\n]*\b(monto|presupuesto|financiamiento|USD|COP|EUR|\$)\b[^.\n]*\.",
    r"[^.\n]*\b(fecha\s+l[ií]mite|plazo|cierre|deadline|vence)\b[^.\n]*\.",
    r"[^.\n]*\b(requisitos?|elegibilidad|eligib\w*)\b[^.\n]*\.",
    r"[^.\n]*\b(sector(es)?|[aá]rea(s)?\s+tem[aá]tica)\b[^.\n]*\.",
]


def pdf_a_texto(fuente: bytes) -> str:
    """Convierte el contenido binario de un PDF a texto Markdown via markitdown."""
    resultado = _md.convert_stream(BytesIO(fuente), file_extension=".pdf")
    return resultado.text_content or ""


def descargar_pdf(url: str, session: Optional[requests.Session] = None, timeout: int = 20) -> Optional[bytes]:
    sess = session or requests
    try:
        resp = sess.get(url, timeout=timeout)
        content_type = resp.headers.get("Content-Type", "")
        if resp.status_code != 200:
            return None
        if "pdf" not in content_type.lower() and not url.lower().endswith(".pdf"):
            return None
        return resp.content
    except Exception as e:
        logger.warning(f"No se pudo descargar PDF ({url}): {e}")
        return None


def indexar_fragmentos(texto: str) -> str:
    """Filtra el texto extraido a solo las oraciones relevantes (monto, plazo,
    requisitos, sector) via regex. Esto es lo unico que debe llegar a un LLM."""
    if not texto:
        return ""

    encontrados = []
    for patron in PATRONES_RELEVANTES:
        for match in re.finditer(patron, texto, flags=re.IGNORECASE):
            fragmento = match.group(0).strip()
            if fragmento and fragmento not in encontrados:
                encontrados.append(fragmento)

    fragmento_final = " ".join(encontrados)
    return fragmento_final[:MAX_FRAGMENTO_CHARS]


def extraer_resumen_pdf(url: str, session: Optional[requests.Session] = None) -> str:
    """Pipeline completo: descarga -> markitdown -> indexacion regex.
    Devuelve el fragmento ya filtrado, listo para un extractor LLM externo.
    Nunca devuelve el documento completo."""
    contenido = descargar_pdf(url, session=session)
    if not contenido:
        return ""

    try:
        texto = pdf_a_texto(contenido)
    except Exception as e:
        logger.warning(f"markitdown no pudo procesar el PDF ({url}): {e}")
        return ""

    return indexar_fragmentos(texto)
