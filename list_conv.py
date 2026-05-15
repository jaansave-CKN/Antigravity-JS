from database import get_convocatorias

conv = get_convocatorias()
print(f'Total en DB: {len(conv)}')
print()
for i, c in enumerate(conv, 1):
    print(f"{i}. {c['titulo'][:60]}")
    print(f"   Fuente: {c['fuente']}")
    print(f"   URL: {c.get('url_fuente', 'N/A')}")
    print(f"   Fecha limite: {c.get('fecha_limite', 'N/A')}")
    print(f"   Score: {c.get('score_probabilidad', 0)}")
    print()