"""The Edge's own certificate authority, for HTTPS on the venue LAN (ADR-0004).

`fairplay-edge tls-init --host 192.168.1.20 --ca-key-out -` writes, under `<data>/tls/`:
  ca.pem          the root certificate: install it once on each DTP-owned reviewer device
  server.pem      a certificate for localhost, 127.0.0.1 and the given addresses/names
  server-key.pem  its key, mode 0600
and hands the CA's private key to the caller once, to go off this Edge (residual-risks.md R4):
the installer writes it to a file the custodian moves to removable media. Nothing of it stays
under `<data>/tls/` unless `--keep-ca-key` says so (rehearsals and tests). The CA carries name
constraints for exactly those names and addresses, so even with its key a certificate for any
other site would be refused by the devices that trust it. A certificate is reissued (a new
address, or the 397 days running out) with the key brought back: `--ca-key FILE` or `-`.

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
ALWAYS = ("localhost", "127.0.0.1")  # on the machine itself, with or without --host


class TlsError(Exception):
    """A certificate cannot be issued as asked; the message says what to do."""


def _write_private(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)


def _pem(key) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())


def _general_name(host: str) -> x509.GeneralName:
    try:
        return x509.IPAddress(ipaddress.ip_address(host))
    except ValueError:
        return x509.DNSName(host)


def _sans(hosts: list[str]) -> list[x509.GeneralName]:
    names: list[x509.GeneralName] = []
    for host in (*ALWAYS, *hosts):
        name = _general_name(host)
        if name not in names:
            names.append(name)
    return names


def _constraints(hosts: list[str]) -> x509.NameConstraints:
    """Permit exactly the Edge's names and addresses (R4). A DNS constraint also covers names
    under it, as RFC 5280 reads it; an address is one address."""
    permitted: list[x509.GeneralName] = []
    for host in (*ALWAYS, *hosts):
        try:
            name: x509.GeneralName = x509.IPAddress(ipaddress.ip_network(host))
        except ValueError:
            name = x509.DNSName(host)
        if name not in permitted:
            permitted.append(name)
    return x509.NameConstraints(permitted_subtrees=permitted, excluded_subtrees=None)


def permitted_names(ca_cert: x509.Certificate) -> list[str] | None:
    """What the CA may sign for, as words; None when it is not constrained (made before R4)."""
    try:
        constraints = ca_cert.extensions.get_extension_for_class(x509.NameConstraints).value
    except x509.ExtensionNotFound:
        return None
    return [str(n.value) for n in constraints.permitted_subtrees or []]


def outside(ca_cert: x509.Certificate, hosts: list[str]) -> list[str]:
    """The hosts this CA may not sign for; empty for an unconstrained CA."""
    try:
        constraints = ca_cert.extensions.get_extension_for_class(x509.NameConstraints).value
    except x509.ExtensionNotFound:
        return []
    permitted = constraints.permitted_subtrees or []
    dns = [n.value.lower() for n in permitted if isinstance(n, x509.DNSName)]
    nets = [n.value for n in permitted if isinstance(n, x509.IPAddress)]
    out = []
    for host in hosts:
        try:
            ip = ipaddress.ip_address(host)
            ok = any(ip in net for net in nets)
        except ValueError:
            h = host.lower()
            ok = any(h == d or h.endswith("." + d) for d in dns)
        if not ok:
            out.append(host)
    return out


def problems(folder: Path) -> list[str]:
    """What R4 still finds wrong with the venue CA under `folder`: its key on this Edge, or no
    name constraints. Nothing when there is no venue CA there."""
    found = []
    if (folder / "ca-key.pem").exists():
        found.append("the venue CA's private key is on this Edge (tls/ca-key.pem)")
    ca_path = folder / "ca.pem"
    if ca_path.exists() and permitted_names(x509.load_pem_x509_certificate(ca_path.read_bytes())) is None:
        found.append("the venue CA has no name constraints: it could sign for any site")
    return found


def init(folder: Path, hosts: list[str], label: str, *, ca_key_pem: bytes | None = None,
         keep_ca_key: bool = False) -> dict:
    """Issue the server certificate, making the CA first if there is none. Returns `ca`, `cert`
    and `key` paths and, when the CA's key is not to stay under `folder`, `ca_key_pem`: the
    key for the caller to put off this Edge. An existing on-disk key is handed over the same
    way, and removed. A reissue with the key already off the Edge needs `ca_key_pem`."""
    folder.mkdir(parents=True, exist_ok=True)
    now = utcnow()
    ca_path, ca_key_path = folder / "ca.pem", folder / "ca-key.pem"
    out: dict = {}
    if ca_path.exists():
        ca_cert = x509.load_pem_x509_certificate(ca_path.read_bytes())
        if ca_key_path.exists():
            ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), password=None)
        elif ca_key_pem:
            ca_key = serialization.load_pem_private_key(ca_key_pem, password=None)
        else:
            raise TlsError("the venue CA's key is off this Edge: bring it back with --ca-key FILE (or - on stdin), or delete"
                           " tls/ca.pem to make a new CA and install the new venue-ca.pem on every reviewer device")
        public = serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
        if ca_key.public_key().public_bytes(*public) != ca_cert.public_key().public_bytes(*public):
            raise TlsError("that key is not this venue CA's")
        refused = outside(ca_cert, hosts)
        if refused:
            raise TlsError(f"the venue CA permits only {', '.join(permitted_names(ca_cert) or [])}; for {', '.join(refused)}"
                           " delete tls/ca.pem to make a new CA, and install the new venue-ca.pem on every reviewer device")
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
            .add_extension(_constraints(hosts), critical=True)
            .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
            .sign(ca_key, hashes.SHA256())
        )
        ca_path.write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
        if keep_ca_key:
            _write_private(ca_key_path, _pem(ca_key))
    if not keep_ca_key and ca_key_path.exists():
        out["ca_key_pem"] = ca_key_path.read_bytes()
        ca_key_path.unlink()
    elif not keep_ca_key and not ca_key_pem:
        out["ca_key_pem"] = _pem(ca_key)

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
    _write_private(server_key_path, _pem(key))
    server_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return {"ca": ca_path, "cert": server_path, "key": server_key_path, **out}
