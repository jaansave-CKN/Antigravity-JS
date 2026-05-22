"""
SERVICIO DE ENCRIPTACIÓN - RADAR 360
=====================================
Utiliza AES-256-GCM para cifrar API Keys de usuarios.
La clave maestra se obtiene de la variable de entorno ENCRYPTION_KEY.
"""

import os
import hashlib
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.backends import default_backend
import json
import logging

logger = logging.getLogger(__name__)

class CryptoService:
    """
    Servicio de cifrado AES-256-GCM para credenciales.
    """
    
    def __init__(self):
        self._key = None
        self._aesgcm = None
    
    def _get_key(self) -> bytes:
        """Deriva una clave de 256 bits desde ENCRYPTION_KEY."""
        if self._key is None:
            encryption_key = os.getenv("ENCRYPTION_KEY")
            if not encryption_key:
                raise ValueError("ENCRYPTION_KEY no está configurada en variables de entorno")
            
            # Derivar clave de 32 bytes usando SHA-256
            self._key = hashlib.sha256(encryption_key.encode()).digest()
            self._aesgcm = AESGCM(self._key)
        
        return self._key
    
    def encrypt(self, plaintext: str) -> str:
        """
        Encripta un texto plano usando AES-256-GCM.
        
        Args:
            plaintext: Texto a encriptar (ej: API Key)
            
        Returns:
            String codificado en base64 con formato: nonce:ciphertext:tag
        """
        if not plaintext:
            return ""
        
        aesgcm = AESGCM(self._get_key())
        
        # Generar nonce aleatorio de 12 bytes
        nonce = os.urandom(12)
        
        # Encriptar
        ciphertext = aesgcm.encrypt(nonce, plaintext.encode('utf-8'), None)
        
        # Combinar nonce + ciphertext y codificar en base64
        combined = nonce + ciphertext
        return base64.b64encode(combined).decode('utf-8')
    
    def decrypt(self, encrypted_text: str) -> str:
        """
        Desencripta un texto cifrado.
        
        Args:
            encrypted_text: String encriptado codificado en base64
            
        Returns:
            Texto plano original
        """
        if not encrypted_text:
            return ""
        
        try:
            aesgcm = AESGCM(self._get_key())
            
            # Decodificar de base64
            combined = base64.b64decode(encrypted_text.encode('utf-8'))
            
            # Extraer nonce (12 bytes) y ciphertext
            nonce = combined[:12]
            ciphertext = combined[12:]
            
            # Desencriptar
            plaintext = aesgcm.decrypt(nonce, ciphertext, None)
            return plaintext.decode('utf-8')
            
        except Exception as e:
            logger.error(f"Error al desencriptar: {e}")
            raise ValueError("Error al desencriptar datos. Verificar clave de cifrado.")
    
    def hash_sensitive(self, data: str) -> str:
        """
        Genera un hash unidireccional para datos sensibles (no reversible).
        Útil para validación sin almacenar el valor real.
        """
        if not data:
            return ""
        return hashlib.sha256(data.encode()).hexdigest()
    
    def encrypt_dict(self, data: dict, fields_to_encrypt: list) -> dict:
        """
        Encripta campos específicos de un diccionario.
        
        Args:
            data: Diccionario con datos
            fields_to_encrypt: Lista de claves a encriptar
            
        Returns:
            Diccionario con campos encriptados
        """
        result = data.copy()
        for field in fields_to_encrypt:
            if field in result and result[field]:
                result[field] = self.encrypt(result[field])
        return result
    
    def decrypt_dict(self, data: dict, fields_to_decrypt: list) -> dict:
        """
        Desencripta campos específicos de un diccionario.
        """
        result = data.copy()
        for field in fields_to_decrypt:
            if field in result and result[field]:
                try:
                    result[field] = self.decrypt(result[field])
                except:
                    pass  # Si no se puede desencriptar, dejar como está
        return result


# Instancia global del servicio
crypto_service = CryptoService()


def encrypt_api_key(api_key: str) -> str:
    """Función de conveniencia para encriptar API keys."""
    return crypto_service.encrypt(api_key)


def decrypt_api_key(encrypted_key: str) -> str:
    """Función de conveniencia para desencriptar API keys."""
    return crypto_service.decrypt(encrypted_key)


def get_organizacion_with_decrypted_keys(org_id: str) -> dict:
    """Obtiene organización con API keys desencriptadas para uso interno."""
    from database import get_organizaciones
    
    orgs = get_organizaciones()
    for org in orgs:
        if org.get("id") == org_id:
            # Desencriptar las credenciales para uso interno
            if org.get("api_key_google"):
                try:
                    org["api_key_google"] = crypto_service.decrypt(org["api_key_google"])
                except:
                    pass
            if org.get("notebook_google"):
                try:
                    org["notebook_google"] = crypto_service.decrypt(org["notebook_google"])
                except:
                    pass
            return org
    return {}


def save_organizacion_with_encrypted_keys(data: dict) -> str:
    """Guarda organización con API keys encriptadas."""
    from database import crear_organizacion
    
    # Encriptar credenciales antes de guardar
    data_to_save = data.copy()
    
    if data_to_save.get("api_key_google"):
        data_to_save["api_key_google"] = crypto_service.encrypt(data_to_save["api_key_google"])
    
    if data_to_save.get("notebook_google"):
        data_to_save["notebook_google"] = crypto_service.encrypt(data_to_save["notebook_google"])
    
    return crear_organizacion(data_to_save)


if __name__ == "__main__":
    # Test del servicio
    print("=== Test Crypto Service ===")
    test_key = "AIzaSyDemo-123456789"
    encrypted = encrypt_api_key(test_key)
    print(f"Original: {test_key}")
    print(f"Encriptado: {encrypted}")
    decrypted = decrypt_api_key(encrypted)
    print(f"Desencriptado: {decrypted}")
    print(f"Match: {test_key == decrypted}")