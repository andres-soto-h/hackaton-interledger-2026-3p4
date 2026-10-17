"""Lambda del agente (spec 028): Strands Agents + Amazon Bedrock + ElevenLabs.

Entrada (la API la invoca de forma síncrona, sin URL pública):
  {userToken, userId, text, inputMode, speak, history: [{role, text}]}
Salida: {text, actions[], audio?, audioUnavailable?}
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any

from strands import Agent
from strands.models import BedrockModel

import voice
from api_client import ApiClient
from prompt import SYSTEM_PROMPT
from tools import TurnContext, build_tools

logger = logging.getLogger("agent")
logger.setLevel(logging.INFO)

FALLBACK_REPLY = "No pude responderle bien. No se movió dinero. ¿Lo intentamos de nuevo?"
MAX_TEXT = 500

_model: BedrockModel | None = None


def _get_model() -> BedrockModel:
    """Modelo de Bedrock elegido por `AGENT_MODEL_ID`; se crea una vez por instancia."""
    global _model
    if _model is None:
        _model = BedrockModel(
            model_id=os.environ["AGENT_MODEL_ID"],
            temperature=0.2,
            max_tokens=600,
        )
    return _model


def _to_messages(history: list[dict[str, str]]) -> list[dict[str, Any]]:
    messages = [
        {"role": m["role"], "content": [{"text": str(m["text"])[:2000]}]}
        for m in history
        if m.get("role") in ("user", "assistant") and m.get("text")
    ]
    # Bedrock exige que la conversación empiece con el usuario.
    while messages and messages[0]["role"] != "user":
        messages.pop(0)
    return messages


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    started = time.monotonic()
    ctx = TurnContext(api=ApiClient(os.environ["API_BASE_URL"], event["userToken"]))
    text = str(event["text"])[:MAX_TEXT]

    agent = Agent(
        model=_get_model(),
        system_prompt=SYSTEM_PROMPT,
        tools=build_tools(ctx),
        messages=_to_messages(event.get("history", [])),
        callback_handler=None,
    )
    reply = str(agent(text)).strip() or FALLBACK_REPLY
    result: dict[str, Any] = {"text": reply, "actions": ctx.actions}

    if event.get("speak"):
        # Tiempo para el audio: lo que quede de la invocación menos un margen.
        remaining = context.get_remaining_time_in_millis() / 1000 - 2
        audio = (
            voice.synthesize(
                reply,
                secret_arn=os.environ["ELEVENLABS_SECRET_ARN"],
                voice_id=os.environ["ELEVENLABS_VOICE_ID"],
                model_id=os.environ["ELEVENLABS_MODEL_ID"],
                timeout=min(8.0, remaining),
            )
            if remaining > 1
            else None
        )
        if audio is not None:
            result["audio"] = audio
        else:
            result["audioUnavailable"] = True

    # Sin token ni texto: solo quién, qué tools dejaron acciones y cuánto tardó.
    logger.info(
        "turn userId=%s tool_calls=%d actions=%s speak=%s ms=%d",
        event.get("userId"),
        ctx.tool_calls,
        [a["type"] for a in ctx.actions],
        bool(event.get("speak")),
        int((time.monotonic() - started) * 1000),
    )
    return result
