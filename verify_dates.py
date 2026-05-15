from database import get_convocatorias
from datetime import datetime

conv = get_convocatorias()
today = datetime.now()

print('=== VERIFICACION DE FECHAS ===')
print(f'Hoy: {today.strftime("%Y-%m-%d")}')
print()

for c in conv:
    fecha_limite = c.get('fecha_limite', '')
    try:
        dt = datetime.strptime(fecha_limite, '%Y-%m-%d')
        dias = (dt - today).days
        if dias < 0:
            estado = 'CERRADA'
        elif dias <= 7:
            estado = 'URGENTE'
        elif dias <= 30:
            estado = 'PROXIMA'
        else:
            estado = 'ABIERTA'
        print(f'[{estado}] {c["titulo"][:50]}... | Fecha: {fecha_limite} ({dias} dias)')
    except Exception as e:
        print(f'[?] {c["titulo"][:50]}... | Fecha: {fecha_limite} | Error: {e}')