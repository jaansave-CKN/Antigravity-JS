import requests
from bs4 import BeautifulSoup
import time
import re
from datetime import datetime
from database import guardar_entidad, guardar_scraped_result, log_scraping, log_ejecucion, init_db, get_all_entidades # IMPORTAR get_all_entidades

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
# ... resto del archivo
