"""Business time is India time (IST). DB timestamps are naive UTC; 'today' is an IST calendar day."""
from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def today() -> date:
    return datetime.now(IST).date()


def day_start_utc(d: date | None = None) -> datetime:
    """Naive-UTC datetime of IST midnight at the start of `d` (default: today)."""
    d = d or today()
    return datetime.combine(d, datetime.min.time(), tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)
