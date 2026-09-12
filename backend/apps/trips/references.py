import secrets

# Same unambiguous alphabet as booking references (no 0/O, 1/I/L).
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate_trip_code() -> str:
    """Short, human-friendly trip identifier such as ``TR7KQ2M9``."""
    return "TR" + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
