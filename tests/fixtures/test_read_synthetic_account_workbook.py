from __future__ import annotations

import importlib.util
import random
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "scripts" / "read-synthetic-account-workbook.py"
SPEC = importlib.util.spec_from_file_location("synthetic_account_workbook_reader", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Workbook parser test setup failed.")
READER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(READER)

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types"


def tag(namespace: str, name: str) -> str:
    return f"{{{namespace}}}{name}"


def xml_bytes(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def create_runtime_workbook(path: Path, invalid_status: bool = False) -> list[dict[str, str]]:
    token = uuid.uuid4().hex
    rng = random.SystemRandom()
    roles = ["ADMIN", "Ketua RT", "Bendahara", "Warga", "Warga"]
    rows: list[dict[str, str]] = []
    repeated_resident_pin = rng.randrange(100, 99_999)
    for index, role in enumerate(roles):
        pin_value = repeated_resident_pin if role == "Warga" else rng.randrange(100_000, 999_999)
        rows.append(
            {
                "identifier": f"TEST-{token}-{index}",
                "name": f"Generated Test Person {token}-{index}",
                "status": "UNMAPPED_TEST_ROLE" if invalid_status and index == 0 else role,
                "pin": str(pin_value),
                "expected_pin": str(pin_value).zfill(6) if role == "Warga" else str(pin_value),
            }
        )

    ET.register_namespace("", MAIN_NS)
    ET.register_namespace("r", DOC_REL_NS)
    ET.register_namespace("rel", PACKAGE_REL_NS)
    ET.register_namespace("ct", CONTENT_TYPES_NS)

    workbook = ET.Element(tag(MAIN_NS, "workbook"))
    sheets = ET.SubElement(workbook, tag(MAIN_NS, "sheets"))
    ET.SubElement(sheets, tag(MAIN_NS, "sheet"), {"name": "TestSheet", "sheetId": "1", tag(DOC_REL_NS, "id"): "rId1"})

    relationships = ET.Element(tag(PACKAGE_REL_NS, "Relationships"))
    ET.SubElement(
        relationships,
        tag(PACKAGE_REL_NS, "Relationship"),
        {
            "Id": "rId1",
            "Type": "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
            "Target": "worksheets/sheet1.xml",
        },
    )

    styles = ET.Element(tag(MAIN_NS, "styleSheet"))
    number_formats = ET.SubElement(styles, tag(MAIN_NS, "numFmts"), {"count": "1"})
    ET.SubElement(number_formats, tag(MAIN_NS, "numFmt"), {"numFmtId": "164", "formatCode": "000000"})
    cell_formats = ET.SubElement(styles, tag(MAIN_NS, "cellXfs"), {"count": "2"})
    ET.SubElement(cell_formats, tag(MAIN_NS, "xf"), {"numFmtId": "0", "fontId": "0", "fillId": "0", "borderId": "0"})
    ET.SubElement(cell_formats, tag(MAIN_NS, "xf"), {"numFmtId": "164", "fontId": "0", "fillId": "0", "borderId": "0", "applyNumberFormat": "1"})

    worksheet = ET.Element(tag(MAIN_NS, "worksheet"))
    sheet_data = ET.SubElement(worksheet, tag(MAIN_NS, "sheetData"))

    def add_text_cell(row_node: ET.Element, reference: str, value: str) -> None:
        cell = ET.SubElement(row_node, tag(MAIN_NS, "c"), {"r": reference, "t": "inlineStr"})
        inline = ET.SubElement(cell, tag(MAIN_NS, "is"))
        text_node = ET.SubElement(inline, tag(MAIN_NS, "t"))
        text_node.text = value

    header_row = ET.SubElement(sheet_data, tag(MAIN_NS, "row"), {"r": "3"})
    for column, header in zip("BCDE", ("No. Rumah/ID", "Nama", "Status", "PIN")):
        add_text_cell(header_row, f"{column}3", header)

    for index, item in enumerate(rows, start=4):
        row_node = ET.SubElement(sheet_data, tag(MAIN_NS, "row"), {"r": str(index)})
        add_text_cell(row_node, f"B{index}", item["identifier"])
        add_text_cell(row_node, f"C{index}", item["name"])
        add_text_cell(row_node, f"D{index}", item["status"])
        cell_attributes = {"r": f"E{index}", "t": "n"}
        if item["status"] == "Warga":
            cell_attributes["s"] = "1"
        pin_cell = ET.SubElement(row_node, tag(MAIN_NS, "c"), cell_attributes)
        value_node = ET.SubElement(pin_cell, tag(MAIN_NS, "v"))
        value_node.text = item["pin"]

    content_types = ET.Element(tag(CONTENT_TYPES_NS, "Types"))
    ET.SubElement(content_types, tag(CONTENT_TYPES_NS, "Default"), {"Extension": "rels", "ContentType": "application/vnd.openxmlformats-package.relationships+xml"})
    ET.SubElement(content_types, tag(CONTENT_TYPES_NS, "Default"), {"Extension": "xml", "ContentType": "application/xml"})
    ET.SubElement(content_types, tag(CONTENT_TYPES_NS, "Override"), {"PartName": "/xl/workbook.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"})
    ET.SubElement(content_types, tag(CONTENT_TYPES_NS, "Override"), {"PartName": "/xl/worksheets/sheet1.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"})
    ET.SubElement(content_types, tag(CONTENT_TYPES_NS, "Override"), {"PartName": "/xl/styles.xml", "ContentType": "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"})

    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", xml_bytes(content_types))
        archive.writestr("xl/workbook.xml", xml_bytes(workbook))
        archive.writestr("xl/_rels/workbook.xml.rels", xml_bytes(relationships))
        archive.writestr("xl/worksheets/sheet1.xml", xml_bytes(worksheet))
        archive.writestr("xl/styles.xml", xml_bytes(styles))
    return rows


class SyntheticAccountWorkbookParserTests(unittest.TestCase):
    def test_reads_runtime_generated_roster_without_deduplicating_pin_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            workbook_path = Path(temporary_directory) / "runtime-generated.xlsx"
            expected = create_runtime_workbook(workbook_path)
            roster = READER.read_roster(workbook_path)

        success = len(roster) == 5
        success = success and all(
            roster[index]["identifier"] == expected[index]["identifier"]
            and roster[index]["name"] == expected[index]["name"]
            for index in range(5)
        )
        success = success and roster[3]["pin"] == roster[4]["pin"]
        success = success and roster[3]["pin"] == expected[3]["expected_pin"]
        success = success and roster[0]["role"] == "system_admin"
        success = success and roster[1]["role"] == "rt_chairman"
        success = success and roster[2]["role"] == "treasurer"
        success = success and roster[3]["role"] == "resident" and roster[4]["role"] == "resident"
        self.assertTrue(success, "Runtime-generated workbook roster validation failed.")

    def test_rejects_unmapped_role_with_generic_error(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            workbook_path = Path(temporary_directory) / "runtime-generated-invalid.xlsx"
            generated_rows = create_runtime_workbook(workbook_path, invalid_status=True)
            generated_identifier = generated_rows[0]["identifier"]
            generated_pin = generated_rows[0]["pin"]
            with self.assertRaises(READER._InvalidWorkbook) as raised:
                READER.read_roster(workbook_path)

        message = str(raised.exception)
        self.assertEqual(message, "Workbook input is invalid.")
        self.assertTrue(
            generated_identifier not in message and generated_pin not in message,
            "Workbook parser error exposed a generated field value.",
        )


if __name__ == "__main__":
    unittest.main()
