#!/usr/bin/env python3
"""Fail-closed, aggregate-only validation for the private KartuRT Sheet2 source."""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import re
import sys
import tempfile
import unicodedata
import uuid
from pathlib import Path
from typing import Any

import openpyxl


YEAR = 2026
AS_OF = dt.date(2026, 10, 27)
DUE_DAY = 10
EXPECTED_RESIDENT_ROWS = 73
DEFAULT_PRIVATE_MAP = Path("data/private/karturt-sheet2-import-manifest.json")

# All indices are relative to Sheet2 only. Sheet1 is never read.
COLUMN = {
    "house": 1,
    "name": 2,
    "phone": 3,
    "tariff": 5,
    "paid_from": 6,
    "paid_through": 7,
    "username": 8,
    "pin": 9,
    "access": 10,
}
HEADER_TOKENS = {
    "house": ("rumah", "alamat", "house"),
    "name": ("nama", "name"),
    "tariff": ("tarif", "iuran", "fee"),
    "paid_from": ("awal bayar", "mulai bayar", "from"),
    "paid_through": ("terakhir bayar", "akhir bayar", "through", "sampai"),
    "username": ("username", "nama pengguna", "user name"),
    "pin": ("pin",),
    "access": ("akses", "role", "peran"),
}
MONTHS = {
    "januari": 1, "january": 1, "jan": 1,
    "februari": 2, "february": 2, "feb": 2,
    "maret": 3, "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "mei": 5, "may": 5,
    "juni": 6, "june": 6, "jun": 6,
    "juli": 7, "july": 7, "jul": 7,
    "agustus": 8, "august": 8, "agu": 8, "ags": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "oktober": 10, "october": 10, "okt": 10, "oct": 10,
    "november": 11, "nov": 11,
    "desember": 12, "december": 12, "des": 12, "dec": 12,
}


class WorkbookValidationError(Exception):
    """Contains only aggregate-safe error codes."""

    def __init__(self, errors: collections.Counter[str]):
        self.errors = errors
        super().__init__("Sheet2 workbook failed aggregate validation.")


def _normalized_text(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def _normalized_key(value: Any) -> str:
    return _normalized_text(value).casefold()


def _month_value(value: Any) -> tuple[int | None, bool]:
    """Return (month, valid); yearless source month names inherit YEAR."""
    if value is None or _normalized_text(value) == "":
        return None, True
    if isinstance(value, (dt.datetime, dt.date)):
        return (value.month, value.year == YEAR)
    if isinstance(value, bool):
        return None, False
    if isinstance(value, int) and 1 <= value <= 12:
        return value, True

    tokens = re.findall(r"[a-z]+|\d+", _normalized_text(value).casefold())
    month = next((MONTHS[token] for token in tokens if token in MONTHS), None)
    years = [int(token) for token in tokens if token.isdigit()]
    if month is None or any(year != YEAR for year in years):
        return None, False
    if len(years) > 1:
        return None, False
    return month, True


def _classify_access(value: Any) -> str | None:
    label = _normalized_key(value)
    if not label:
        return None
    if "ketua" in label or "chairman" in label:
        return "chairman"
    if "bendahara" in label or "treasurer" in label:
        return "treasurer"
    if "admin" in label or "system admin" in label:
        return "system_admin"
    if "warga" in label or "resident" in label:
        return "resident"
    return None


def _header_value(sheet, row_number: int, column_index: int) -> str:
    return _normalized_key(sheet.cell(row=row_number, column=column_index + 1).value)


def _check_headers(sheet, errors: collections.Counter[str]) -> None:
    for key, tokens in HEADER_TOKENS.items():
        index = COLUMN[key]
        combined = " ".join((_header_value(sheet, 2, index), _header_value(sheet, 3, index)))
        if not any(token in combined for token in tokens):
            errors["unexpected_sheet2_header_mapping"] += 1


def _pin_value(cell) -> str:
    value = cell.value
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, int):
        text = str(value)
        if re.fullmatch(r"0{6}", cell.number_format or ""):
            return text.zfill(6)
        return text
    if isinstance(value, float) and value.is_integer():
        text = str(int(value))
        if re.fullmatch(r"0{6}", cell.number_format or ""):
            return text.zfill(6)
        return text
    return _normalized_text(value)


def _as_positive_integer(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if str(value).strip() not in (str(number), f"{number}.0") or number <= 0:
        return None
    return number


def read_and_validate(path: Path, *, include_pins: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    """Read the authoritative worksheet only and return (aggregate summary, private map)."""
    errors: collections.Counter[str] = collections.Counter()
    if not path.is_file():
        raise WorkbookValidationError(collections.Counter({"source_file_unavailable": 1}))

    try:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=False)
    except Exception:
        raise WorkbookValidationError(collections.Counter({"workbook_unreadable": 1})) from None

    try:
        try:
            sheet = workbook["Sheet2"]
        except KeyError:
            raise WorkbookValidationError(collections.Counter({"authoritative_sheet2_missing": 1}))
        _check_headers(sheet, errors)

        # Preserve source row numbers for a local mapping, but never emit them.
        raw_rows = list(sheet.iter_rows(min_row=4, max_col=11))
        while raw_rows and all(cell.value is None or _normalized_text(cell.value) == "" for cell in raw_rows[-1][1:]):
            raw_rows.pop()

        records: list[dict[str, Any]] = []
        house_keys: list[str] = []
        usernames: list[str] = []
        tariff_values: list[int] = []
        roles: collections.Counter[str] = collections.Counter()
        blank_ranges = 0
        partial_ranges = 0
        valid_ranges = 0
        invalid_ranges = 0
        paid_months_total = 0
        prepaid = collections.Counter()
        arrears = 0
        future_unpaid = 0

        for offset, cells in enumerate(raw_rows):
            source_row = offset + 4
            values = [cell.value for cell in cells]
            if all(value is None or _normalized_text(value) == "" for value in values[1:]):
                errors["blank_row_inside_roster"] += 1
                continue

            if any(cell.data_type == "f" for cell in cells[1:]):
                errors["formula_in_import_columns"] += 1

            house = _normalized_text(values[COLUMN["house"]])
            full_name = _normalized_text(values[COLUMN["name"]])
            phone = _normalized_text(values[COLUMN["phone"]]) or None
            username = _normalized_text(values[COLUMN["username"]])
            pin = _pin_value(cells[COLUMN["pin"]])
            role = _classify_access(values[COLUMN["access"]])
            tariff = _as_positive_integer(values[COLUMN["tariff"]])

            if not house:
                errors["missing_house_identifier"] += 1
            else:
                house_keys.append(_normalized_key(house))
            if not full_name:
                errors["missing_resident_name"] += 1
            if not username:
                errors["missing_username"] += 1
            else:
                usernames.append(_normalized_key(username))
            if not re.fullmatch(r"\d{6}", pin):
                errors["invalid_resident_pin_format"] += 1
            if role is None:
                errors["unknown_access_label"] += 1
            else:
                roles[role] += 1
            if tariff is None:
                errors["missing_or_invalid_tariff"] += 1
            else:
                tariff_values.append(tariff)

            start, start_valid = _month_value(values[COLUMN["paid_from"]])
            end, end_valid = _month_value(values[COLUMN["paid_through"]])
            if not start_valid or not end_valid:
                invalid_ranges += 1
                errors["invalid_payment_month"] += 1
                paid = set()
            elif start is None and end is None:
                blank_ranges += 1
                paid = set()
            elif start is None or end is None:
                partial_ranges += 1
                invalid_ranges += 1
                errors["partial_payment_range"] += 1
                paid = set()
            elif start > end:
                invalid_ranges += 1
                errors["reversed_payment_range"] += 1
                paid = set()
            else:
                valid_ranges += 1
                paid = set(range(start, end + 1))

            paid_months_total += len(paid)
            for month in range(1, 13):
                due_date = dt.date(YEAR, month, DUE_DAY)
                if month in paid:
                    if due_date > AS_OF:
                        prepaid[month] += 1
                elif due_date <= AS_OF:
                    arrears += 1
                else:
                    future_unpaid += 1

            record = {
                "sourceRow": source_row,
                "houseIdentifier": house,
                "fullName": full_name,
                "phone": phone,
                "username": username,
                "accessRole": role,
                "monthlyTariff": tariff,
                "paidMonths": sorted(paid),
            }
            if include_pins:
                record["pin"] = pin
            records.append(record)

        if len(records) != EXPECTED_RESIDENT_ROWS:
            errors["unexpected_roster_row_count"] += 1
        if len(house_keys) != len(set(house_keys)):
            errors["duplicate_house_identifier"] += len(house_keys) - len(set(house_keys))
        if len(usernames) != len(set(usernames)):
            errors["duplicate_username"] += len(usernames) - len(set(usernames))
        for privileged_role in ("chairman", "treasurer", "system_admin"):
            if roles[privileged_role] != 1:
                errors["privileged_role_cardinality"] += 1

        tariff_counts = collections.Counter(tariff_values)
        resident_count = len(records)
        official_count = roles["chairman"] + roles["treasurer"]
        admin_count = roles["system_admin"]
        summary = {
            "status": "PASS" if not errors else "BLOCKED",
            "source_sheet": "Sheet2",
            "sheet1_read": False,
            "year": YEAR,
            "as_of_date": AS_OF.isoformat(),
            "due_day": DUE_DAY,
            "resident_rows": resident_count,
            "unique_house_identifiers": len(set(house_keys)),
            "duplicate_house_identifiers": len(house_keys) - len(set(house_keys)),
            "unique_usernames": len(set(usernames)),
            "duplicate_usernames": len(usernames) - len(set(usernames)),
            "tariff_rows_valid": len(tariff_values),
            "missing_or_invalid_tariffs": errors["missing_or_invalid_tariff"],
            "tariff_class_counts": sorted(tariff_counts.values(), reverse=True),
            "roles": {key: roles[key] for key in ("chairman", "treasurer", "system_admin", "resident")},
            "resident_accounts": resident_count,
            "additional_official_accounts": official_count,
            "additional_system_admin_accounts": admin_count,
            "expected_total_accounts": resident_count + official_count + admin_count,
            "blank_payment_ranges": blank_ranges,
            "partial_payment_ranges": partial_ranges,
            "valid_payment_ranges": valid_ranges,
            "invalid_payment_ranges": invalid_ranges,
            "paid_household_months": paid_months_total,
            "prepaid_future_household_months": dict(sorted(prepaid.items())),
            "overdue_household_months": arrears,
            "unpaid_not_yet_due_household_months": future_unpaid,
            "expected_monthly_due_rows": resident_count * 12,
            "validation_errors": dict(sorted(errors.items())),
        }
        private_map = {
            "version": 1,
            "importBatchId": str(uuid.uuid4()),
            "sourceSheet": "Sheet2",
            "billingYear": YEAR,
            "dueDay": DUE_DAY,
            "asOfDate": AS_OF.isoformat(),
            "entries": records,
        }
        return summary, private_map
    finally:
        workbook.close()


def write_private_map(repository_root: Path, target: Path, private_map: dict[str, Any]) -> None:
    if any("pin" in entry for entry in private_map.get("entries", [])):
        raise WorkbookValidationError(collections.Counter({"pin_bearing_private_map_write_forbidden": 1}))
    root = repository_root.resolve()
    destination = target if target.is_absolute() else root / target
    destination = destination.resolve()
    private_directory = (root / "data" / "private").resolve()
    try:
        destination.relative_to(private_directory)
    except ValueError:
        raise WorkbookValidationError(collections.Counter({"private_map_path_outside_ignored_directory": 1})) from None
    if destination.exists():
        raise WorkbookValidationError(collections.Counter({"private_map_already_exists_refusing_overwrite": 1}))

    destination.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(private_map, ensure_ascii=False, separators=(",", ":")) + "\n"
    descriptor, temporary_name = tempfile.mkstemp(prefix="sheet2-map-", suffix=".tmp", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        # O_EXCL makes creation fail closed if another process won the race.
        os.link(temporary_name, destination)
    except FileExistsError:
        raise WorkbookValidationError(collections.Counter({"private_map_already_exists_refusing_overwrite": 1})) from None
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass
    try:
        os.chmod(destination, 0o600)
    except OSError:
        # Windows ACLs may not support POSIX mode bits; Git ignore still applies.
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the private Sheet2 workbook without exposing row values.")
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--_emit-private-import-payload", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument(
        "--write-private-map",
        nargs="?",
        const=DEFAULT_PRIVATE_MAP,
        default=None,
        type=Path,
        help="Write the private mapping under data/private/ only after all checks pass; PIN values are excluded.",
    )
    args = parser.parse_args()

    if args._emit_private_import_payload:
        expected_parent = os.environ.get("KARTURT_SHEET2_IMPORT_PARENT_PID", "")
        bridge_nonce = os.environ.get("KARTURT_SHEET2_IMPORT_BRIDGE_NONCE", "")
        if (
            os.environ.get("KARTURT_SHEET2_IMPORT_BRIDGE") != "1"
            or not expected_parent.isdigit()
            or int(expected_parent) != os.getppid()
            or not re.fullmatch(r"[0-9a-f]{32}", bridge_nonce)
        ):
            return 2
        try:
            summary, private_map = read_and_validate(args.workbook, include_pins=True)
            if summary["status"] != "PASS":
                return 2
            stable_batch_id = os.environ.get("KARTURT_SHEET2_IMPORT_BATCH_ID", "")
            if not re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", stable_batch_id, re.IGNORECASE):
                return 2
            private_map["importBatchId"] = stable_batch_id
            bridge_fields = ("houseIdentifier", "fullName", "username", "pin", "accessRole", "monthlyTariff", "paidMonths")
            private_map["entries"] = [
                {key: entry[key] for key in bridge_fields}
                for entry in private_map["entries"]
            ]
            print(json.dumps(private_map, ensure_ascii=False, separators=(",", ":")))
            return 0
        except WorkbookValidationError:
            return 2

    try:
        summary, private_map = read_and_validate(args.workbook)
        if summary["status"] != "PASS":
            print(json.dumps(summary, sort_keys=True))
            return 2
        if args.write_private_map is not None:
            write_private_map(Path.cwd(), args.write_private_map, private_map)
            summary["private_map_written"] = True
        print(json.dumps(summary, sort_keys=True))
        return 0
    except WorkbookValidationError as error:
        print(json.dumps({
            "status": "BLOCKED",
            "source_sheet": "Sheet2",
            "sheet1_read": False,
            "validation_errors": dict(sorted(error.errors.items())),
        }, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
