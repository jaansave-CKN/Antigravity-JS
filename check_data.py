from database import get_convocatorias, get_estadisticas

conv = get_convocatorias()
stats = get_estadisticas()

print(f"Total convocatorias: {len(conv)}")
print()
for c in conv:
    title = c['titulo'][:50] if c['titulo'] else 'N/A'
    score = c.get('score_probabilidad', 0)
    fuente = c.get('fuente', 'N/A')
    print(f"[{fuente}] {title}... (score: {score})")

print()
print("ESTADISTICAS:")
for k, v in stats.items():
    print(f"  {k}: {v}")