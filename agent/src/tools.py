"""Las tres tools del agente (spec 028). No existe ninguna tool para confirmar pagos.

Las tools reciben el contexto del turno por cierre (no como argumento del modelo): el
token del usuario nunca pasa por el modelo. Los resultados reales alimentan `actions`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from strands import tool

from api_client import ApiClient, ApiError

MAX_TOOL_CALLS = 6
_AMOUNT_RE = re.compile(r"^\d{1,12}(\.\d{1,2})?$")


@dataclass
class TurnContext:
    api: ApiClient
    actions: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: int = 0

    def add_action(self, action: dict[str, Any]) -> None:
        if action["type"] == "confirm_payment":
            # Ya se eligió comercio y hay pago: la lista de opciones quedó obsoleta.
            self.actions = [a for a in self.actions if a["type"] != "choose_merchant"]
        if action not in self.actions:
            self.actions.append(action)


def _clean(value: Any, limit: int = 80) -> str:
    """Texto de un tercero (comercio, descripción): recortado y en una línea."""
    return " ".join(str(value or "").split())[:limit]


def _over_budget(ctx: TurnContext) -> dict[str, Any] | None:
    ctx.tool_calls += 1
    if ctx.tool_calls > MAX_TOOL_CALLS:
        return {"error": "Demasiadas consultas en este turno. Responda con lo que ya tiene."}
    return None


def _merchant_view(merchant: dict[str, Any]) -> dict[str, Any]:
    return {
        "merchantId": merchant["id"],
        "name": _clean(merchant.get("name")),
        "fixedAmount": merchant.get("fixedAmount"),
        "assetCode": merchant.get("assetCode", "COP"),
    }


def build_tools(ctx: TurnContext) -> list[Any]:
    @tool
    def search_merchants(query: str = "") -> dict[str, Any]:
        """Busca comercios en el directorio seguro de TuTranqui.

        Args:
            query: Nombre del comercio o parte de él (por ejemplo "EPM" o "Claro"). Vacío para listarlos todos.
        """
        if (stop := _over_budget(ctx)) is not None:
            return stop
        try:
            items = ctx.api.get("/api/v1/merchants")["items"]
        except ApiError as error:
            return {"error": f"No pude consultar el directorio ({error.code})."}
        needle = query.strip().lower()
        found = [m for m in items if not needle or needle in str(m.get("name", "")).lower()]
        if len(found) > 1:
            ctx.add_action(
                {
                    "type": "choose_merchant",
                    "options": [{"merchantId": m["id"], "label": _clean(m.get("name"))} for m in found[:6]],
                }
            )
        return {"merchants": [_merchant_view(m) for m in found]}

    @tool
    def list_transactions(limit: int = 5, status: str = "") -> dict[str, Any]:
        """Lista los pagos más recientes de la persona, del más nuevo al más antiguo.

        Args:
            limit: Cuántos pagos traer, de 1 a 20.
            status: Filtro opcional por estado (COMPLETED, FAILED, CANCELLED, EXPIRED, AWAITING_CONFIRMATION).
        """
        if (stop := _over_budget(ctx)) is not None:
            return stop
        count = max(1, min(int(limit), 20))
        path = f"/api/v1/transactions?limit={count}&kind=payment&direction=outgoing"
        if re.fullmatch(r"[A-Z_]{3,30}", status or ""):
            path += f"&status={status}"
        try:
            page = ctx.api.get(path)
        except ApiError as error:
            return {"error": f"No pude consultar los pagos ({error.code})."}
        return {
            "transactions": [
                {
                    "paymentId": t["id"],
                    "merchant": _clean((t.get("counterparty") or {}).get("name") or "Otra persona"),
                    "amount": t.get("totalDebit") or t.get("debitAmount"),
                    "status": t.get("status"),
                    "createdAt": t.get("createdAt"),
                }
                for t in page.get("items", [])
            ]
        }

    @tool
    def create_payment(merchantId: str, amount: str = "") -> dict[str, Any]:
        """Deja listo un pago a un comercio del directorio para que la persona lo confirme. NO lo ejecuta.

        Args:
            merchantId: El merchantId devuelto por search_merchants.
            amount: Monto en pesos colombianos, solo si el comercio no tiene monto fijo (por ejemplo "45000" o "45000.50").
        """
        if (stop := _over_budget(ctx)) is not None:
            return stop
        try:
            items = ctx.api.get("/api/v1/merchants")["items"]
        except ApiError as error:
            return {"error": f"No pude consultar el directorio ({error.code})."}
        merchant = next((m for m in items if m.get("id") == merchantId), None)
        if merchant is None:
            return {"error": "Ese comercio no está en el directorio. Use search_merchants."}

        # El monto fijo del directorio manda siempre, aunque el modelo pida otro.
        value = merchant.get("fixedAmount") or amount.strip()
        if not value:
            return {"error": "Falta el monto. Pregúntele a la persona cuánto va a pagar."}
        try:
            if not _AMOUNT_RE.match(value) or Decimal(value) <= 0:
                raise InvalidOperation
        except InvalidOperation:
            return {"error": "El monto no es válido. Pídale un valor en pesos, por ejemplo 45000."}

        try:
            payment = ctx.api.post(
                "/api/v1/payments",
                {
                    "type": "p2m",
                    "receiverWalletAddress": merchant["walletAddress"],
                    "amount": {"value": value, "assetCode": merchant.get("assetCode", "COP")},
                    "description": _clean(merchant.get("name"), 140),
                },
                idempotent=True,
            )
        except ApiError as error:
            return {"error": f"No se pudo preparar el pago ({error.code}). No se movió dinero."}

        ctx.add_action({"type": "confirm_payment", "paymentId": payment["paymentId"]})
        quote = payment.get("quote", {})
        return {
            "status": "AWAITING_CONFIRMATION",
            "merchant": _clean(merchant.get("name")),
            "receiveAmount": quote.get("receiveAmount"),
            "fee": quote.get("fee"),
            "totalDebit": quote.get("totalDebit"),
            "note": "El pago NO está hecho: la persona debe confirmarlo en la app.",
        }

    return [search_merchants, list_transactions, create_payment]
