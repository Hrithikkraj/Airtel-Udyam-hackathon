"""Catalogue API: read products from the database."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import get_db
from .models import Product
from .schemas import ProductOut

router = APIRouter(prefix="/api/catalogue", tags=["catalogue"])


def to_product_out(product: Product) -> ProductOut:
    """Turn CSV-style text such as "P01|P02" into proper lists and true/false values."""
    return ProductOut(
        product_id=product.product_id,
        category=product.category,
        name=product.product_name,
        description=product.description,
        unit=product.unit,
        price_min_inr=product.price_min_inr_per_month,
        price_max_inr=product.price_max_inr_per_month,
        setup_fee_inr=product.one_time_setup_inr,
        min_contract_months=product.min_contract_months,
        city_tiers=[int(tier) for tier in product.available_city_tiers.split(";")],
        min_employees=product.min_employees,
        min_sites=product.min_sites,
        requires_gstin=product.requires_gstin == "Y",
        requires_one_of=product.requires_one_of.split("|") if product.requires_one_of else [],
        install_days=product.typical_install_days,
        target_segments=product.target_segments.split(";"),
    )


def load_catalogue(db: Session) -> dict[str, ProductOut]:
    """Every product, looked up by ID."""
    products = db.scalars(select(Product).order_by(Product.product_id)).all()
    return {product.product_id: to_product_out(product) for product in products}


@router.get("/products", response_model=list[ProductOut])
def list_products(db: Session = Depends(get_db)):
    return list(load_catalogue(db).values())
