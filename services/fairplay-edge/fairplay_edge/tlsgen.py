"""The Edge's own certificate authority, for HTTPS on the venue LAN (ADR-0004).

`fairplay-edge tls-init --host 192.168.1.20` writes, under `<data>/tls/`:
  ca.pem          the root certificate: install it once on each DTP-owned reviewer device
  ca-key.pem      the CA's private key, mode 0600; it never leaves the Edge
  server.pem      a certificate for localhost, 127.0.0.1 and the given addresses/names
  server-key.pem  its key, mode 0600
Then set FAIRPLAY_EDGE_TLS_CERT and FAIRPLAY_EDGE_TLS_KEY to the server pair. No public DNS
is touched. A device without the root installed sees a certificate warning, which operators
must never click through.
"""

from __future__ import annotations

import ipaddress
import os
from datetime import timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from .naming import utcnow

CA_DAYS = 730
SERVER_DAYS = 397  # browsers refuse longer server certificates


def _write_key(path: Path, key) -> None:
    data = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)


def _sans(hosts: list[str]) -> list[x509.GeneralName]:
    names: list[x509.GeneralName] = [x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    for host in hosts:
        try:
            names.append(x509.IPAddress(ipaddress.ip_address(host)))
        except ValueError:
            names.append(x509.DNSName(host))
    return names


def init(folder: Path, hosts: list[str], label: str) -> dict[str, Path]:
    folder.mkdir(parents=True, exist_ok=True)
    now = utcnow()
    ca_path, ca_key_path = folder / "ca.pem", folder / "ca-key.pem"
    if ca_path.exists() and ca_key_path.exists():
        ca_cert = x509.load_pem_x509_certificate(ca_path.read_bytes())
        ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), password=None)
    else:
        ca_key = ec.generate_private_key(ec.SECP256R1())
        ca_name = x509.Name([x509.NameAttribute(NameOID.ORGANIZATION_NAME, "DTP FairPlay Edge"),
                             x509.NameAttribute(NameOID.COMMON_NAME, f"FairPlay Edge CA ({label})")])
        ca_cert = (
            x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
            .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=CA_DAYS))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
            .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False, key_encipherment=False,
                                         data_encipherment=False, key_agreement=False, key_cert_sign=True,
                                         crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256())
        )
        _write_key(ca_key_path, ca_key)
        ca_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))

    key = ec.generate_private_key(ec.SECP256R1())
    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, f"fairplay-edge {label}")]))
        .issuer_name(ca_cert.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=SERVER_DAYS))
        .add_extension(x509.SubjectAlternativeName(_sans(hosts)), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False,
                                     data_encipherment=False, key_agreement=False, key_cert_sign=False,
                                     crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        # RFC 5280 requires these; strict verifiers (Python 3.13's default) refuse a chain without them.
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    server_path, server_key_path = folder / "server.pem", folder / "server-key.pem"
    _write_key(server_key_path, key)
    server_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return {"ca": ca_path, "cert": server_path, "key": server_key_path}
