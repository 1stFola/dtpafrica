"""The Edge's own CA must produce a certificate a client trusting only that CA accepts, for
localhost and the LAN address, and must keep its keys private. Since R4 (6 November 2026) it
may sign for the Edge's own names only, and its key goes off the Edge once the certificate is
issued, coming back only to reissue."""

import ipaddress
import socket
import ssl
import stat
import sys
import threading
from datetime import timedelta

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from fairplay_edge.naming import utcnow
from fairplay_edge.tlsgen import SERVER_DAYS, TlsError, init, outside, permitted_names, problems

from .test_phase3_api import service  # noqa: F401  (fixture)


def _server_ctx(cert, key) -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(cert, key)
    return ctx


def _client_ctx(cafile=None) -> ssl.SSLContext:
    ctx = ssl.create_default_context(cafile=str(cafile) if cafile else None)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    # As Python 3.13 and other strict clients verify: RFC 5280's key identifiers required (6.1).
    ctx.verify_flags |= ssl.VERIFY_X509_STRICT
    return ctx


def _handshake(cert, key, cafile, server_hostname: str) -> None:
    """One TLS handshake against a server holding `cert`, as a client trusting only `cafile`."""
    server_ctx = _server_ctx(cert, key)
    listener = socket.create_server(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    errors = []

    def serve():
        conn, _ = listener.accept()
        try:
            with server_ctx.wrap_socket(conn, server_side=True) as tls:
                tls.sendall(tls.recv(5))
        except Exception as exc:  # the client's refusal shows up here too
            errors.append(exc)

    thread = threading.Thread(target=serve)
    thread.start()
    try:
        with socket.create_connection(("127.0.0.1", port)) as raw:
            with _client_ctx(cafile).wrap_socket(raw, server_hostname=server_hostname) as tls:
                tls.sendall(b"hello")
                assert tls.recv(5) == b"hello"
    finally:
        thread.join(5)
        listener.close()
    assert not errors


def test_the_chain_carries_the_key_identifiers_strict_clients_require(tmp_path):
    paths = init(tmp_path / "tls", ["edge.venue.lan"], "test")
    ca = x509.load_pem_x509_certificate(paths["ca"].read_bytes())
    server = x509.load_pem_x509_certificate(paths["cert"].read_bytes())
    ca_ski = ca.extensions.get_extension_for_class(x509.SubjectKeyIdentifier).value.digest
    aki = server.extensions.get_extension_for_class(x509.AuthorityKeyIdentifier).value.key_identifier
    assert aki == ca_ski
    assert server.extensions.get_extension_for_class(x509.SubjectKeyIdentifier)
    assert server.extensions.get_extension_for_class(x509.KeyUsage).value.digital_signature


def test_ca_and_server_certificate(tmp_path):
    paths = init(tmp_path / "tls", ["192.168.1.20", "edge.venue.lan"], "test")
    cert = x509.load_pem_x509_certificate(paths["cert"].read_bytes())
    sans = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert {"localhost", "edge.venue.lan"} <= set(sans.get_values_for_type(x509.DNSName))
    assert {ipaddress.ip_address("127.0.0.1"), ipaddress.ip_address("192.168.1.20")} <= set(
        sans.get_values_for_type(x509.IPAddress))
    assert (cert.not_valid_after_utc - cert.not_valid_before_utc).days <= SERVER_DAYS
    ca = x509.load_pem_x509_certificate(paths["ca"].read_bytes())
    assert ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca is True


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX file modes")
def test_private_keys_are_owner_only(tmp_path):
    paths = init(tmp_path / "tls", [], "test", keep_ca_key=True)
    for key in (paths["key"], tmp_path / "tls" / "ca-key.pem"):
        assert stat.S_IMODE(key.stat().st_mode) == 0o600


def test_reissue_keeps_the_same_ca(tmp_path):
    first = init(tmp_path / "tls", ["10.0.0.9"], "test", keep_ca_key=True)["ca"].read_bytes()
    assert init(tmp_path / "tls", ["10.0.0.9"], "test", keep_ca_key=True)["ca"].read_bytes() == first


def test_a_client_trusting_only_the_edge_ca_completes_a_handshake(tmp_path):
    paths = init(tmp_path / "tls", [], "test")
    _handshake(paths["cert"], paths["key"], paths["ca"], "localhost")


def test_a_client_without_the_ca_refuses(tmp_path):
    paths = init(tmp_path / "tls", [], "test")
    server_ctx = _server_ctx(paths["cert"], paths["key"])
    listener = socket.create_server(("127.0.0.1", 0))
    port = listener.getsockname()[1]

    def serve():
        conn, _ = listener.accept()
        try:
            server_ctx.wrap_socket(conn, server_side=True).close()
        except (ssl.SSLError, OSError):
            pass

    thread = threading.Thread(target=serve)
    thread.start()
    with socket.create_connection(("127.0.0.1", port)) as raw:
        with pytest.raises(ssl.SSLCertVerificationError):
            _client_ctx().wrap_socket(raw, server_hostname="localhost")
    thread.join(5)
    listener.close()


# ── R4: the CA signs for the Edge's own names only, and its key leaves the Edge ──

def _signed_by(ca_path, ca_key_pem: bytes, names: list[x509.GeneralName], folder):
    """A certificate the CA's key signs for other names: what a thief with the key could make."""
    ca = x509.load_pem_x509_certificate(ca_path.read_bytes())
    ca_key = serialization.load_pem_private_key(ca_key_pem, password=None)
    key = ec.generate_private_key(ec.SECP256R1())
    now = utcnow()
    cert = (
        x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "rogue")]))
        .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5)).not_valid_after(now + timedelta(days=30))
        .add_extension(x509.SubjectAlternativeName(names), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False,
                                     data_encipherment=False, key_agreement=False, key_cert_sign=False,
                                     crl_sign=False, encipher_only=False, decipher_only=False), critical=True)
        .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
        .sign(ca_key, hashes.SHA256())
    )
    cert_path, key_path = folder / "rogue.pem", folder / "rogue-key.pem"
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                           serialization.NoEncryption()))
    return cert_path, key_path


def test_the_ca_is_constrained_to_the_edges_own_names(tmp_path):
    paths = init(tmp_path / "tls", ["192.168.1.20", "edge.venue.lan"], "test")
    ca = x509.load_pem_x509_certificate(paths["ca"].read_bytes())
    ext = ca.extensions.get_extension_for_class(x509.NameConstraints)
    assert ext.critical and ext.value.excluded_subtrees is None
    assert set(permitted_names(ca)) == {"localhost", "127.0.0.1/32", "192.168.1.20/32", "edge.venue.lan"}
    assert outside(ca, ["edge.venue.lan", "192.168.1.20", "localhost", "a.edge.venue.lan"]) == []
    assert outside(ca, ["evil.example", "edge.venue.lan.evil.example", "192.168.1.21", "10.0.0.1"]) == [
        "evil.example", "edge.venue.lan.evil.example", "192.168.1.21", "10.0.0.1"]


def test_even_with_the_key_a_certificate_for_another_site_is_refused(tmp_path):
    paths = init(tmp_path / "tls", ["edge.venue.lan"], "test")
    own = _signed_by(paths["ca"], paths["ca_key_pem"], [x509.DNSName("edge.venue.lan")], tmp_path)
    _handshake(*own, paths["ca"], "edge.venue.lan")  # the rogue cert for its own name is, of course, fine
    rogue = _signed_by(paths["ca"], paths["ca_key_pem"], [x509.DNSName("bank.example")], tmp_path)
    with pytest.raises(ssl.SSLCertVerificationError):
        _handshake(*rogue, paths["ca"], "bank.example")
    rogue_ip = _signed_by(paths["ca"], paths["ca_key_pem"], [x509.IPAddress(ipaddress.ip_address("10.0.0.1"))], tmp_path)
    with pytest.raises(ssl.SSLCertVerificationError):
        _handshake(*rogue_ip, paths["ca"], "10.0.0.1")


def test_the_ca_key_is_handed_over_once_and_comes_back_to_reissue(tmp_path):
    folder = tmp_path / "tls"
    paths = init(folder, ["edge.venue.lan"], "test")
    assert paths["ca_key_pem"].startswith(b"-----BEGIN PRIVATE KEY-----") and not (folder / "ca-key.pem").exists()
    assert problems(folder) == []
    with pytest.raises(TlsError, match="off this Edge"):
        init(folder, ["edge.venue.lan"], "test")
    other = init(tmp_path / "other", [], "other")["ca_key_pem"]
    with pytest.raises(TlsError, match="not this venue CA's"):
        init(folder, ["edge.venue.lan"], "test", ca_key_pem=other)
    again = init(folder, ["edge.venue.lan"], "test", ca_key_pem=paths["ca_key_pem"])
    assert "ca_key_pem" not in again and not (folder / "ca-key.pem").exists()
    assert again["ca"].read_bytes() == paths["ca"].read_bytes()
    _handshake(again["cert"], again["key"], again["ca"], "edge.venue.lan")
    # A name the CA may not sign for needs a new CA, and the message says which names it permits.
    with pytest.raises(TlsError, match="permits only .*edge.venue.lan.*; for other.venue.lan delete"):
        init(folder, ["other.venue.lan"], "test", ca_key_pem=paths["ca_key_pem"])


def test_an_older_edge_is_found_wanting_and_its_key_is_moved_off(tmp_path):
    folder = tmp_path / "tls"
    init(folder, ["edge.venue.lan"], "test", keep_ca_key=True)
    assert problems(folder) == ["the venue CA's private key is on this Edge (tls/ca-key.pem)"]
    moved = init(folder, ["edge.venue.lan"], "test")
    assert moved["ca_key_pem"] and not (folder / "ca-key.pem").exists() and problems(folder) == []
    # A CA from before R4: no name constraints at all.
    old = tmp_path / "old"
    old.mkdir()
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "FairPlay Edge CA (old)")])
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(1).not_valid_before(utcnow() - timedelta(days=1)).not_valid_after(utcnow() + timedelta(days=1))
            .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True).sign(key, hashes.SHA256()))
    (old / "ca.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    assert problems(old) == ["the venue CA has no name constraints: it could sign for any site"]
    assert permitted_names(cert) is None and outside(cert, ["anything.example"]) == []


def test_the_edge_warns_while_the_ca_is_not_locked_down(service, tmp_path):  # noqa: F811
    from dataclasses import replace

    folder = tmp_path / "tls"
    paths = init(folder, ["edge.venue.lan"], "test", keep_ca_key=True)
    service.settings = replace(service.settings, tls_cert=paths["cert"], tls_key=paths["key"])
    assert service.check_venue_ca() == ["the venue CA's private key is on this Edge (tls/ca-key.pem)"]
    opened = service.store.one("SELECT severity, detail FROM alerts WHERE kind = 'venue_ca' AND resolved_utc IS NULL")
    assert opened["severity"] == "warning" and "ca-key.pem" in opened["detail"] and "edge-install.md" in opened["detail"]
    init(folder, ["edge.venue.lan"], "test")  # the key moved off
    assert service.check_venue_ca() == []
    assert service.store.one("SELECT 1 FROM alerts WHERE kind = 'venue_ca' AND resolved_utc IS NULL") is None
    service.settings = replace(service.settings, tls_cert=None, tls_key=None)
    assert service.check_venue_ca() == []  # no TLS of its own: nothing to say


def test_tls_init_hands_the_key_out_or_refuses(tmp_path, capsys, monkeypatch):
    from fairplay_edge import __main__ as cli

    class Fake:
        data_dir = tmp_path
        device_label = "cli"

    monkeypatch.setattr(cli, "_settings", lambda need_api_token=True: Fake)
    assert cli.main(["tls-init", "--host", "edge.venue.lan"]) == 2
    assert "--ca-key-out" in capsys.readouterr().err
    out_file = tmp_path / "venue-ca-key.pem"
    assert cli.main(["tls-init", "--host", "edge.venue.lan", "--ca-key-out", str(out_file)]) == 0
    captured = capsys.readouterr()
    assert out_file.read_bytes().startswith(b"-----BEGIN PRIVATE KEY-----") and "no longer on this Edge" in captured.err
    assert '"ca"' in captured.out and "PRIVATE KEY" not in captured.out and not (tmp_path / "tls" / "ca-key.pem").exists()
    # Reissue, with the key brought back from a file; a run without it is refused.
    assert cli.main(["tls-init", "--host", "edge.venue.lan"]) == 2
    assert "off this Edge" in capsys.readouterr().err
    assert cli.main(["tls-init", "--host", "edge.venue.lan", "--ca-key", str(out_file)]) == 0
    assert not (tmp_path / "tls" / "ca-key.pem").exists() and "warning" not in capsys.readouterr().err
    # A rehearsal keeps the key on the Edge, and is told so.
    Fake.data_dir = tmp_path / "rehearsal"
    assert cli.main(["tls-init", "--keep-ca-key"]) == 0
    assert (Fake.data_dir / "tls" / "ca-key.pem").exists() and "warning: the venue CA's private key is on this Edge" in capsys.readouterr().err
