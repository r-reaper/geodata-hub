"""
Thai GeoData Hub — Stripe Payments Router
Handles checkout sessions and webhook processing for credit top-ups.
"""

import os
import json
import logging
import threading
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

import stripe

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────

STRIPE_SECRET_KEY      = os.getenv("STRIPE_SECRET_KEY",       "")
STRIPE_WEBHOOK_SECRET  = os.getenv("STRIPE_WEBHOOK_SECRET",   "")

# Credit pack prices in satang (1 THB = 100 satang)
CREDIT_PACK_PRICES = {
    100:  10_000,   # ฿100
    500:  45_000,   # ฿450
    1000: 80_000,   # ฿800
    5000: 350_000,  # ฿3500
}

stripe.api_key = STRIPE_SECRET_KEY

router = APIRouter(prefix="/payments", tags=["payments"])
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# File-based credit store (fallback when no DATABASE_URL)
# ─────────────────────────────────────────────

_CREDITS_FILE = Path(__file__).parent / "credits.json"
_credits_lock = threading.Lock()


def _read_credits_file() -> dict:
    if not _CREDITS_FILE.exists():
        return {}
    try:
        return json.loads(_CREDITS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _write_credits_file(data: dict):
    tmp = _CREDITS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, _CREDITS_FILE)


def get_user_credits_file(user_id: str) -> int:
    with _credits_lock:
        return _read_credits_file().get(user_id, 0)


def add_credits_file(user_id: str, amount: int) -> bool:
    with _credits_lock:
        data = _read_credits_file()
        data[user_id] = data.get(user_id, 0) + amount
        _write_credits_file(data)
        return True


def deduct_credits_file(user_id: str, amount: int) -> bool:
    with _credits_lock:
        data = _read_credits_file()
        current = data.get(user_id, 0)
        if current < amount:
            return False
        data[user_id] = current - amount
        _write_credits_file(data)
        return True

# ─────────────────────────────────────────────
# Database connection
# ─────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL", "")

def get_db_engine():
    if not DATABASE_URL:
        return None
    return create_engine(DATABASE_URL)


def get_user_credits_db(user_id: str) -> int:
    """Fetch current credits for a user. Falls back to file store if no DB."""
    if not DATABASE_URL:
        return get_user_credits_file(user_id)
    engine = get_db_engine()
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("SELECT credits FROM user_credits WHERE user_id = :uid"),
                {"uid": user_id}
            ).fetchone()
            return result["credits"] if result else 0
    except SQLAlchemyError as e:
        log.error(f"DB error fetching credits for {user_id}: {e}")
        return get_user_credits_file(user_id)


def add_credits_db(user_id: str, amount: int) -> bool:
    """Add credits to a user account. Falls back to file store if no DB."""
    if not DATABASE_URL:
        return add_credits_file(user_id, amount)
    engine = get_db_engine()
    try:
        with engine.connect() as conn:
            conn.execute(
                text("""
                    INSERT INTO user_credits (user_id, credits) VALUES (:uid, :amt)
                    ON CONFLICT (user_id) DO UPDATE SET
                        credits = user_credits.credits + :amt,
                        updated_at = NOW()
                """),
                {"uid": user_id, "amt": amount}
            )
            conn.commit()
            return True
    except SQLAlchemyError as e:
        log.error(f"DB error adding credits for {user_id}: {e}")
        return add_credits_file(user_id, amount)


def deduct_credits_db(user_id: str, amount: int) -> bool:
    """Deduct credits from a user account. Returns False if insufficient."""
    if not DATABASE_URL:
        return deduct_credits_file(user_id, amount)
    engine = get_db_engine()
    try:
        with engine.connect() as conn:
            result = conn.execute(
                text("SELECT credits FROM user_credits WHERE user_id = :uid FOR UPDATE"),
                {"uid": user_id}
            ).fetchone()
            current = result["credits"] if result else 0
            if current < amount:
                return False
            conn.execute(
                text("UPDATE user_credits SET credits = credits - :amt WHERE user_id = :uid"),
                {"uid": user_id, "amt": amount}
            )
            conn.commit()
            return True
    except SQLAlchemyError as e:
        log.error(f"DB error deducting credits for {user_id}: {e}")
        return deduct_credits_file(user_id, amount)


# ─────────────────────────────────────────────
# Request models
# ─────────────────────────────────────────────

class CheckoutRequest(BaseModel):
    user_id: str
    amount: int  # number of credits to buy (100, 500, 1000, etc.)
    redirect_url: str = "http://localhost:3000/credits?success=1"
    cancel_url: str   = "http://localhost:3000/credits?canceled=1"


class TopupRequest(BaseModel):
    user_id: str
    credits: int


# DonateRequest model removed in v1.3 — Stripe card donations are disabled.
# Donation flow uses PromptPay QR + Buy Me a Coffee directly (no server round-trip).


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────

@router.post("/create-checkout-session")
def create_checkout_session(req: CheckoutRequest):
    """
    Create a Stripe Hosted Checkout session for credit purchase.
    Returns { checkout_url, session_id }
    """
    if not STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=503,
            detail="Stripe not configured. Set STRIPE_SECRET_KEY env var.",
        )

    total_satang = CREDIT_PACK_PRICES.get(req.amount)
    if not total_satang:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid credit amount. Valid packs: {sorted(CREDIT_PACK_PRICES.keys())}",
        )

    try:
        line_items = [
            {
                "price_data": {
                    "currency": "thb",
                    "product_data": {
                        "name": f"Thai GeoData Hub — {req.amount:,} Credits",
                        "description": "Download clipped spatial data (SHP, GeoJSON, KML)",
                    },
                    "unit_amount": total_satang,
                },
                "quantity": 1,
            }
        ]

        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=line_items,
            mode="payment",
            success_url=req.redirect_url + f"&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=req.cancel_url,
            metadata={
                "user_id": str(req.user_id),
                "credits": str(req.amount),
            },
            billing_address_collection="auto",
        )

        log.info(f"Stripe checkout session created: {session.id} for user {req.user_id}")
        return {
            "checkout_url": session.url,
            "session_id": session.id,
        }

    except stripe.InvalidRequestError as e:
        log.error(f"Stripe error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"Unexpected error creating checkout: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# /donate endpoint removed in v1.3 — Stripe card donations disabled.
# Project is donation-only via PromptPay QR + Buy Me a Coffee; no Stripe needed.


@router.get("/credits/{user_id}")
def get_credits(user_id: str):
    """Get current credit balance for a user."""
    credits = get_user_credits_db(user_id)
    if credits < 0:
        return {"user_id": user_id, "credits": 0, "mode": "demo"}
    return {"user_id": user_id, "credits": credits, "mode": "db"}


@router.post("/credits/topup")
def manual_topup(req: TopupRequest):
    """Manually add credits (admin use or testing without Stripe)."""
    ok = add_credits_db(req.user_id, req.credits)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to update credits")
    new_total = get_user_credits_db(req.user_id)
    return {
        "user_id": req.user_id,
        "credits_added": req.credits,
        "new_total": new_total,
    }


@router.post("/credits/deduct")
def deduct_credits(user_id: str, amount: int):
    """Deduct credits before a download starts."""
    ok = deduct_credits_db(user_id, amount)
    if not ok:
        raise HTTPException(status_code=402, detail="Insufficient credits")
    return {"user_id": user_id, "deducted": amount, "success": True}


@router.post("/webhook")
async def stripe_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Handle Stripe webhook events.
    - checkout.session.completed → add credits to user
    """
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(payload, sig, STRIPE_WEBHOOK_SECRET)
    except stripe.SignatureVerificationError as e:
        log.error(f"Webhook signature verification failed: {e}")
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception as e:
        log.error(f"Webhook error: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    log.info(f"Stripe webhook received: {event['type']}")

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        user_id  = session.get("metadata", {}).get("user_id", "")
        credits  = session.get("metadata", {}).get("credits", "0")

        if user_id and credits:
            background_tasks.add_task(_add_credits_task, user_id, int(credits))
            log.info(f"Queued credit add: user={user_id}, credits={credits}")
        else:
            log.warning(f"Webhook missing metadata in session {session.get('id')}")

    return JSONResponse({"received": True})


def _add_credits_task(user_id: str, credits: int):
    """Background task to add credits after payment confirmed."""
    add_credits_db(user_id, credits)
    log.info(f"Credits added via webhook: user={user_id}, amount={credits}")


@router.get("/prices")
def get_credit_prices():
    """Return available credit packs and their prices."""
    return [
        {"credits": 100,  "price_thb": 100,  "label": "Starter Pack"},
        {"credits": 500,  "price_thb": 450,  "label": "Explorer Pack", "popular": True},
        {"credits": 1000, "price_thb": 800,  "label": "Professional Pack"},
        {"credits": 5000, "price_thb": 3500, "label": "Enterprise Pack"},
    ]