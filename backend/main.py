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

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/freezer.db")

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class FreezerItem(Base):
    __tablename__ = "freezer_items"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    unit = Column(String, nullable=False)  # lbs, g, count
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

def seed_database(db: Session):
    if db.query(FreezerItem).count() > 0:
        return
    
    initial_items = [
        ("butter", 3, "lbs"),
        ("ground chicken", 3, "lbs"),
        ("lasagna", 1, "count"),
        ("salmon filets", 3, "lbs"),
        ("puff pastry roll", 1, "count"),
        ("hot pot package", 1, "count"),
        ("pizzas", 2, "count"),
        ("box croissants", 1, "count"),
        ("chicken drumsticks", 5, "lbs"),
        ("tenderloin", 700, "g"),
        ("boxes popsicles", 2, "count"),
        ("box teriyaki", 1, "count"),
        ("ground turkey", 1.5, "lbs"),
        ("chicken parmesan", 1, "count"),
        ("vanilla ice cream", 1, "gallon"),
        ("beef hot pot package", 1, "count"),
        ("package tenderloin", 1, "count"),
        ("ground wagyu", 3, "lbs"),
        ("dry aged steak", 1, "count"),
        ("churros", 800, "g"),
        ("buns", 4, "count"),
        ("bacon", 3, "lbs"),
        ("chicken drumsticks (small)", 1, "lbs"),
        ("garlic", 1, "count"),
    ]
    
    for name, qty, unit in initial_items:
        item = FreezerItem(name=name, quantity=qty, unit=unit)
        db.add(item)
    
    meta = InventoryMeta(last_updated=datetime.utcnow())
    db.add(meta)
    db.commit()

@app.on_event("startup")
def startup():
    db = SessionLocal()
    seed_database(db)
    db.close()

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
def parse_natural_input(input_data: NaturalInput, db: Session = Depends(get_db)):
    text = input_data.text.lower().strip()
    
    # Remove common prefixes
    text = re.sub(r'^(add|update|set)\s+', '', text)
    
    # Parse patterns like "2 lbs of chicken" or "3 count pizza"
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
    
    db_item = FreezerItem(name=name, quantity=quantity, unit=unit)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    update_inventory_timestamp(db)
    return db_item
