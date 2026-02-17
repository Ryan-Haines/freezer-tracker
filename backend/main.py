from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, desc
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import os
import re
import json
import logging
import httpx

logger = logging.getLogger("freezer-tracker")

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/freezer.db")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OLLAMA_URL = os.getenv("OLLAMA_URL", "")  # e.g. http://host.docker.internal:11434 or http://localhost:11434
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
LLM_MODEL = os.getenv("LLM_MODEL", "")

VALID_UNITS = {"lbs", "g", "gallon", "count"}

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

PARSE_SYSTEM_PROMPT = (
    "You parse freezer inventory items. Given natural language, extract: "
    "name (string), quantity (number), unit (one of: lbs, g, gallon, count). "
    "Respond with ONLY valid JSON: {\"name\": \"...\", \"quantity\": ..., \"unit\": \"...\"}\n"
    "Rules:\n"
    "- quantity must ALWAYS be a number, never null. Default to 1 if unclear.\n"
    "- unit must ALWAYS be one of: lbs, g, gallon, count. Default to 'count' if unclear.\n"
    "- name should be the food item only, strip store names and unnecessary words.\n"
    "Examples:\n"
    "- \"2 lbs of chicken thighs\" → {\"name\": \"chicken thighs\", \"quantity\": 2, \"unit\": \"lbs\"}\n"
    "- \"a bag of frozen peas\" → {\"name\": \"frozen peas\", \"quantity\": 1, \"unit\": \"count\"}\n"
    "- \"500g ground beef\" → {\"name\": \"ground beef\", \"quantity\": 500, \"unit\": \"g\"}\n"
    "- \"about three and a half pounds of shrimp\" → {\"name\": \"shrimp\", \"quantity\": 3.5, \"unit\": \"lbs\"}\n"
    "- \"chicken drumsticks\" → {\"name\": \"chicken drumsticks\", \"quantity\": 1, \"unit\": \"count\"}\n"
    "- \"half gallon of ice cream\" → {\"name\": \"ice cream\", \"quantity\": 0.5, \"unit\": \"gallon\"}\n"
    "No markdown, no explanation, just JSON."
)


class FreezerItem(Base):
    __tablename__ = "freezer_items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String, nullable=False)
    date_added = Column(DateTime, default=datetime.utcnow)
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class InventoryMeta(Base):
    __tablename__ = "inventory_meta"

    id = Column(Integer, primary_key=True)
    last_updated = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ItemCreate(BaseModel):
    name: str
    quantity: float
    unit: str


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None


class NaturalInput(BaseModel):
    text: str


class ItemResponse(BaseModel):
    id: int
    name: str
    quantity: float
    unit: str
    date_added: datetime

    class Config:
        from_attributes = True


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def update_inventory_timestamp(db: Session):
    meta = db.query(InventoryMeta).first()
    if meta:
        meta.last_updated = datetime.utcnow()
    else:
        meta = InventoryMeta(last_updated=datetime.utcnow())
        db.add(meta)
    db.commit()


def _get_llm_provider() -> str:
    """Determine which LLM provider to use based on available env vars."""
    if OLLAMA_URL:
        return "ollama"
    if ANTHROPIC_API_KEY:
        return "anthropic"
    if OPENAI_API_KEY:
        return "openai"
    return "regex"


def validate_parsed(raw: dict) -> dict:
    """Validate and sanitize LLM output. Returns clean {name, quantity, unit} or raises."""
    name = raw.get("name")
    quantity = raw.get("quantity")
    unit = raw.get("unit")

    if not name or not isinstance(name, str) or len(name.strip()) == 0:
        raise ValueError("Missing or empty name")

    name = name.strip()

    # Fix quantity
    if quantity is None or quantity == "null":
        quantity = 1
    try:
        quantity = float(quantity)
    except (TypeError, ValueError):
        quantity = 1
    if quantity <= 0:
        quantity = 1

    # Fix unit
    if not unit or unit == "null" or unit not in VALID_UNITS:
        unit = "count"

    return {"name": name, "quantity": quantity, "unit": unit}


async def parse_with_ollama(text: str) -> dict:
    """Parse using a local Ollama instance."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": OLLAMA_MODEL,
                "messages": [
                    {"role": "system", "content": PARSE_SYSTEM_PROMPT},
                    {"role": "user", "content": text},
                ],
                "stream": False,
                "format": "json",
            },
            timeout=30.0,
        )
        response.raise_for_status()
        content = response.json()["message"]["content"].strip()
        return json.loads(content)


async def parse_with_anthropic(text: str) -> dict:
    """Parse using Anthropic Messages API."""
    model = LLM_MODEL or "claude-sonnet-4-20250514"
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 150,
                "messages": [{"role": "user", "content": text}],
                "system": PARSE_SYSTEM_PROMPT,
            },
            timeout=15.0,
        )
        response.raise_for_status()
        content = response.json()["content"][0]["text"].strip()
        return json.loads(content)


async def parse_with_openai(text: str) -> dict:
    """Parse using OpenAI Chat Completions API."""
    model = LLM_MODEL or "gpt-4o-mini"
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 150,
                "messages": [
                    {"role": "system", "content": PARSE_SYSTEM_PROMPT},
                    {"role": "user", "content": text},
                ],
            },
            timeout=15.0,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"].strip()
        return json.loads(content)


def parse_with_regex(text: str) -> dict:
    """Fallback regex parser for when no LLM is configured."""
    text = re.sub(r'^(add|update|set)\s+', '', text.lower().strip())

    patterns = [
        r'(\d+\.?\d*)\s*(lbs?|pounds?|g|grams?|gallon|count)\s+(?:of\s+)?(.+)',
        r'(\d+\.?\d*)\s+(.+?)\s*\((lbs?|pounds?|g|grams?|gallon|count)\)',
        r'(.+?)\s*[:\-]\s*(\d+\.?\d*)\s*(lbs?|pounds?|g|grams?|gallon|count)?',
    ]

    quantity = 1
    unit = "count"
    name = text

    for pattern in patterns:
        match = re.match(pattern, text)
        if match:
            groups = match.groups()
            if len(groups) == 3:
                if groups[0].replace('.', '').isdigit():
                    quantity = float(groups[0])
                    unit = groups[1].rstrip('s')
                    if unit in ['lb', 'pound']:
                        unit = 'lbs'
                    elif unit == 'gram':
                        unit = 'g'
                    name = groups[2].strip()
                else:
                    name = groups[0].strip()
                    quantity = float(groups[1])
                    unit = (groups[2] or 'count').rstrip('s')
                    if unit in ['lb', 'pound']:
                        unit = 'lbs'
                    elif unit == 'gram':
                        unit = 'g'
                break

    return {"name": name, "quantity": quantity, "unit": unit}


@app.on_event("startup")
def startup():
    provider = _get_llm_provider()
    model = OLLAMA_MODEL if provider == "ollama" else (LLM_MODEL or "default")
    logger.info(f"Natural language parsing: {provider} (model: {model})")
    if provider == "regex":
        logger.info("No LLM configured — using regex fallback. Set OLLAMA_URL, ANTHROPIC_API_KEY, or OPENAI_API_KEY for better parsing.")


@app.get("/api/items", response_model=list[ItemResponse])
def get_items(db: Session = Depends(get_db)):
    items = db.query(FreezerItem).order_by(desc(FreezerItem.quantity)).all()
    return items


@app.get("/api/last-updated")
def get_last_updated(db: Session = Depends(get_db)):
    meta = db.query(InventoryMeta).first()
    if meta:
        return {"last_updated": meta.last_updated.isoformat()}
    return {"last_updated": None}


@app.post("/api/items", response_model=ItemResponse)
def create_item(item: ItemCreate, db: Session = Depends(get_db)):
    db_item = FreezerItem(**item.model_dump())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    update_inventory_timestamp(db)
    return db_item


@app.put("/api/items/{item_id}", response_model=ItemResponse)
def update_item(item_id: int, item: ItemUpdate, db: Session = Depends(get_db)):
    db_item = db.query(FreezerItem).filter(FreezerItem.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")

    update_data = item.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_item, key, value)

    db.commit()
    db.refresh(db_item)
    update_inventory_timestamp(db)
    return db_item


@app.delete("/api/items/{item_id}")
def delete_item(item_id: int, db: Session = Depends(get_db)):
    db_item = db.query(FreezerItem).filter(FreezerItem.id == item_id).first()
    if not db_item:
        raise HTTPException(status_code=404, detail="Item not found")

    db.delete(db_item)
    db.commit()
    update_inventory_timestamp(db)
    return {"message": "Item deleted"}


@app.post("/api/parse", response_model=ItemResponse)
async def parse_natural_input(input_data: NaturalInput, db: Session = Depends(get_db)):
    provider = _get_llm_provider()
    parsed = None

    if provider != "regex":
        try:
            if provider == "ollama":
                raw = await parse_with_ollama(input_data.text)
            elif provider == "anthropic":
                raw = await parse_with_anthropic(input_data.text)
            elif provider == "openai":
                raw = await parse_with_openai(input_data.text)
            parsed = validate_parsed(raw)
        except Exception as e:
            logger.warning(f"{provider} parse failed, falling back to regex: {e}")

    if parsed is None:
        parsed = parse_with_regex(input_data.text)

    db_item = FreezerItem(
        name=parsed["name"],
        quantity=float(parsed["quantity"]),
        unit=parsed["unit"],
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    update_inventory_timestamp(db)
    return db_item
