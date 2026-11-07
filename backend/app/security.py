import base64
import hashlib
import hmac
import re
from uuid import UUID

UUID_PATTERN = r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

def credential_id(secret: bytes) -> str:
    return str(UUID(bytes=hashlib.sha256(b'learning-credential-id-v1\0' + secret).digest()[:16], version=4))

def parse_token(header):
    if not isinstance(header, str) or not re.fullmatch(r'Bearer ' + UUID_PATTERN + r'\.[A-Za-z0-9_-]{43}', header):
        raise ValueError('INVALID')
    cid, raw = header[7:].split('.')
    secret = base64.urlsafe_b64decode(raw + '=')
    if base64.urlsafe_b64encode(secret).decode().rstrip('=') != raw or credential_id(secret) != cid:
        raise ValueError('INVALID')
    return cid, secret

def digest(pepper, cid, secret):
    return hmac.new(pepper, f'learning-auth-v1\nowner\n{cid}\n'.encode() + secret, hashlib.sha256).hexdigest()
