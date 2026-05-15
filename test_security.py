from dotenv import load_dotenv
load_dotenv()
from security_advanced import security_manager
from auth import auth_manager

print('=== VERIFICACION DE SEGURIDAD AVANZADA ===')
print()

health = security_manager.security_health_check()
print('Health Check:')
for k, v in health.items():
    print(f'  {k}: {v}')

print()
print('Rate Limit Test:')
for i in range(5):
    result = security_manager.check_rate_limit('test_client')
    print(f'  Request {i+1}: {"OK" if result else "BLOQUEADO"}')

print()
print('Input Validation Test:')
test_inputs = [
    'Texto normal',
    'Texto con <script>peligro</script>',
    'x' * 100000
]
for inp in test_inputs:
    result = security_manager.validate_input(inp, 'test')
    print(f'  "{inp[:30]}...": {"VALIDO" if result else "BLOQUEADO"}')

print()
print('=== TODAS LAS VERIFICACIONES COMPLETADAS ===')