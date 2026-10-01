/// UTC Gregorian month and day keys shared by subscription and transfer grants.
module subscription_manager::calendar;

/// Unix UTC day number used by the command grant's daily budget.
public(package) fun day(timestamp_ms: u64): u64 {
    timestamp_ms / 86_400_000
}

/// Return a monotonically increasing month key, day of month, and month length.
public(package) fun month(timestamp_ms: u64): (u64, u64, u64) {
    let mut days = timestamp_ms / 86_400_000;
    let mut year = 1970;
    loop {
        let year_days = if (is_leap(year)) 366 else 365;
        if (days < year_days) break;
        days = days - year_days;
        year = year + 1;
    };
    let mut month = 1;
    loop {
        let length = month_days(year, month);
        if (days < length) return (year * 12 + month - 1, days + 1, length);
        days = days - length;
        month = month + 1;
    }
}

fun is_leap(year: u64): bool {
    year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
}

fun month_days(year: u64, month: u64): u64 {
    if (month == 2) { if (is_leap(year)) 29 else 28 }
    else if (month == 4 || month == 6 || month == 9 || month == 11) 30
    else 31
}
