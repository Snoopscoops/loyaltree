#!/usr/bin/env python3
"""
Generate a P-256 ECDH key pair for LoyaltyTree Trial 7 structural testing.

IMPORTANT:
This creates the cryptographic key material only.
It does NOT grant the Apple Wallet NFC entitlement.

Output:
- trial7_nfc_private_key.pem      KEEP PRIVATE
- trial7_nfc_public_key.txt      Base64 DER SPKI for Render env
"""
import base64
from pathlib import Path
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    PrivateFormat,
    PublicFormat,
    NoEncryption,
)

private_key = ec.generate_private_key(ec.SECP256R1())

private_pem = private_key.private_bytes(
    Encoding.PEM,
    PrivateFormat.PKCS8,
    NoEncryption(),
)

public_der = private_key.public_key().public_bytes(
    Encoding.DER,
    PublicFormat.SubjectPublicKeyInfo,
)

public_b64 = base64.b64encode(public_der).decode("ascii")

Path("trial7_nfc_private_key.pem").write_bytes(private_pem)
Path("trial7_nfc_public_key.txt").write_text(public_b64 + "\n")

print("Created trial7_nfc_private_key.pem")
print("Created trial7_nfc_public_key.txt")
print()
print("Render environment variable:")
print("APPLE_POSTER_TRIAL7_NFC_PUBLIC_KEY=" + public_b64)
print()
print("WARNING: This does NOT grant Apple Wallet NFC entitlement.")
