"""Cliente HTTP de la API de TuTranqui con el token del propio usuario.

El agente no tiene credenciales propias: cada tool llama a la API como el usuario,
así hereda sus límites (tope por pago, monto diario, solo COP en comercios).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
import uuid
from typing import Any


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.status = status
        self.code = code
        self.message = message


class ApiClient:
    def __init__(self, base_url: str, token: str, timeout: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout

    def get(self, path: str) -> Any:
        return self._request("GET", path, None, False)

    def post(self, path: str, body: dict[str, Any], *, idempotent: bool = False) -> Any:
        return self._request("POST", path, body, idempotent)

    def _request(self, method: str, path: str, body: dict[str, Any] | None, idempotent: bool) -> Any:
        headers = {"Accept": "application/json", "Authorization": f"Bearer {self._token}"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        if idempotent:
            headers["Idempotency-Key"] = str(uuid.uuid4())
        request = urllib.request.Request(
            f"{self._base_url}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            raise _to_api_error(error) from None
        except (urllib.error.URLError, TimeoutError) as error:
            raise ApiError(0, "NETWORK_ERROR", "No hay conexión con la API") from error
        return json.loads(raw) if raw else None


def _to_api_error(error: urllib.error.HTTPError) -> ApiError:
    try:
        detail = json.loads(error.read()).get("error", {})
        return ApiError(error.code, str(detail.get("code", "UNKNOWN_ERROR")), str(detail.get("message", "")))
    except (ValueError, AttributeError):
        return ApiError(error.code, "UNKNOWN_ERROR", f"Respuesta inesperada ({error.code})")
