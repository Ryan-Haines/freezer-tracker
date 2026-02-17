from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, desc, func, ForeignKey, or_, CheckConstraint, and_, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from pydantic import BaseModel, validator
from datetime import datetime
from typing import Optional, List
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


class Container(Base):
    __tablename__ = "containers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=True)
    icon = Column(String, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Constraint: at least one of name or icon must be non-null
    __table_args__ = (
        CheckConstraint(
            or_(name.isnot(None), icon.isnot(None)),
            name='check_name_or_icon'
        ),
    )
    
    # Relationship to items
    items = relationship("FreezerItem", back_populates="container")


class FreezerItem(Base):
    __tablename__ = "freezer_items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String, nullable=False)
    date_added = Column(DateTime, default=datetime.utcnow)
    last_updated = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    container_id = Column(Integer, ForeignKey('containers.id'), nullable=True)
    
    # Relationship to container
    container = relationship("Container", back_populates="items")


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


class ContainerCreate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = 0
    
    @validator('name', 'icon')
    def check_name_or_icon(cls, v, values):
        if not values.get('name') and not v:
            raise ValueError('At least one of name or icon must be provided')
        return v


class ContainerUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None


class ContainerResponse(BaseModel):
    id: int
    name: Optional[str]
    icon: Optional[str]
    sort_order: int
    created_at: datetime

    class Config:
        from_attributes = True


class ItemCreate(BaseModel):
    name: str
    quantity: float
    unit: str
    container_id: Optional[int] = None


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    container_id: Optional[int] = None


class NaturalInput(BaseModel):
    text: str
    container_id: Optional[int] = None


class BulkParseInput(BaseModel):
    text: str
    container_id: int


class ItemResponse(BaseModel):
    id: int
    name: str
    quantity: float
    unit: str
    date_added: datetime
    container_id: Optional[int]

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


def migrate_database():
    """Handle database migrations"""
    db = SessionLocal()
    try:
        # Check if container_id column exists in freezer_items
        try:
            db.execute(text("SELECT container_id FROM freezer_items LIMIT 1"))
        except Exception:
            logger.info("Adding container_id column to freezer_items table")
            db.execute(text("ALTER TABLE freezer_items ADD COLUMN container_id INTEGER"))
            db.commit()
        
        # Create default container if none exist and assign existing items to it
        containers_count = db.query(Container).count()
        if containers_count == 0:
            logger.info("No containers found, creating default container")
            default_container = Container(
                name="Freezer Inventory",
                icon="🧊",
                sort_order=0
            )
            db.add(default_container)
            db.commit()
            db.refresh(default_container)
            
            # Assign all existing items to the default container
            items_without_container = db.query(FreezerItem).filter(FreezerItem.container_id.is_(None)).all()
            for item in items_without_container:
                item.container_id = default_container.id
            db.commit()
            logger.info(f"Assigned {len(items_without_container)} existing items to default container")
    finally:
        db.close()


@app.on_event("startup")
def startup():
    provider = _get_llm_provider()
    model = OLLAMA_MODEL if provider == "ollama" else (LLM_MODEL or "default")
    logger.info(f"Natural language parsing: {provider} (model: {model})")
    if provider == "regex":
        logger.info("No LLM configured — using regex fallback. Set OLLAMA_URL, ANTHROPIC_API_KEY, or OPENAI_API_KEY for better parsing.")
    
    # Run database migrations
    migrate_database()


# Container endpoints
@app.get("/api/containers", response_model=List[ContainerResponse])
def get_containers(db: Session = Depends(get_db)):
    containers = db.query(Container).order_by(Container.sort_order).all()
    return containers


@app.post("/api/containers", response_model=ContainerResponse)
def create_container(container: ContainerCreate, db: Session = Depends(get_db)):
    # Get the next sort_order
    max_sort = db.query(func.max(Container.sort_order)).scalar() or 0
    db_container = Container(
        name=container.name,
        icon=container.icon,
        sort_order=container.sort_order if container.sort_order is not None else max_sort + 1
    )
    db.add(db_container)
    db.commit()
    db.refresh(db_container)
    return db_container


@app.put("/api/containers/{container_id}", response_model=ContainerResponse)
def update_container(container_id: int, container: ContainerUpdate, db: Session = Depends(get_db)):
    db_container = db.query(Container).filter(Container.id == container_id).first()
    if not db_container:
        raise HTTPException(status_code=404, detail="Container not found")
    
    update_data = container.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_container, key, value)
    
    db.commit()
    db.refresh(db_container)
    return db_container


@app.delete("/api/containers/{container_id}")
def delete_container(container_id: int, db: Session = Depends(get_db)):
    db_container = db.query(Container).filter(Container.id == container_id).first()
    if not db_container:
        raise HTTPException(status_code=404, detail="Container not found")
    
    # Check if this is the only container
    containers_count = db.query(Container).count()
    if containers_count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the only container")
    
    # Delete all items in the container
    db.query(FreezerItem).filter(FreezerItem.container_id == container_id).delete()
    
    # Delete the container
    db.delete(db_container)
    db.commit()
    update_inventory_timestamp(db)
    return {"message": "Container and all its items deleted"}


@app.get("/api/items", response_model=list[ItemResponse])
def get_items(container_id: Optional[int] = Query(None), db: Session = Depends(get_db)):
    query = db.query(FreezerItem)
    if container_id is not None:
        query = query.filter(FreezerItem.container_id == container_id)
    items = query.order_by(desc(FreezerItem.quantity)).all()
    return items


@app.get("/api/last-updated")
def get_last_updated(db: Session = Depends(get_db)):
    meta = db.query(InventoryMeta).first()
    if meta:
        return {"last_updated": meta.last_updated.isoformat()}
    return {"last_updated": None}


@app.post("/api/items", response_model=ItemResponse)
def create_item(item: ItemCreate, db: Session = Depends(get_db)):
    # Case-insensitive duplicate check scoped to the same container — merge quantities if match found
    query = db.query(FreezerItem).filter(func.lower(FreezerItem.name) == item.name.strip().lower())
    
    if item.container_id is not None:
        query = query.filter(FreezerItem.container_id == item.container_id)
    else:
        query = query.filter(FreezerItem.container_id.is_(None))
    
    existing = query.first()
    if existing:
        existing.quantity += item.quantity
        db.commit()
        db.refresh(existing)
        update_inventory_timestamp(db)
        return existing

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

    # Case-insensitive duplicate check scoped to the same container — merge quantities if match found
    query = db.query(FreezerItem).filter(func.lower(FreezerItem.name) == parsed["name"].strip().lower())
    
    if input_data.container_id is not None:
        query = query.filter(FreezerItem.container_id == input_data.container_id)
    else:
        query = query.filter(FreezerItem.container_id.is_(None))
    
    existing = query.first()
    if existing:
        existing.quantity += float(parsed["quantity"])
        db.commit()
        db.refresh(existing)
        update_inventory_timestamp(db)
        return existing

    db_item = FreezerItem(
        name=parsed["name"],
        quantity=float(parsed["quantity"]),
        unit=parsed["unit"],
        container_id=input_data.container_id,
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    update_inventory_timestamp(db)
    return db_item


@app.post("/api/parse-bulk", response_model=List[ItemResponse])
async def parse_bulk_input(input_data: BulkParseInput, db: Session = Depends(get_db)):
    """Parse bulk text input, splitting by common delimiters and parsing each chunk"""
    import re
    
    # Split text by newlines, commas, periods, and semicolons
    chunks = re.split(r'[,.\n;]+', input_data.text.strip())
    chunks = [chunk.strip() for chunk in chunks if chunk.strip()]
    
    results = []
    provider = _get_llm_provider()
    
    for chunk in chunks:
        try:
            parsed = None
            
            if provider != "regex":
                try:
                    if provider == "ollama":
                        raw = await parse_with_ollama(chunk)
                    elif provider == "anthropic":
                        raw = await parse_with_anthropic(chunk)
                    elif provider == "openai":
                        raw = await parse_with_openai(chunk)
                    parsed = validate_parsed(raw)
                except Exception as e:
                    logger.warning(f"{provider} parse failed for chunk '{chunk}', falling back to regex: {e}")
            
            if parsed is None:
                parsed = parse_with_regex(chunk)
            
            # Case-insensitive duplicate check scoped to the same container
            query = db.query(FreezerItem).filter(
                and_(
                    func.lower(FreezerItem.name) == parsed["name"].strip().lower(),
                    FreezerItem.container_id == input_data.container_id
                )
            )
            existing = query.first()
            
            if existing:
                existing.quantity += float(parsed["quantity"])
                db.commit()
                db.refresh(existing)
                results.append(existing)
            else:
                db_item = FreezerItem(
                    name=parsed["name"],
                    quantity=float(parsed["quantity"]),
                    unit=parsed["unit"],
                    container_id=input_data.container_id,
                )
                db.add(db_item)
                db.commit()
                db.refresh(db_item)
                results.append(db_item)
                
        except Exception as e:
            logger.error(f"Failed to parse chunk '{chunk}': {e}")
            continue
    
    update_inventory_timestamp(db)
    return results
