"""v1 API router — aggregates all domain routers (wired in app.main)."""

from fastapi import APIRouter

from app.api.v1.routers import auth, billing, catalog, ops, orders, portal, quotes

api_router = APIRouter()
for module in (auth, billing, catalog, ops, orders, portal, quotes):
    api_router.include_router(module.router)
