"""Texto a voz con ElevenLabs (spec 028). Nunca bloquea el texto: si falla, devuelve None."""
from __future__ import annotations

import base64
import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any

import boto3

logger = logging.getLogger("agent.voice")

_API = "https://api.elevenlabs.io/v1/text-to-speech"
_OUTPUT_FORMAT = "mp3_44100_64"
_MAX_CHARS = 600
_api_key: str | None = None


def _load_api_key(secret_arn: str) -> str:
    """La llave vive en Secrets Manager (texto plano o JSON con `apiKey`); se cachea por instancia."""
    global _api_key
    if _api_key is None:
        raw = boto3.client("secretsmanager").get_secret_value(SecretId=secret_arn)["SecretString"].strip()
        try:
            parsed = json.loads(raw)
            raw = parsed["apiKey"] if isinstance(parsed, dict) else raw
        except (ValueError, KeyError):
            pass
        _api_key = raw
    return _api_key


def _speakable(text: str) -> str:
    """Quita formato markdown y recorta: la voz lee solo la respuesta."""
    plain = re.sub(r"[*_#`>]+", "", text)
    return " ".join(plain.split())[:_MAX_CHARS]


def synthesize(text: str, *, secret_arn: str, voice_id: str, model_id: str, timeout: float) -> dict[str, str] | None:
    """Devuelve `{"format": "mp3", "base64": ...}` o `None` si no se pudo (sin lanzar)."""
    try:
        body: dict[str, Any] = {"text": _speakable(text), "model_id": model_id}
        request = urllib.request.Request(
            f"{_API}/{voice_id}?output_format={_OUTPUT_FORMAT}",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "xi-api-key": _load_api_key(secret_arn),
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            audio = response.read()
        return {"format": "mp3", "base64": base64.b64encode(audio).decode("ascii")}
    except (urllib.error.URLError, TimeoutError, OSError, KeyError, ValueError, boto3.exceptions.Boto3Error) as error:
        # Sin el texto ni la llave: solo el tipo de fallo.
        logger.warning("ElevenLabs no disponible: %s", type(error).__name__)
        return None
