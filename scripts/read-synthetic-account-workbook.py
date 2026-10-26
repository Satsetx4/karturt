#!/usr/bin/env python3
"""Read the narrowly-scoped synthetic account roster from an XLSX workbook.

Successful CLI output is JSON for the calling TypeScript wrapper to capture.
Errors are deliberately generic and never include workbook contents or paths.
"""

from __future__ import annotations

import json
import posixpath
import re
import sys
import unicodedata
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"main": MAIN_NS, "rel": DOC_REL_NS, "package": PACKAGE_REL_NS}

EXPECTED_HEADERS = ("No. Rumah/ID", "Nama", "Status", "PIN")
ROLE_BY_STATUS = {
    "ADMIN": "system_admin",
    "Ketua RT": "rt_chairman",
    "Bendahara": "treasurer",
    "Warga": "resident",
}
EXPECTED_ROLE_COUNTS = {
    "system_admin": 1,
    "rt_chairman": 1,
    "treasurer": 1,
    "resident": 2,
}
INVALID_MESSAGE = "Workbook input is invalid."
MAX_ARCHIVE_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 128
MAX_XML_MEMBER_BYTES = 2 * 1024 * 1024


class _InvalidWorkbook(Exception):
    """A content-free validation failure."""


def _invalid() -> _InvalidWorkbook:
    return _InvalidWorkbook(INVALID_MESSAGE)


def _read_xml(archive: zipfile.ZipFile, member: str) -> ET.Element:
    try:
        info = archive.getinfo(member)
        if info.file_size > MAX_XML_MEMBER_BYTES:
            raise _invalid()
        raw = archive.read(member)
    except _InvalidWorkbook:
        raise
    except Exception:
        raise _invalid() from None

    upper = raw.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise _invalid()
    try:
        return ET.fromstring(raw)
    except Exception:
        raise _invalid() from None


def _load_shared_strings(archive: zipfile.ZipFile, members: set[str]) -> list[str]:
    member = "xl/sharedStrings.xml"
    if member not in members:
        return []
    root = _read_xml(archive, member)
    values: list[str] = []
    for item in root.findall(f"{{{MAIN_NS}}}si"):
        values.append("".join(node.text or "" for node in item.iter(f"{{{MAIN_NS}}}t")))
    return values


def _load_number_formats(
    archive: zipfile.ZipFile,
    members: set[str],
) -> tuple[list[int], dict[int, str]]:
    member = "xl/styles.xml"
    if member not in members:
        return [0], {}

    root = _read_xml(archive, member)
    custom_formats: dict[int, str] = {}
    num_formats = root.find(f"{{{MAIN_NS}}}numFmts")
    if num_formats is not None:
        for item in num_formats.findall(f"{{{MAIN_NS}}}numFmt"):
            try:
                format_id = int(item.attrib["numFmtId"])
                format_code = item.attrib["formatCode"]
            except Exception:
                raise _invalid() from None
            if format_id in custom_formats:
                raise _invalid()
            custom_formats[format_id] = format_code

    cell_formats = root.find(f"{{{MAIN_NS}}}cellXfs")
    if cell_formats is None:
        raise _invalid()

    style_format_ids: list[int] = []
    for item in cell_formats.findall(f"{{{MAIN_NS}}}xf"):
        try:
            style_format_ids.append(int(item.get("numFmtId", "0")))
        except Exception:
            raise _invalid() from None
    if not style_format_ids:
        raise _invalid()
    return style_format_ids, custom_formats


def _resolve_visible_sheet(archive: zipfile.ZipFile, members: set[str]) -> str:
    workbook = _read_xml(archive, "xl/workbook.xml")
    sheets_node = workbook.find(f"{{{MAIN_NS}}}sheets")
    if sheets_node is None:
        raise _invalid()
    sheets = sheets_node.findall(f"{{{MAIN_NS}}}sheet")
    visible = [sheet for sheet in sheets if sheet.get("state", "visible") == "visible"]
    if len(visible) != 1:
        raise _invalid()

    relationship_id = visible[0].get(f"{{{DOC_REL_NS}}}id")
    if not relationship_id:
        raise _invalid()

    relationships = _read_xml(archive, "xl/_rels/workbook.xml.rels")
    relationship_by_id: dict[str, ET.Element] = {}
    for relationship in relationships.findall(f"{{{PACKAGE_REL_NS}}}Relationship"):
        relationship_id_value = relationship.get("Id")
        if not relationship_id_value or relationship_id_value in relationship_by_id:
            raise _invalid()
        relationship_by_id[relationship_id_value] = relationship

    relationship = relationship_by_id.get(relationship_id)
    if relationship is None or relationship.get("TargetMode") == "External":
        raise _invalid()
    if not (relationship.get("Type") or "").endswith("/worksheet"):
        raise _invalid()

    target = relationship.get("Target")
    if not target or "\\" in target or "?" in target or "#" in target:
        raise _invalid()
    if target.startswith("/"):
        member = target.lstrip("/")
    else:
        member = posixpath.normpath(posixpath.join("xl", target))
    if not member.startswith("xl/") or ".." in member.split("/") or member not in members:
        raise _invalid()
    return member


def _column_number(letters: str) -> int:
    value = 0
    for character in letters:
        if not ("A" <= character <= "Z"):
            raise _invalid()
        value = value * 26 + ord(character) - ord("A") + 1
    return value


def _cell_coordinates(reference: str) -> tuple[int, int]:
    match = re.fullmatch(r"([A-Za-z]+)([1-9][0-9]*)", reference)
    if match is None:
        raise _invalid()
    column = _column_number(match.group(1).upper())
    try:
        row = int(match.group(2))
    except Exception:
        raise _invalid() from None
    return row, column


def _cell_value(cell: ET.Element, shared_strings: list[str]) -> tuple[str, Any] | None:
    if cell.find(f"{{{MAIN_NS}}}f") is not None:
        raise _invalid()
    value_node = cell.find(f"{{{MAIN_NS}}}v")
    cell_type = cell.get("t")

    if cell_type == "inlineStr":
        if value_node is not None:
            raise _invalid()
        inline = cell.find(f"{{{MAIN_NS}}}is")
        if inline is None:
            return "text", ""
        return "text", "".join(node.text or "" for node in inline.iter(f"{{{MAIN_NS}}}t"))

    if value_node is None or value_node.text is None:
        return None
    raw_value = value_node.text

    if cell_type == "s":
        try:
            index = int(raw_value)
            return "text", shared_strings[index]
        except Exception:
            raise _invalid() from None
    if cell_type == "str":
        return "text", raw_value
    if cell_type in (None, "n"):
        return "number", raw_value
    raise _invalid()


def _visible_columns_are_safe(sheet: ET.Element) -> None:
    columns = sheet.find(f"{{{MAIN_NS}}}cols")
    if columns is None:
        return
    for column in columns.findall(f"{{{MAIN_NS}}}col"):
        if column.get("hidden") not in ("1", "true", "TRUE"):
            continue
        try:
            first = int(column.attrib["min"])
            last = int(column.attrib["max"])
        except Exception:
            raise _invalid() from None
        if first <= 5 and last >= 2:
            raise _invalid()


def _render_pin(
    raw_value: str,
    style_index: str | None,
    style_format_ids: list[int],
    custom_formats: dict[int, str],
) -> str:
    try:
        style = int(style_index or "0")
        format_id = style_format_ids[style]
        value = Decimal(raw_value)
    except (InvalidOperation, ValueError, IndexError, TypeError):
        raise _invalid() from None
    except Exception:
        raise _invalid() from None

    if not value.is_finite() or value < 0 or value != value.to_integral_value() or raw_value.strip().startswith("-"):
        raise _invalid()
    integer_value = int(value)

    if format_id == 0:
        format_code = "General"
    elif format_id == 1:
        format_code = "0"
    else:
        format_code = custom_formats.get(format_id, "")

    if format_code.casefold() == "general" or format_code == "0":
        rendered = str(integer_value)
    elif re.fullmatch(r"0+", format_code):
        rendered = str(integer_value).zfill(len(format_code))
    else:
        raise _invalid()

    if re.fullmatch(r"[0-9]{6}", rendered) is None:
        raise _invalid()
    return rendered


def _identity_key(value: str) -> str:
    return unicodedata.normalize("NFKC", value.strip()).casefold()


def _parse_roster(path: Path) -> list[dict[str, str]]:
    if path.suffix.casefold() != ".xlsx" or not path.is_file():
        raise _invalid()
    try:
        if path.stat().st_size > MAX_ARCHIVE_BYTES:
            raise _invalid()
        with zipfile.ZipFile(path, "r") as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ARCHIVE_MEMBERS:
                raise _invalid()
            if sum(entry.file_size for entry in entries) > MAX_ARCHIVE_BYTES:
                raise _invalid()
            members = {entry.filename for entry in entries}
            for entry in entries:
                normalized_name = entry.filename.replace("\\", "/")
                if normalized_name.startswith("/") or ".." in normalized_name.split("/"):
                    raise _invalid()

            sheet_member = _resolve_visible_sheet(archive, members)
            shared_strings = _load_shared_strings(archive, members)
            style_format_ids, custom_formats = _load_number_formats(archive, members)
            worksheet = _read_xml(archive, sheet_member)
    except _InvalidWorkbook:
        raise
    except Exception:
        raise _invalid() from None

    _visible_columns_are_safe(worksheet)
    sheet_data = worksheet.find(f"{{{MAIN_NS}}}sheetData")
    if sheet_data is None:
        raise _invalid()

    expected_coordinates = {
        (row, column)
        for row in range(3, 9)
        for column in range(2, 6)
    }
    cells: dict[tuple[int, int], tuple[str, Any, ET.Element]] = {}
    seen_rows: set[int] = set()
    for row_node in sheet_data.findall(f"{{{MAIN_NS}}}row"):
        try:
            row_number = int(row_node.attrib["r"])
        except Exception:
            raise _invalid() from None
        if row_number in seen_rows:
            raise _invalid()
        seen_rows.add(row_number)
        if row_number in range(3, 9) and row_node.get("hidden") in ("1", "true", "TRUE"):
            raise _invalid()

        for cell in row_node.findall(f"{{{MAIN_NS}}}c"):
            coordinates = _cell_coordinates(cell.get("r", ""))
            if coordinates[0] != row_number or coordinates in cells:
                raise _invalid()
            parsed = _cell_value(cell, shared_strings)
            if parsed is None:
                continue
            kind, value = parsed
            if kind == "text" and value == "":
                continue
            if coordinates not in expected_coordinates:
                raise _invalid()
            cells[coordinates] = (kind, value, cell)

    header_values: list[str] = []
    for column, expected_header in zip(range(2, 6), EXPECTED_HEADERS):
        item = cells.get((3, column))
        if item is None or item[0] != "text" or item[1] != expected_header:
            raise _invalid()
        header_values.append(item[1])
    if tuple(header_values) != EXPECTED_HEADERS:
        raise _invalid()

    roster: list[dict[str, str]] = []
    identifier_keys: set[str] = set()
    name_keys: set[str] = set()
    role_counts = {role: 0 for role in EXPECTED_ROLE_COUNTS}

    for row_number in range(4, 9):
        identifier_cell = cells.get((row_number, 2))
        name_cell = cells.get((row_number, 3))
        status_cell = cells.get((row_number, 4))
        pin_cell = cells.get((row_number, 5))
        if any(item is None for item in (identifier_cell, name_cell, status_cell, pin_cell)):
            raise _invalid()

        assert identifier_cell is not None
        assert name_cell is not None
        assert status_cell is not None
        assert pin_cell is not None
        if identifier_cell[0] != "text" or name_cell[0] != "text" or status_cell[0] != "text":
            raise _invalid()

        identifier = identifier_cell[1]
        name = name_cell[1]
        source_role = status_cell[1]
        if not isinstance(identifier, str) or not identifier.strip():
            raise _invalid()
        if not isinstance(name, str) or not name.strip():
            raise _invalid()
        if not isinstance(source_role, str) or source_role not in ROLE_BY_STATUS:
            raise _invalid()

        identifier_key = _identity_key(identifier)
        name_key = _identity_key(name)
        if not identifier_key or not name_key or identifier_key in identifier_keys or name_key in name_keys:
            raise _invalid()
        identifier_keys.add(identifier_key)
        name_keys.add(name_key)

        if pin_cell[0] != "number":
            raise _invalid()
        pin = _render_pin(
            pin_cell[1],
            pin_cell[2].get("s"),
            style_format_ids,
            custom_formats,
        )
        role = ROLE_BY_STATUS[source_role]
        role_counts[role] += 1
        roster.append({"identifier": identifier, "name": name, "role": role, "pin": pin})

    if role_counts != EXPECTED_ROLE_COUNTS:
        raise _invalid()
    return roster


def read_roster(path: str | Path) -> list[dict[str, str]]:
    """Return the validated roster in memory without logging its contents."""
    try:
        return _parse_roster(Path(path))
    except _InvalidWorkbook:
        raise
    except Exception:
        raise _invalid() from None


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write(INVALID_MESSAGE + "\n")
        return 2
    try:
        roster = read_roster(sys.argv[1])
        sys.stdout.write(json.dumps(roster, ensure_ascii=False, separators=(",", ":")))
        return 0
    except Exception:
        sys.stderr.write(INVALID_MESSAGE + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
