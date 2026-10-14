"""Import hub — ensures all mappers are registered on app.models.base.Base."""

from app.models import (  # noqa: F401
    approvals,
    auth,
    base,
    billing,
    catalog,
    enums,
    fulfillment,
    ops,
    orders,
    policy,
    portal,
    quotes,
)
from app.models.approvals import ApprovalRequest  # noqa: F401
from app.models.auth import ApprovalDelegation, Profile, Team  # noqa: F401
from app.models.base import Base, BaseEntity, TimestampedEntity  # noqa: F401
from app.models.billing import (  # noqa: F401
    CreditAllocation,
    CreditNote,
    Invoice,
    InvoiceLine,
    Payment,
    PaymentAllocation,
    Refund,
    Subscription,
    SubscriptionChange,
)
from app.models.catalog import (  # noqa: F401
    Category,
    Customer,
    PriceRule,
    Product,
    ProductVariant,
    SubscriptionPlan,
)
from app.models.fulfillment import (  # noqa: F401
    Backorder,
    Reservation,
    Shipment,
    ShipmentLine,
    StockLevel,
    StockMovement,
    Warehouse,
)
from app.models.ops import (  # noqa: F401
    Alert,
    AppSetting,
    AuditEvent,
    IdempotencyRequest,
    JobLease,
    JobRun,
    Notification,
    OutboxEvent,
    ProcessedEvent,
)
from app.models.orders import Order, OrderLine  # noqa: F401
from app.models.policy import DiscountPolicy  # noqa: F401
from app.models.portal import NegotiationRequest  # noqa: F401
from app.models.quotes import (  # noqa: F401
    Quote,
    QuoteLine,
    QuoteRevision,
    RecommendationDismissal,
)
