"""Self-signed TLS certificate generator using only the Python standard library.

Phones only allow microphone access on HTTPS pages, so the server needs a
certificate. Windows has no OpenSSL by default, so we build one by hand:
RSA-2048 key, X.509 v3 certificate, SHA-256 signature.
"""
import base64
import hashlib
import ipaddress
import secrets
import time

_SMALL_PRIMES = [p for p in range(3, 2000, 2) if all(p % d for d in range(3, int(p ** 0.5) + 1, 2))]


def _is_probable_prime(n, rounds=40):
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for _ in range(rounds):
        a = secrets.randbelow(n - 3) + 2
        x = pow(a, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def _gen_prime(bits):
    while True:
        c = secrets.randbits(bits) | (1 << (bits - 1)) | (1 << (bits - 2)) | 1
        if any(c % p == 0 for p in _SMALL_PRIMES):
            continue
        if _is_probable_prime(c):
            return c


def _gen_rsa(bits=2048):
    e = 65537
    while True:
        p, q = _gen_prime(bits // 2), _gen_prime(bits // 2)
        if p == q:
            continue
        phi = (p - 1) * (q - 1)
        if phi % e == 0:
            continue
        if p < q:
            p, q = q, p
        d = pow(e, -1, phi)
        return {"n": p * q, "e": e, "d": d, "p": p, "q": q,
                "dp": d % (p - 1), "dq": d % (q - 1), "qi": pow(q, -1, p)}


# ---- minimal DER encoder ----

def _len(n):
    if n < 0x80:
        return bytes([n])
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(b)]) + b


def _tlv(tag, content):
    return bytes([tag]) + _len(len(content)) + content


def _int(v):
    return _tlv(0x02, v.to_bytes(v.bit_length() // 8 + 1, "big"))


def _seq(*parts):
    return _tlv(0x30, b"".join(parts))


def _oid(dotted):
    arcs = [int(x) for x in dotted.split(".")]
    out = bytes([40 * arcs[0] + arcs[1]])
    for arc in arcs[2:]:
        chunk = [arc & 0x7F]
        arc >>= 7
        while arc:
            chunk.append(0x80 | (arc & 0x7F))
            arc >>= 7
        out += bytes(reversed(chunk))
    return _tlv(0x06, out)


def _name(cn):
    return _seq(_tlv(0x31, _seq(_oid("2.5.4.3"), _tlv(0x0C, cn.encode("utf-8")))))


def _utctime(ts):
    return _tlv(0x17, time.strftime("%y%m%d%H%M%SZ", time.gmtime(ts)).encode())


def _pem(label, der):
    b64 = base64.b64encode(der).decode()
    lines = [b64[i:i + 64] for i in range(0, len(b64), 64)]
    return "-----BEGIN %s-----\n%s\n-----END %s-----\n" % (label, "\n".join(lines), label)


_NULL = b"\x05\x00"
_SHA256_RSA = _seq(_oid("1.2.840.113549.1.1.11"), _NULL)
_SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")


def _sign(key, data):
    k = (key["n"].bit_length() + 7) // 8
    t = _SHA256_PREFIX + hashlib.sha256(data).digest()
    em = b"\x00\x01" + b"\xff" * (k - len(t) - 3) + b"\x00" + t
    return pow(int.from_bytes(em, "big"), key["d"], key["n"]).to_bytes(k, "big")


def generate(common_name, dns_names, ip_addresses, days=820):
    """Return (cert_pem, key_pem) for a self-signed server certificate."""
    key = _gen_rsa(2048)
    now = int(time.time())

    san = b"".join(_tlv(0x82, d.encode("ascii")) for d in dns_names)
    san += b"".join(_tlv(0x87, ipaddress.ip_address(i).packed) for i in ip_addresses)
    extensions = _seq(
        _seq(_oid("2.5.29.19"), _tlv(0x01, b"\xff"), _tlv(0x04, _seq())),                 # basicConstraints
        _seq(_oid("2.5.29.15"), _tlv(0x01, b"\xff"), _tlv(0x04, _tlv(0x03, b"\x05\xa0"))),  # keyUsage
        _seq(_oid("2.5.29.37"), _tlv(0x04, _seq(_oid("1.3.6.1.5.5.7.3.1")))),             # serverAuth
        _seq(_oid("2.5.29.17"), _tlv(0x04, _seq(san))),                                   # subjectAltName
    )
    spki = _seq(_seq(_oid("1.2.840.113549.1.1.1"), _NULL),
                _tlv(0x03, b"\x00" + _seq(_int(key["n"]), _int(key["e"]))))
    name = _name(common_name)
    tbs = _seq(
        _tlv(0xA0, _int(2)),
        _int(secrets.randbits(127) | (1 << 126)),
        _SHA256_RSA,
        name,
        _seq(_utctime(now - 86400), _utctime(now + days * 86400)),
        name,
        spki,
        _tlv(0xA3, extensions),
    )
    cert = _seq(tbs, _SHA256_RSA, _tlv(0x03, b"\x00" + _sign(key, tbs)))
    private = _seq(_int(0), _int(key["n"]), _int(key["e"]), _int(key["d"]), _int(key["p"]),
                   _int(key["q"]), _int(key["dp"]), _int(key["dq"]), _int(key["qi"]))
    return _pem("CERTIFICATE", cert), _pem("RSA PRIVATE KEY", private)
