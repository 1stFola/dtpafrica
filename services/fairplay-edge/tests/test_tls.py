"""The Edge's own CA must produce a certificate a client trusting only that CA accepts, for
localhost and the LAN address, and must keep its keys private."""

import ipaddress
import socket
import ssl
import stat
import sys
import threading

import pytest
from cryptography import x509

from fairplay_edge.tlsgen import SERVER_DAYS, init


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
    paths = init(tmp_path / "tls", [], "test")
    for key in (paths["key"], tmp_path / "tls" / "ca-key.pem"):
        assert stat.S_IMODE(key.stat().st_mode) == 0o600


def test_reissue_keeps_the_same_ca(tmp_path):
    first = init(tmp_path / "tls", [], "test")["ca"].read_bytes()
    assert init(tmp_path / "tls", ["10.0.0.9"], "test")["ca"].read_bytes() == first


def test_a_client_trusting_only_the_edge_ca_completes_a_handshake(tmp_path):
    paths = init(tmp_path / "tls", [], "test")
    server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_ctx.load_cert_chain(paths["cert"], paths["key"])
    client_ctx = ssl.create_default_context(cafile=str(paths["ca"]))
    listener = socket.create_server(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    errors = []

    def serve():
        conn, _ = listener.accept()
        try:
            with server_ctx.wrap_socket(conn, server_side=True) as tls:
                tls.sendall(tls.recv(5))
        except Exception as exc:  # surfaced below
            errors.append(exc)

    thread = threading.Thread(target=serve)
    thread.start()
    with socket.create_connection(("127.0.0.1", port)) as raw:
        with client_ctx.wrap_socket(raw, server_hostname="localhost") as tls:
            tls.sendall(b"hello")
            assert tls.recv(5) == b"hello"
    thread.join(5)
    listener.close()
    assert not errors


def test_a_client_without_the_ca_refuses(tmp_path):
    paths = init(tmp_path / "tls", [], "test")
    server_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_ctx.load_cert_chain(paths["cert"], paths["key"])
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
            ssl.create_default_context().wrap_socket(raw, server_hostname="localhost")
    thread.join(5)
    listener.close()
