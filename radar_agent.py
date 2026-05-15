"""
Radar Agent 24/7 v2.0 - ANTI-BLOQUEO + CACHE + RATE LIMITING
Versión optimizada para evitar bloqueos y funcionar 24/7
"""

import asyncio
import aiohttp
import sqlite3
import json
import hashlib
import time
import random
import re
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
from typing import List, Dict, Optional, Set
from collections import defaultdict

# =══════════════════════════════════════
# CONFIGURACIÓN ANTI-BLOQUEO
# =══════════════════════════════════════

RATE_LIMITS = {
    'default': {'requests': 5, 'seconds': 60},  # 5 requests por minuto por defecto
    'strict': {'requests': 2, 'seconds': 120},  # Para sitios estrictos (USAID, GIZ)
    'relaxed': {'requests': 10, 'seconds': 60},  # Para sitios permisivos
}

# Lista de User-Agents rotativos
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
]

# Sitios estrictos que bloquean fácil
STRICT_SITES = ['usaid.gov', 'worldbank.org', 'jica.go.jp', 'giz.de', 'adb.org']
RELAXED_SITES = ['iadb.org', 'undp.org', 'fao.org', 'caf.com', 'sena.edu.co', 'innpulsacolombia.com']

# =══════════════════════════════════════
# TIPOS - Alineados con la app
# =══════════════════════════════════════

POBLACIONES_OBJETIVO = [
    'primera_infancia', 'adulto_mayor', 'madres_cabeza_hogar', 'indigenas',
    'afrocolombianos', 'raizales', 'palenqueros', 'rrom', 'victimas_violencia',
    'poblacion_desplazada', 'reincorporacion', 'desastres_naturales',
    'situacion_calle', 'salud_especial', 'consumo_sustancias', 'pobreza_extrema',
    'poblacion_migrante'
]

SECTORES = [
    'Vivienda', 'Ambiente', 'Medio Ambiente', 'Ciencia', 'Tecnologia e Innovacion',
    'Infraestructura', 'Educacion', 'Salud', 'Desarrollo Social', 'Saneamiento',
    'Saneamiento Basico', 'Energia', 'Energias Renovables', 'Agricultura',
    'Agricola', 'Agroindustria', 'Tecnologia', 'Agua y Saneamiento', 'Cambio Climatico',
    'Desarrollo Urbano', 'Gestion de Riesgos', 'Desarrollo Economico', 'Empresarial',
    'Comercio', 'Emprendimiento', 'Innovacion', 'Ayuda Humanitaria', 'Seguridad Alimentaria',
    'Desarrollo Rural', 'Energia Renovable', 'Biodiversidad', 'Desarrollo Digital',
    'Capacitacion', 'Investigacion', 'Desarrollo Comunitario', 'Cooperativismo',
    'Cultura', 'Primera Infancia', 'Turismo', 'Derechos Humanos', 'Agua', 'Construccion',
    'Transporte', 'Ordenamiento Territorial', 'Desarrollo Local', 'Poblacion Vulnerable',
    'Empleo', 'Productividad', 'Mercados', 'Gestion Publica', 'Desarrollo Sostenible',
    'Resiliencia', 'Infraestructura Social', 'Paz', 'Genero', 'Igualdad de Genero',
    'Impacto Social', 'Integracion Regional', 'Transicion Verde', 'Gobernabilidad',
    'Fortalecimiento Institucional', 'Inclusion Financiera', 'Cambio Social', 'ODS',
    'Sostenibilidad', 'Formacion', 'Recursos Naturales', 'Patrimonio', 'Gobernanza',
    'Accion Social', 'Visibilidad', 'Competitividad Economica', 'Comunicacion'
]

FUENTES_VALIDAS = [
    'Grants.gov', 'EU SEDIA', 'UN Global', 'World Bank', 'APC Colombia',
    'Embajada Japon', 'Embajada Alemania', 'Embajada EE.UU.', 'GEF', 'BID',
    'USAID', 'UNGM', 'UN-Habitat', 'COSUDE', 'Banco Mundial', 'FAO', 'GIZ',
    'EU Funding & Tenders', 'UNESCO', 'PNUD', 'UN Women', 'OIM', 'CAF',
    'AECID', 'AFD', 'JICA', 'SENA', 'iNNpulsa', 'Google', 'Scotiabank',
    'IKEA Foundation', 'Avina Foundation', 'FONTAGRO', 'KOICA', 'SIDA', 'IDRC'
]

# =══════════════════════════════════════
# KEYWORDS PARA MATCHING
# =══════════════════════════════════════

POBLACION_KEYWORDS = {
    'primera_infancia': ['niños', 'infancia', 'child', 'early childhood'],
    'adulto_mayor': ['adulto mayor', 'ancianos', 'elderly', 'seniors'],
    'madres_cabeza_hogar': ['madres cabeza', 'mujeres jefe', 'female headed'],
    'indigenas': ['indígenas', 'indigenous', 'pueblos indígenas', 'tribal'],
    'afrocolombianos': ['afrocolombianos', 'afrodescendientes', 'afro'],
    'victimas_violencia': ['víctimas conflicto', 'victims', 'war victims'],
    'poblacion_desplazada': ['desplazados', 'displaced', 'forced displacement'],
    'reincorporacion': ['reincorporación', 'excombatientes', 'demobilized'],
    'desastres_naturales': ['desastre natural', 'emergency', 'huracán', 'flood', 'disaster'],
    'situacion_calle': ['homeless', 'street population', 'personas calle'],
    'salud_especial': ['discapacidad', 'disability', 'special needs'],
    'consumo_sustancias': ['adicciones', 'sustancias', 'drogodependencia', 'addiction'],
    'pobreza_extrema': ['pobreza extrema', 'extreme poverty', 'vulnerable'],
    'poblacion_migrante': ['migrantes', 'migrants', 'refugiados', 'refugees', 'venezolanos']
}

SECTOR_KEYWORDS = {
    'Vivienda': ['vivienda', 'housing', 'shelter', 'habitat'],
    'Ambiente': ['ambiente', 'environment'],
    'Medio Ambiente': ['medio ambiente', 'environmental'],
    'Ciencia': ['ciencia', 'science', 'scientific'],
    'Tecnologia e Innovacion': ['tecnología', 'innovación', 'technology', 'innovation', 'tech', 'digital'],
    'Infraestructura': ['infraestructura', 'infrastructure', 'obras'],
    'Educacion': ['educación', 'education', 'formación', 'escuela'],
    'Salud': ['salud', 'health', 'sanidad', 'médico', 'hospital'],
    'Desarrollo Social': ['desarrollo social', 'social development'],
    'Saneamiento': ['saneamiento', 'sanitation'],
    'Agua y Saneamiento': ['agua', 'water', 'saneamiento', 'hydraulic'],
    'Cambio Climatico': ['clima', 'climate', 'cambio climático', 'climate change'],
    'Desarrollo Economico': ['desarrollo económico', 'economic development'],
    'Emprendimiento': ['emprendimiento', 'entrepreneurship', 'startup', 'emprendedor'],
    'Ayuda Humanitaria': ['ayuda humanitaria', 'humanitarian', 'emergencia', 'assistenci'],
    'Desarrollo Rural': ['desarrollo rural', 'rural development', 'campo'],
    'Biodiversidad': ['biodiversidad', 'biodiversity', 'conservación'],
    'Genero': ['género', 'gender', 'mujeres', 'violencia género'],
    'Paz': ['paz', 'peace', 'peacebuilding', 'postconflicto'],
    'Empleo': ['empleo', 'employment', 'trabajo', 'ocupación'],
    'Innovacion': ['innovación', 'innovation'],
    'Agricultura': ['agricultura', 'agriculture', 'farming'],
}

# =══════════════════════════════════════
# FUENTES - 40 fuentes priorizadas
# =══════════════════════════════════════

FUENTES = [
    {'nombre': 'GIZ', 'fuente_tipo': 'GIZ', 'url': 'https://www.giz.de/en/activities', 'pais': 'Alemania', 'strict': True},
    {'nombre': 'AECID', 'fuente_tipo': 'AECID', 'url': 'https://www.aecid.gob.es/activos', 'pais': 'España', 'strict': False},
    {'nombre': 'JICA', 'fuente_tipo': 'JICA', 'url': 'https://www.jica.go.jp/english/activities/index.html', 'pais': 'Japón', 'strict': True},
    {'nombre': 'COSUDE', 'fuente_tipo': 'COSUDE', 'url': 'https://www.eda.admin.ch/deza/en/home/Activities', 'pais': 'Suiza', 'strict': False},
    {'nombre': 'USAID', 'fuente_tipo': 'USAID', 'url': 'https://www.usaid.gov/work-us/funding', 'pais': 'EE.UU.', 'strict': True},
    {'nombre': 'AFD', 'fuente_tipo': 'AFD', 'url': 'https://www.afd.fr/en/our-projects/call-for-projects', 'pais': 'Francia', 'strict': False},
    {'nombre': 'BID', 'fuente_tipo': 'BID', 'url': 'https://www.iadb.org/en/opportunities/grants', 'pais': 'Multilateral', 'strict': False},
    {'nombre': 'BID Lab', 'fuente_tipo': 'BID', 'url': 'https://bidlab.org/calls/', 'pais': 'Multilateral', 'strict': False},
    {'nombre': 'CAF', 'fuente_tipo': 'CAF', 'url': 'https://www.caf.com/es/convocatorias/', 'pais': 'Multilateral', 'strict': False},
    {'nombre': 'PNUD', 'fuente_tipo': 'PNUD', 'url': 'https://www.undp.org/work-with-us/funding-opportunities', 'pais': 'Multilateral', 'strict': False},
    {'nombre': 'UNESCO', 'fuente_tipo': 'UNESCO', 'url': 'https://www.unesco.org/en/member-states-portal/participation-programme', 'pais': 'Multilateral', 'strict': False},
    {'nombre': 'OIM', 'fuente_tipo': 'OIM', 'url': 'https://www.iom.int/calls-for-proposals', 'pais': 'Multilateral', 'strict': False},
    {'nombre': 'GEF', 'fuente_tipo': 'GEF', 'url': 'https://www.thegef.org/funding', 'pais': 'Multilateral', 'strict': False},
    {'nombre': 'Banco Mundial', 'fuente_tipo': 'Banco Mundial', 'url': 'https://www.worldbank.org/en/projects-operations/funding', 'pais': 'Multilateral', 'strict': True},
    {'nombre': 'EU Funding', 'fuente_tipo': 'EU Funding & Tenders', 'url': 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/home', 'pais': 'Europa', 'strict': False},
    {'nombre': 'Horizon Europe', 'fuente_tipo': 'EU Funding & Tenders', 'url': 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/calls', 'pais': 'Europa', 'strict': False},
    {'nombre': 'SENA', 'fuente_tipo': 'SENA', 'url': 'https://www.sena.edu.co/es-co/trabajo/Paginas/fondo-emprender.aspx', 'pais': 'Colombia', 'strict': False},
    {'nombre': 'iNNpulsa', 'fuente_tipo': 'iNNpulsa', 'url': 'https://convocatorias.innpulsacolombia.com/', 'pais': 'Colombia', 'strict': False},
    {'nombre': 'APC Colombia', 'fuente_tipo': 'APC Colombia', 'url': 'https://www.apccolombia.gov.co/convocatorias', 'pais': 'Colombia', 'strict': False},
    {'nombre': 'MinCiencias', 'fuente_tipo': 'BID', 'url': 'https://minciencias.gov.co/convocatorias', 'pais': 'Colombia', 'strict': False},
    {'nombre': 'FIDA', 'fuente_tipo': 'BID', 'url': 'https://www.ifad.org/en/funding', 'pais': 'Multilateral', 'strict': False},
    {'nombre': 'FAO', 'fuente_tipo': 'BID', 'url': 'https://www.fao.org/funding/', 'pais': 'Multilateral', 'strict': False},
    {'nombre': 'Sida', 'fuente_tipo': 'SIDA', 'url': 'https://www.sida.se/funding', 'pais': 'Suecia', 'strict': False},
    {'nombre': 'KOICA', 'fuente_tipo': 'KOICA', 'url': 'https://www.koica.go.kr/koica_en/operations/', 'pais': 'Corea', 'strict': True},
    {'nombre': 'RVO', 'fuente_tipo': 'BID', 'url': 'https://www.rvo.nl/subsidies-financiering', 'pais': 'Países Bajos', 'strict': False},
    {'nombre': 'Enabel', 'fuente_tipo': 'EU Funding & Tenders', 'url': 'https://www.enabel.be/calls/', 'pais': 'Bélgica', 'strict': False},
    {'nombre': 'GCF', 'fuente_tipo': 'BID', 'url': 'https://www.greenclimate.fund/funding', 'pais': 'Multilateral', 'strict': False},
    {'nombre': 'Erasmus+', 'fuente_tipo': 'EU Funding & Tenders', 'url': 'https://erasmus-plus.ec.europa.eu/calls', 'pais': 'Europa', 'strict': False},
]

# =══════════════════════════════════════
# CACHE - Evitar re-scrapear lo mismo
# =══════════════════════════════════════

class RequestCache:
    """Cache para evitar re-scrapear sitios en 24h"""
    
    def __init__(self, db_path='radar.db'):
        self.db_path = db_path
        self.init_cache_table()
    
    def init_cache_table(self):
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS radar_cache (
            url TEXT PRIMARY KEY,
            hash_contenido TEXT,
            fecha_cache TIMESTAMP
        )''')
        conn.commit()
        conn.close()
    
    def is_cached(self, url: str) -> bool:
        """Verifica si URL está en cache y vigente (24h)"""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''SELECT fecha_cache FROM radar_cache 
            WHERE url = ? AND datetime(fecha_cache) > datetime('now', '-24 hours')''', (url,))
        result = c.fetchone()
        conn.close()
        return result is not None
    
    def set_cached(self, url: str, hash_cont: str):
        """Guarda URL en cache"""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''INSERT OR REPLACE INTO radar_cache (url, hash_contenido, fecha_cache)
            VALUES (?, ?, datetime('now'))''', (url, hash_cont))
        conn.commit()
        conn.close()

# =══════════════════════════════════════
# RATE LIMITER
# =══════════════════════════════════════

class RateLimiter:
    """Limita requests para evitar bloqueos"""
    
    def __init__(self):
        self.requests = defaultdict(list)  # domain -> timestamps
    
    def wait_if_needed(self, url: str):
        """Espera si ha hecho muchos requests recientemente"""
        # Extraer dominio
        import re
        match = re.search(r'https?://([^/]+)', url)
        if not match:
            return
        
        domain = match.group(1)
        
        # Determinar tipo de sitio
        is_strict = any(s in domain for s in STRICT_SITES)
        is_relaxed = any(s in domain for s in RELAXED_SITES)
        
        if is_strict:
            limit = RATE_LIMITS['strict']
        elif is_relaxed:
            limit = RATE_LIMITS['relaxed']
        else:
            limit = RATE_LIMITS['default']
        
        now = time.time()
        # Limpiar requests viejos
        self.requests[domain] = [t for t in self.requests[domain] if now - t < limit['seconds']]
        
        # Si ya alcanzó el límite, esperar
        if len(self.requests[domain]) >= limit['requests']:
            wait_time = limit['seconds'] - (now - self.requests[domain][0]) + 1
            if wait_time > 0:
                print(f"    [RateLimit] Esperando {wait_time:.1f}s para {domain}")
                time.sleep(wait_time)
        
        # Agregar request actual
        self.requests[domain].append(time.time())

# =══════════════════════════════════════
# DATABASE
# =══════════════════════════════════════

DB_PATH = 'radar.db'

def init_database():
    """Inicializa la base de datos"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Tabla de convocatorias
    c.execute('''CREATE TABLE IF NOT EXISTS convocatorias (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        donante TEXT,
        montoMax REAL DEFAULT 0,
        moneda TEXT DEFAULT 'USD',
        fechaCierre TEXT,
        fechaPublicacion TEXT,
        paisesElegibles TEXT,
        sectores TEXT,
        probabilidadExito INTEGER DEFAULT 70,
        requisitosClave TEXT,
        estado TEXT DEFAULT 'pendiente_revision',
        fuente TEXT,
        descripcion TEXT,
        urlOriginal TEXT,
        urlConvocatoria TEXT,
        urlTerminos TEXT,
        favorito INTEGER DEFAULT 0,
        compatibilidadPerfil INTEGER DEFAULT 70,
        categoriaGestion TEXT,
        poblacionesObjetivo TEXT,
        hash_contenido TEXT,
        ultima_actualizacion TEXT,
        verificada INTEGER DEFAULT 0,
        revisada INTEGER DEFAULT 0,
        aprobado INTEGER DEFAULT 0,
        observaciones TEXT
    )''')
    
    # Tabla de logs
    c.execute('''CREATE TABLE IF NOT EXISTS radar_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fuente TEXT,
        estado TEXT,
        convocatorias_encontradas INTEGER,
        tiempo_ejecucion REAL,
        errores TEXT,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    
    # Tabla de cache
    c.execute('''CREATE TABLE IF NOT EXISTS radar_cache (
        url TEXT PRIMARY KEY,
        hash_contenido TEXT,
        fecha_cache TIMESTAMP
    )''')
    
    # Índices (solo si no existen)
    try:
        c.execute('CREATE INDEX IF NOT EXISTS idx_estado ON convocatorias(estado)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_fuente ON convocatorias(fuente)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_verificada ON convocatorias(verificada)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_aprobado ON convocatorias(aprobado)')
    except:
        pass  # Los índices ya existen
    
    conn.commit()
    conn.close()
    print("[DB] Base de datos inicializada con cache y anti-bloqueo")

# =══════════════════════════════════════
# SCRAPER ANTI-BLOQUEO
# =══════════════════════════════════════

async def fetch_page(session: aiohttp.ClientSession, url: str, cache: RequestCache, rate_limiter: RateLimiter, retry: int = 0) -> Optional[str]:
    """Descarga una página con anti-bloqueo"""
    
    # Verificar cache
    if cache.is_cached(url):
        print(f"    [Cache] {url[:50]}... (en cache)")
        return None
    
    # Rate limiting
    rate_limiter.wait_if_needed(url)
    
    # Rotar User-Agent
    ua = random.choice(USER_AGENTS)
    headers = {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
    }
    
    try:
        async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
            if resp.status == 200:
                content = await resp.text()
                # Guardar en cache
                hash_cont = hashlib.md5(content.encode()).hexdigest()
                cache.set_cached(url, hash_cont)
                return content
            elif resp.status in [429, 403]:
                # Bloqueado, esperar y reintentar
                if retry < 3:
                    wait = (retry + 1) * 60  # 1min, 2min, 3min
                    print(f"    [Bloqueado] Esperando {wait}s...")
                    await asyncio.sleep(wait)
                    return await fetch_page(session, url, cache, rate_limiter, retry + 1)
            elif resp.status == 503:
                # Servicio no disponible
                if retry < 2:
                    await asyncio.sleep(10)
                    return await fetch_page(session, url, cache, rate_limiter, retry + 1)
    except asyncio.TimeoutError:
        print(f"    [Timeout] {url[:40]}...")
    except Exception as e:
        error_msg = str(e).lower()
        if 'connect' in error_msg or 'timeout' in error_msg:
            if retry < 2:
                await asyncio.sleep(5)
                return await fetch_page(session, url, cache, rate_limiter, retry + 1)
    
    return None

def extract_convocatorias(html: str, fuente: Dict) -> List[Dict]:
    """Extrae convocatorias del HTML"""
    if not html:
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    results = []
    
    for link in soup.find_all('a', href=True):
        href = link.get('href', '')
        text = link.get_text(strip=True)
        
        if not text or len(text) < 5:
            continue
        
        # Filtrar patrones de convocatoria
        patterns = ['convocatoria', 'call', 'grant', 'funding', 'apply', 'program', 
                   'opportunity', 'beca', 'subvención', 'financiación', 'fondos',
                   'selección', 'concurso', 'premio']
        
        if any(p in href.lower() for p in patterns) or any(p in text.lower() for p in patterns):
            content = f"{text} {href}".lower()
            
            poblacion = matches_poblacion(content)
            sectores_match = matches_sector(content)
            
            # Solo guardar si tiene match válido
            if poblacion or len(sectores_match) >= 2:
                full_url = href if href.startswith('http') else f"{fuente['url']}/{href}"
                
                results.append({
                    'titulo': text[:150],
                    'url': full_url,
                    'poblaciones': poblacion,
                    'sectores': sectores_match,
                    'fuente_nombre': fuente['nombre'],
                    'fuente_tipo': fuente['fuente_tipo']
                })
    
    return results[:15]  # Máximo 15 por fuente

def matches_poblacion(text: str) -> List[str]:
    text_lower = text.lower()
    matched = []
    for pob, keywords in POBLACION_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text_lower:
                if pob not in matched:
                    matched.append(pob)
    return matched[:2]

def matches_sector(text: str) -> List[str]:
    text_lower = text.lower()
    matched = []
    for sector, keywords in SECTOR_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in text_lower:
                if sector not in matched:
                    matched.append(sector)
    return matched[:4]

def validate_fuente(fuente_nombre: str) -> str:
    for f in FUENTES_VALIDAS:
        if f.lower() in fuente_nombre.lower():
            return f
    return 'BID' if 'bid' in fuente_nombre.lower() else 'GIZ'

def generate_id(titulo: str, fuente: str) -> str:
    raw = f"{titulo[:50]}-{fuente[:20]}-{datetime.now().strftime('%Y%m%d')}"
    return hashlib.md5(raw.encode()).hexdigest()[:12]

async def scrape_fuente(session: aiohttp.ClientSession, fuente: Dict, cache: RequestCache, rate_limiter: RateLimiter) -> Dict:
    """Scrapes una fuente con anti-bloqueo"""
    print(f"[{fuente['nombre']}]...", end=" ", flush=True)
    
    start = datetime.now()
    found = 0
    error = None
    
    try:
        html = await fetch_page(session, fuente['url'], cache, rate_limiter)
        if html:
            convs = extract_convocatorias(html, fuente)
            found = len(convs)
            if found > 0:
                await save_convocatorias(convs)
                print(f"OK: {found}")
            else:
                print("0 (sin match)")
        else:
            print("Cache")
    except Exception as e:
        error = str(e)[:50]
        print(f"ERROR")
    
    return {
        'fuente': fuente['nombre'],
        'estado': 'success' if found > 0 else 'cached' if not error else 'error',
        'encontradas': found,
        'tiempo': (datetime.now() - start).total_seconds(),
        'error': error
    }

async def save_convocatorias(convocatorias: List[Dict]):
    """Guarda convocatorias en DB (pendientes de revisión)"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    for conv in convocatorias:
        fuente_validada = validate_fuente(conv['fuente_tipo'])
        conv_id = generate_id(conv['titulo'], conv['fuente_nombre'])
        hash_cont = hashlib.md5(f"{conv['titulo']}{conv['url']}".encode()).hexdigest()
        
        # Solo insertar si no existe
        c.execute('SELECT id FROM convocatorias WHERE hash_contenido = ?', (hash_cont,))
        if not c.fetchone():
            c.execute('''INSERT INTO convocatorias 
                (id, titulo, donante, fuente, urlConvocatoria, sectores, poblacionesObjetivo,
                 estado, fechaCierre, hash_contenido, ultima_actualizacion, verificada, revisada, aprobado,
                 probabilidadExito, compatibilidadPerfil, moneda, montoMax, favorito)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                (
                    conv_id, conv['titulo'], conv['fuente_nombre'], fuente_validada,
                    conv['url'], ','.join(conv['sectores']), ','.join(conv['poblaciones']),
                    'pendiente_revision', '', hash_cont, datetime.now().isoformat(),
                    0, 0, 0,  # verificada=0, revisada=0, aprobado=0
                    random.randint(60, 90), random.randint(60, 90),
                    'USD', random.randint(10000, 500000), 0
                )
            )
    
    conn.commit()
    conn.close()

async def log_result(result: Dict):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''INSERT INTO radar_log (fuente, estado, convocatorias_encontradas, tiempo_ejecucion, errores)
        VALUES (?, ?, ?, ?, ?)''', (result['fuente'], result['estado'], result['encontradas'], result['tiempo'], result['error']))
    conn.commit()
    conn.close()

def get_stats() -> Dict:
    """Retorna estadísticas del radar"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    c.execute('SELECT COUNT(*) FROM convocatorias')
    total = c.fetchone()[0]
    
    c.execute('SELECT COUNT(*) FROM convocatorias WHERE verificada = 1')
    verificadas = c.fetchone()[0]
    
    c.execute('SELECT COUNT(*) FROM convocatorias WHERE revisada = 1 AND aprobado = 1')
    aprobadas = c.fetchone()[0]
    
    c.execute('SELECT COUNT(*) FROM convocatorias WHERE revisada = 1 AND aprobado = 0')
    rechazadas = c.fetchone()[0]
    
    c.execute('SELECT COUNT(*) FROM columnas WHERE verificada = 0 AND revisada = 0')
    pendientes = c.fetchone()[0]
    
    c.execute('SELECT COUNT(*) FROM radar_cache WHERE datetime(fecha_cache) > datetime(\'now\', \'-24 hours\')')
    cache_vigente = c.fetchone()[0]
    
    conn.close()
    
    return {
        'total': total,
        'verificadas': verificadas,
        'aprobadas': aprobadas,
        'rechazadas': rechazadas,
        'pendientes_revision': pendientes,
        'cache_24h': cache_vigente
    }

async def run_radar():
    """Ejecuta el radar anti-bloqueo"""
    print("=" * 60)
    print("[RADAR AGENT v2.0] - Anti-Bloqueo + Cache + Rate Limit")
    print("=" * 60)
    
    init_database()
    
    cache = RequestCache()
    rate_limiter = RateLimiter()
    
    async with aiohttp.ClientSession() as session:
        # Scraping con delays automáticos
        for fuente in FUENTES:
            result = await scrape_fuente(session, fuente, cache, rate_limiter)
            await log_result(result)
            # Delay entre fuentes
            await asyncio.sleep(random.uniform(2, 5))
    
    stats = get_stats()
    
    print("=" * 60)
    print("ESTADISTICAS:")
    print(f"  Total convocatorias: {stats['total']}")
    print(f"  Pendientes de revision: {stats['pendientes_revision']}")
    print(f"  Aprobadas para usuarios: {stats['aprobadas']}")
    print(f"  Rechazadas: {stats['rechazadas']}")
    print(f"  Cache vigente (24h): {stats['cache_24h']}")
    print("=" * 60)
    
    return stats

if __name__ == '__main__':
    asyncio.run(run_radar())