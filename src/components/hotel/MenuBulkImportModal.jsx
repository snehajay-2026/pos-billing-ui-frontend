import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  FaCloudUploadAlt,
  FaFileExcel,
  FaFileCsv,
  FaCheckCircle,
  FaExclamationTriangle,
  FaTimes,
  FaArrowRight,
  FaArrowLeft,
  FaDownload,
  FaInfoCircle,
  FaSyncAlt,
  FaSearch,
  FaCheck,
  FaTrash,
} from "react-icons/fa";
import { addProduct, updateProduct } from "../../services/productService";
import { useUi } from "../../context/UiContext";
import { createMenuBarcode } from "./hotelMenuBarcode";

/**
 * Canonical fields supported by bulk import. The order here is the order
 * shown in the mapping UI and the sample CSV template.
 *
 * `key`        — column key in the imported row (and on the saved product)
 * `label`      — human-readable label
 * `required`   — failing validation blocks the row from being imported
 * `aliases`    — accepted header names (case-insensitive, fuzzy)
 * `type`       — "string" | "number" | "boolean" | "category"
 * `hint`       — placeholder text shown in the template
 */
const BULK_FIELDS = [
  {
    key: "name",
    label: "Item Name",
    required: true,
    aliases: ["name", "item name", "item", "menu item", "dish", "dish name", "title"],
    type: "string",
    hint: "Paneer Butter Masala",
  },
  {
    key: "category",
    label: "Category",
    required: true,
    aliases: ["category", "cat", "type", "section", "menu category"],
    type: "category",
    hint: "Main Course",
  },
  {
    key: "subcategory",
    label: "Subcategory",
    required: false,
    aliases: ["subcategory", "sub category", "sub-category", "sub cat"],
    type: "string",
    hint: "North Indian",
  },
  {
    key: "price",
    label: "Price",
    required: true,
    aliases: ["price", "rate", "mrp", "amount", "cost"],
    type: "number",
    hint: "240",
  },
  {
    key: "halfPrice",
    label: "Half Price",
    required: false,
    aliases: ["half price", "half", "halfprice", "half-price"],
    type: "number",
    hint: "160",
  },
  {
    key: "fullPrice",
    label: "Full Price",
    required: false,
    aliases: ["full price", "full", "fullprice", "full-price"],
    type: "number",
    hint: "240",
  },
  {
    key: "unit",
    label: "Unit",
    required: false,
    aliases: ["unit", "uom", "unit of measure", "serving"],
    type: "string",
    hint: "plate",
  },
  {
    key: "gst",
    label: "Tax / GST %",
    required: false,
    aliases: ["gst", "tax", "tax %", "tax percent", "gst %", "vat"],
    type: "number",
    hint: "5",
  },
  {
    key: "hsn",
    label: "HSN / SAC",
    required: false,
    aliases: ["hsn", "sac", "hsn code", "hsn/sac", "hsn sac"],
    type: "string",
    hint: "9963",
  },
  {
    key: "stock",
    label: "Stock",
    required: false,
    aliases: ["stock", "qty", "quantity", "inventory"],
    type: "number",
    hint: "100",
  },
  {
    key: "lowStockLimit",
    label: "Low Stock Limit",
    required: false,
    aliases: ["low stock limit", "low stock", "limit", "reorder", "min stock"],
    type: "number",
    hint: "20",
  },
  {
    key: "description",
    label: "Description",
    required: false,
    aliases: ["description", "desc", "details", "notes", "note"],
    type: "string",
    hint: "Creamy tomato-based curry",
  },
  {
    key: "isVeg",
    label: "Veg? (yes/no)",
    required: false,
    aliases: ["veg", "vegetarian", "is veg", "isveg", "diet"],
    type: "boolean",
    hint: "yes",
  },
  {
    key: "isJain",
    label: "Jain? (yes/no)",
    required: false,
    aliases: ["jain", "is jain", "isjain"],
    type: "boolean",
    hint: "no",
  },
  {
    key: "spiceLevel",
    label: "Spice (mild/medium/hot)",
    required: false,
    aliases: ["spice", "spice level", "spicelevel", "heat"],
    type: "string",
    hint: "medium",
  },
  {
    key: "available",
    label: "Available (yes/no)",
    required: false,
    aliases: ["available", "in stock", "active", "enabled"],
    type: "boolean",
    hint: "yes",
  },
];

const normalizeHeader = (raw) =>
  String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const suggestMapping = (header, fields = BULK_FIELDS) => {
  const normalized = normalizeHeader(header);
  if (!normalized) return null;
  // 1. Exact alias match
  for (const field of fields) {
    if (field.aliases.some((a) => normalizeHeader(a) === normalized)) return field.key;
  }
  // 2. Contains match
  for (const field of fields) {
    if (field.aliases.some((a) => normalized.includes(normalizeHeader(a)))) return field.key;
  }
  // 3. Field key match
  for (const field of fields) {
    if (normalizeHeader(field.key) === normalized) return field.key;
  }
  return null;
};

const coerceBoolean = (raw) => {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (!v) return undefined;
  if (["yes", "y", "true", "1", "available", "active", "✓", "✔"].includes(v)) return true;
  if (["no", "n", "false", "0", "unavailable", "inactive", "✗", "✘"].includes(v)) return false;
  return undefined;
};

const coerceNumber = (raw) => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const cleaned = String(raw).replace(/[^\d.-]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
};

const normalizeSpiceLevel = (raw) => {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (!v) return undefined;
  if (v.startsWith("mild")) return "mild";
  if (v.startsWith("med")) return "medium";
  if (v.startsWith("hot") || v.startsWith("spicy") || v.startsWith("high")) return "hot";
  return undefined;
};

/**
 * Build a sample CSV that users can download, fill in, and re-upload.
 * Uses the canonical column order so re-import maps cleanly.
 */
const buildSampleCsv = () => {
  const headers = BULK_FIELDS.map((f) => f.label);
  const sampleRows = [
    [
      "Paneer Butter Masala",
      "Main Course",
      "North Indian",
      "240",
      "160",
      "240",
      "plate",
      "5",
      "9963",
      "100",
      "20",
      "Creamy tomato-based curry",
      "yes",
      "no",
      "medium",
      "yes",
    ],
    [
      "Veg Biryani",
      "Rice",
      "Hyderabadi",
      "180",
      "",
      "",
      "plate",
      "5",
      "9963",
      "80",
      "15",
      "Basmati rice cooked with fresh vegetables",
      "yes",
      "yes",
      "mild",
      "yes",
    ],
    [
      "Chicken Tikka",
      "Starters",
      "Tandoor",
      "320",
      "",
      "",
      "plate",
      "5",
      "9963",
      "60",
      "12",
      "Boneless chicken marinated in yogurt",
      "no",
      "no",
      "hot",
      "yes",
    ],
  ];
  const escapeCell = (value) => {
    const s = String(value ?? "");
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.map(escapeCell).join(",")];
  sampleRows.forEach((row) => lines.push(row.map(escapeCell).join(",")));
  return lines.join("\n");
};

const triggerDownload = (filename, content, mime) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
};

const MenuBulkImportModal = ({
  open,
  onClose,
  existingProducts = [],
  diningCategories = [],
  onImportComplete,
}) => {
  const { showToast } = useUi();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState("upload"); // upload | mapping | preview | importing | summary
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({}); // columnIndex -> fieldKey
  const [duplicateStrategy, setDuplicateStrategy] = useState("skip"); // skip | update | duplicate
  const [parseError, setParseError] = useState("");

  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [summary, setSummary] = useState(null); // { imported, updated, skipped, failed, errors: [] }

  // Reset on open/close
  useEffect(() => {
    if (!open) {
      // delay reset so the close animation can play
      const t = setTimeout(() => {
        setStep("upload");
        setFileName("");
        setHeaders([]);
        setRawRows([]);
        setMapping({});
        setParseError("");
        setImportProgress({ current: 0, total: 0 });
        setSummary(null);
      }, 250);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const handleDownloadTemplate = () => {
    triggerDownload("hotel-menu-template.csv", buildSampleCsv(), "text/csv;charset=utf-8");
    showToast("info", "Sample CSV template downloaded.");
  };

  const handleFile = async (file) => {
    if (!file) return;
    setParseError("");
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!["csv", "tsv", "xlsx", "xls"].includes(ext)) {
      setParseError(`Unsupported file type ".${ext}". Please upload a CSV, TSV, XLSX or XLS file.`);
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array", raw: false });
      const firstSheet = workbook.SheetNames[0];
      if (!firstSheet) {
        setParseError("No sheets found in the file.");
        return;
      }
      const sheet = workbook.Sheets[firstSheet];
      const json = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        blankrows: false,
        raw: false,
      });
      if (!Array.isArray(json) || json.length < 2) {
        setParseError(
          "File looks empty. Make sure the first row contains column headers and at least one menu item below."
        );
        return;
      }
      const [headerRow, ...dataRows] = json;
      const cleanHeaders = headerRow.map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
      const cleanRows = dataRows
        .filter((row) => Array.isArray(row) && row.some((c) => String(c ?? "").trim() !== ""))
        .map((row) => {
          // pad to header length so indexing works
          const padded = cleanHeaders.map((_, i) => row[i] ?? "");
          return padded;
        });

      setHeaders(cleanHeaders);
      setRawRows(cleanRows);
      setFileName(file.name);

      // auto-suggest mapping
      const suggested = {};
      cleanHeaders.forEach((h, idx) => {
        const guess = suggestMapping(h);
        if (guess) suggested[idx] = guess;
      });
      // make sure the required name + price + category are mapped; if not, try harder
      ["name", "price", "category"].forEach((requiredKey) => {
        const alreadyMapped = Object.values(suggested).includes(requiredKey);
        if (!alreadyMapped) {
          // try to find a header that's close
          const fallbackIdx = cleanHeaders.findIndex((h) =>
            normalizeHeader(h).includes(requiredKey)
          );
          if (fallbackIdx !== -1) suggested[fallbackIdx] = requiredKey;
        }
      });
      setMapping(suggested);
      setStep("mapping");
    } catch (err) {
      console.error("Bulk import parse error", err);
      setParseError(
        "We couldn't read this file. It may be password-protected or corrupted. Try re-saving as CSV and re-uploading."
      );
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  };

  // ----- Preview / validation -----
  const validationRows = useMemo(() => {
    if (step !== "preview" && step !== "importing" && step !== "summary") return [];
    const indexByField = Object.entries(mapping).reduce((acc, [colIdx, fieldKey]) => {
      acc[fieldKey] = Number(colIdx);
      return acc;
    }, {});

    const nameIdx = indexByField.name;
    const categoryIdx = indexByField.category;
    const priceIdx = indexByField.price;

    // existing items by normalized name (for duplicate detection)
    const existingByName = new Map(
      existingProducts.map((p) => [
        String(p.name || "")
          .trim()
          .toLowerCase(),
        p,
      ])
    );

    return rawRows.map((row, rowIndex) => {
      const cells = {};
      for (const field of BULK_FIELDS) {
        const idx = indexByField[field.key];
        if (idx === undefined) {
          cells[field.key] = { raw: "", value: undefined, mapped: false };
          continue;
        }
        const raw = row[idx];
        cells[field.key] = {
          raw: raw === undefined ? "" : String(raw),
          value: undefined,
          mapped: true,
        };
      }

      // Normalize per type
      if (cells.name) {
        const trimmed = String(cells.name.raw || "").trim();
        cells.name.value = trimmed;
      }
      if (cells.category) {
        cells.category.value = String(cells.category.raw || "").trim();
      }
      if (cells.subcategory) {
        cells.subcategory.value = String(cells.subcategory.raw || "").trim();
      }
      if (cells.price) {
        cells.price.value = coerceNumber(cells.price.raw);
      }
      if (cells.halfPrice) {
        cells.halfPrice.value = coerceNumber(cells.halfPrice.raw);
      }
      if (cells.fullPrice) {
        cells.fullPrice.value = coerceNumber(cells.fullPrice.raw);
      }
      if (cells.gst) {
        cells.gst.value = coerceNumber(cells.gst.raw);
      }
      if (cells.stock) {
        cells.stock.value = coerceNumber(cells.stock.raw);
      }
      if (cells.lowStockLimit) {
        cells.lowStockLimit.value = coerceNumber(cells.lowStockLimit.raw);
      }
      if (cells.unit) {
        cells.unit.value = String(cells.unit.raw || "").trim();
      }
      if (cells.hsn) {
        cells.hsn.value = String(cells.hsn.raw || "").trim();
      }
      if (cells.description) {
        cells.description.value = String(cells.description.raw || "").trim();
      }
      if (cells.isVeg) {
        cells.isVeg.value = coerceBoolean(cells.isVeg.raw);
      }
      if (cells.isJain) {
        cells.isJain.value = coerceBoolean(cells.isJain.raw);
      }
      if (cells.spiceLevel) {
        cells.spiceLevel.value = normalizeSpiceLevel(cells.spiceLevel.raw);
      }
      if (cells.available) {
        cells.available.value = coerceBoolean(cells.available.raw);
      }

      // ---- Errors ----
      const errors = [];
      if (!cells.name?.value) {
        errors.push("Item name is required");
      }
      if (!cells.category?.value) {
        errors.push("Category is required");
      }
      if (
        cells.price &&
        cells.price.mapped &&
        cells.price.raw !== "" &&
        cells.price.value === undefined
      ) {
        errors.push("Price must be a number");
      }
      if (!cells.price?.value && cells.price?.value !== 0) {
        errors.push("Price is required");
      }
      if (cells.price?.value !== undefined && cells.price.value < 0) {
        errors.push("Price cannot be negative");
      }
      if (cells.gst?.value !== undefined && (cells.gst.value < 0 || cells.gst.value > 100)) {
        errors.push("GST must be between 0 and 100");
      }
      if (cells.stock?.value !== undefined && cells.stock.value < 0) {
        errors.push("Stock cannot be negative");
      }

      // Duplicate detection
      let duplicateOf = null;
      if (cells.name?.value) {
        const match = existingByName.get(cells.name.value.toLowerCase());
        if (match) duplicateOf = match;
      }

      return {
        rowIndex,
        rowNumber: rowIndex + 2, // +1 for header, +1 for 1-indexed display
        cells,
        errors,
        valid: errors.length === 0,
        duplicateOf,
        duplicateStrategy,
      };
    });
  }, [step, mapping, rawRows, existingProducts, duplicateStrategy]);

  const validRowCount = useMemo(
    () => validationRows.filter((r) => r.valid).length,
    [validationRows]
  );
  const errorRowCount = useMemo(
    () => validationRows.filter((r) => !r.valid).length,
    [validationRows]
  );
  const duplicateRowCount = useMemo(
    () => validationRows.filter((r) => r.duplicateOf).length,
    [validationRows]
  );

  const categoryInferred = useMemo(() => {
    // auto-create categories for any unrecognized value the user is importing
    const known = new Set(diningCategories.map((c) => String(c).toLowerCase()));
    const inferred = new Set();
    validationRows.forEach((r) => {
      const cat = r.cells.category?.value;
      if (cat && !known.has(cat.toLowerCase())) inferred.add(cat);
    });
    return Array.from(inferred);
  }, [validationRows, diningCategories]);

  // ----- Import action -----
  const runImport = async () => {
    const rowsToImport = validationRows.filter((r) => r.valid);
    if (rowsToImport.length === 0) {
      showToast("error", "No valid rows to import.");
      return;
    }
    setStep("importing");
    setImportProgress({ current: 0, total: rowsToImport.length });

    const aggregated = {
      imported: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      created: [],
    };

    for (let i = 0; i < rowsToImport.length; i += 1) {
      const row = rowsToImport[i];
      const { cells } = row;
      const name = cells.name.value;

      // Decide action based on duplicate strategy
      if (row.duplicateOf) {
        if (duplicateStrategy === "skip") {
          aggregated.skipped += 1;
          setImportProgress({ current: i + 1, total: rowsToImport.length });
          // eslint-disable-next-line no-continue
          continue;
        }
      }

      const payload = {
        name,
        price: Number(cells.price.value) || 0,
        gst: Number(cells.gst?.value) || 0,
        // Only set stock when the user actually provided a value; otherwise
        // leave it undefined so the POS treats the item as available (rather
        // than out-of-stock just because stock wasn't filled in the sheet).
        stock: cells.stock?.value === undefined ? undefined : Number(cells.stock.value) || 0,
        lowStockLimit: Number(cells.lowStockLimit?.value) || 0,
        category: cells.category.value,
        subcategory: cells.subcategory?.value || undefined,
        unit: cells.unit?.value || "unit",
        barcode: createMenuBarcode(),
        description: cells.description?.value || "",
        available: cells.available?.value !== false,
        halfPrice: cells.halfPrice?.value === undefined ? null : Number(cells.halfPrice.value),
        fullPrice:
          cells.fullPrice?.value === undefined
            ? null
            : cells.price?.value !== undefined
              ? Number(cells.fullPrice.value)
              : Number(cells.fullPrice.value),
        hsn: cells.hsn?.value || "",
        isVeg: cells.isVeg?.value !== false, // default to veg if not specified
        isJain: cells.isJain?.value === true,
        spiceLevel: cells.spiceLevel?.value || "mild",
      };

      try {
        if (row.duplicateOf && duplicateStrategy === "update") {
          const updated = await updateProduct({ ...payload, id: row.duplicateOf.id });
          aggregated.updated += 1;
          aggregated.created.push(updated);
        } else {
          const created = await addProduct(payload);
          aggregated.imported += 1;
          aggregated.created.push(created);
        }
      } catch (err) {
        console.error(`Failed to import "${name}"`, err);
        aggregated.failed += 1;
        aggregated.errors.push({
          row: row.rowNumber,
          name,
          message: err?.message || "Server rejected this row",
        });
      }
      setImportProgress({ current: i + 1, total: rowsToImport.length });
    }

    setSummary(aggregated);
    setStep("summary");
    if (aggregated.failed === 0) {
      showToast(
        "success",
        `Imported ${aggregated.imported + aggregated.updated} item(s)${
          aggregated.skipped ? ` · ${aggregated.skipped} skipped` : ""
        }.`
      );
    } else {
      showToast(
        "error",
        `Imported ${aggregated.imported + aggregated.updated}, ${aggregated.failed} failed.`
      );
    }
    if (onImportComplete && aggregated.created.length) {
      onImportComplete(aggregated.created);
    }
  };

  // ----- Render helpers -----
  const renderUploadStep = () => (
    <>
      <div className="bulk-import-hero">
        <FaCloudUploadAlt className="bulk-import-hero-icon" aria-hidden="true" />
        <div>
          <h4>Bulk import menu items</h4>
          <p>
            Drop in a CSV, TSV, XLSX or XLS file. We&apos;ll auto-detect your columns, validate each
            row, and let you preview before anything is saved.
          </p>
        </div>
      </div>

      <div
        className="bulk-import-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        aria-label="Upload menu file"
      >
        <FaCloudUploadAlt className="bulk-import-dropzone-icon" aria-hidden="true" />
        <strong>Drag &amp; drop your file here</strong>
        <span>or click to browse — .csv, .tsv, .xlsx, .xls</span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: "none" }}
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {parseError && (
        <div className="bulk-import-error">
          <FaExclamationTriangle aria-hidden="true" />
          <span>{parseError}</span>
        </div>
      )}

      <div className="bulk-import-hints">
        <div className="bulk-import-hint-card">
          <FaFileCsv className="bulk-import-hint-icon" aria-hidden="true" />
          <div>
            <strong>Use our template</strong>
            <p>Download a ready-made CSV with all the columns pre-filled.</p>
          </div>
          <button
            type="button"
            className="hotel-menu-btn-secondary bulk-import-hint-cta"
            onClick={handleDownloadTemplate}
          >
            <FaDownload aria-hidden="true" /> Sample CSV
          </button>
        </div>
        <div className="bulk-import-hint-card">
          <FaInfoCircle className="bulk-import-hint-icon" aria-hidden="true" />
          <div>
            <strong>Required columns</strong>
            <p>Item name, price and category are mandatory. Everything else is optional.</p>
          </div>
        </div>
        <div className="bulk-import-hint-card">
          <FaSyncAlt className="bulk-import-hint-icon" aria-hidden="true" />
          <div>
            <strong>Duplicates?</strong>
            <p>You can skip existing items, update them in place, or import them as new copies.</p>
          </div>
        </div>
      </div>

      <div className="bulk-import-supported">
        <span className="bulk-import-supported-chip">
          <FaFileCsv aria-hidden="true" /> CSV
        </span>
        <span className="bulk-import-supported-chip">
          <FaFileExcel aria-hidden="true" /> XLSX / XLS
        </span>
        <span className="bulk-import-supported-chip">
          <FaFileCsv aria-hidden="true" /> TSV
        </span>
      </div>
    </>
  );

  const renderMappingStep = () => {
    const requiredFields = BULK_FIELDS.filter((f) => f.required).map((f) => f.key);
    const mappedFields = new Set(Object.values(mapping));
    const missingRequired = requiredFields.filter((f) => !mappedFields.has(f));

    return (
      <>
        <div className="bulk-import-mapping-summary">
          <div className="bulk-import-mapping-summary-item">
            <FaFileExcel aria-hidden="true" />
            <div>
              <span>File</span>
              <strong title={fileName}>{fileName}</strong>
            </div>
          </div>
          <div className="bulk-import-mapping-summary-item">
            <FaSearch aria-hidden="true" />
            <div>
              <span>Detected</span>
              <strong>
                {headers.length} columns · {rawRows.length} rows
              </strong>
            </div>
          </div>
          {missingRequired.length > 0 && (
            <div className="bulk-import-mapping-summary-item is-warn">
              <FaExclamationTriangle aria-hidden="true" />
              <div>
                <span>Map these required fields</span>
                <strong>{missingRequired.join(", ")}</strong>
              </div>
            </div>
          )}
        </div>

        <div className="bulk-import-mapping-table-wrap">
          <table className="bulk-import-mapping-table">
            <thead>
              <tr>
                <th style={{ width: "40%" }}>Column from file</th>
                <th style={{ width: "10%" }}>Sample</th>
                <th>Map to field</th>
              </tr>
            </thead>
            <tbody>
              {headers.map((header, idx) => {
                const sample = rawRows[0]?.[idx];
                const isMapped = mapping[idx] !== undefined;
                return (
                  <tr key={`${header}-${idx}`} className={isMapped ? "" : "is-unmapped"}>
                    <td>
                      <strong>{header}</strong>
                    </td>
                    <td className="bulk-import-mapping-sample">
                      {String(sample ?? "").slice(0, 24) || <em>—</em>}
                    </td>
                    <td>
                      <select
                        value={mapping[idx] || ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setMapping((prev) => {
                            const next = { ...prev };
                            // remove this column's prior mapping
                            delete next[idx];
                            // remove any OTHER column that was mapping to this new field
                            // (so two columns can't both claim the same field)
                            if (value) {
                              Object.keys(next).forEach((k) => {
                                if (next[k] === value) delete next[k];
                              });
                              next[idx] = value;
                            }
                            return next;
                          });
                        }}
                      >
                        <option value="">— Skip this column —</option>
                        {BULK_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? " *" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bulk-import-mapping-foot">
          <button
            type="button"
            className="hotel-menu-btn-secondary"
            onClick={() => setStep("upload")}
          >
            <FaArrowLeft aria-hidden="true" /> Change file
          </button>
          <button
            type="button"
            className="hotel-menu-btn-primary"
            disabled={missingRequired.length > 0}
            onClick={() => setStep("preview")}
          >
            Continue to preview <FaArrowRight aria-hidden="true" />
          </button>
        </div>
      </>
    );
  };

  const renderPreviewStep = () => {
    const validRows = validationRows.filter((r) => r.valid);
    return (
      <>
        <div className="bulk-import-preview-stats">
          <div className="bulk-import-stat ok">
            <FaCheckCircle aria-hidden="true" />
            <div>
              <strong>{validRowCount}</strong>
              <span>ready to import</span>
            </div>
          </div>
          <div className="bulk-import-stat error">
            <FaExclamationTriangle aria-hidden="true" />
            <div>
              <strong>{errorRowCount}</strong>
              <span>rows with errors</span>
            </div>
          </div>
          <div className="bulk-import-stat warn">
            <FaSyncAlt aria-hidden="true" />
            <div>
              <strong>{duplicateRowCount}</strong>
              <span>existing duplicates</span>
            </div>
          </div>
          <div className="bulk-import-stat info">
            <FaFileExcel aria-hidden="true" />
            <div>
              <strong>{rawRows.length}</strong>
              <span>total rows</span>
            </div>
          </div>
        </div>

        {categoryInferred.length > 0 && (
          <div className="bulk-import-info">
            <FaInfoCircle aria-hidden="true" />
            <span>
              New categories will be created automatically:{" "}
              <strong>{categoryInferred.join(", ")}</strong>
            </span>
          </div>
        )}

        <div className="bulk-import-duplicate-toggle">
          <span>If a row&apos;s name matches an existing item:</span>
          <div className="bulk-import-segmented">
            {[
              { value: "skip", label: "Skip", icon: FaTimes },
              { value: "update", label: "Update", icon: FaSyncAlt },
              { value: "duplicate", label: "Import as copy", icon: FaCheck },
            ].map((opt) => {
              const Icon = opt.icon;
              const active = duplicateStrategy === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={active ? "is-active" : ""}
                  onClick={() => setDuplicateStrategy(opt.value)}
                >
                  <Icon aria-hidden="true" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="bulk-import-preview-table-wrap">
          <table className="bulk-import-preview-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>#</th>
                <th>Status</th>
                <th>Item Name</th>
                <th>Category</th>
                <th>Price</th>
                <th>GST</th>
                <th>Stock</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {validationRows.map((row) => {
                const name = row.cells.name?.value || "—";
                const category = row.cells.category?.value || "—";
                const price = row.cells.price?.value;
                const gst = row.cells.gst?.value;
                const stock = row.cells.stock?.value;
                return (
                  <tr
                    key={row.rowIndex}
                    className={
                      !row.valid ? "is-error" : row.duplicateOf ? "is-duplicate" : "is-valid"
                    }
                  >
                    <td>{row.rowNumber}</td>
                    <td>
                      {!row.valid ? (
                        <span className="bulk-import-badge error">
                          <FaTimes aria-hidden="true" /> Error
                        </span>
                      ) : row.duplicateOf ? (
                        <span className="bulk-import-badge warn">
                          <FaSyncAlt aria-hidden="true" /> Duplicate
                        </span>
                      ) : (
                        <span className="bulk-import-badge ok">
                          <FaCheck aria-hidden="true" /> Ready
                        </span>
                      )}
                    </td>
                    <td className="bulk-import-preview-name">{name}</td>
                    <td>{category}</td>
                    <td>{price !== undefined ? `₹${price}` : "—"}</td>
                    <td>{gst !== undefined ? `${gst}%` : "—"}</td>
                    <td>{stock !== undefined ? stock : "—"}</td>
                    <td className="bulk-import-preview-notes">
                      {row.errors.length > 0 ? (
                        row.errors.join(" · ")
                      ) : row.duplicateOf ? (
                        <>
                          Matches existing item (will be{" "}
                          {duplicateStrategy === "skip"
                            ? "skipped"
                            : duplicateStrategy === "update"
                              ? "updated"
                              : "duplicated"}
                          )
                        </>
                      ) : (
                        <span className="bulk-import-preview-subtle">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bulk-import-preview-foot">
          <button
            type="button"
            className="hotel-menu-btn-secondary"
            onClick={() => setStep("mapping")}
          >
            <FaArrowLeft aria-hidden="true" /> Edit mapping
          </button>
          <button
            type="button"
            className="hotel-menu-btn-primary"
            disabled={validRows.length === 0}
            onClick={runImport}
          >
            <FaCloudUploadAlt aria-hidden="true" /> Import {validRows.length} item
            {validRows.length === 1 ? "" : "s"}
          </button>
        </div>
      </>
    );
  };

  const renderImportingStep = () => {
    const pct =
      importProgress.total > 0
        ? Math.round((importProgress.current / importProgress.total) * 100)
        : 0;
    return (
      <div className="bulk-import-progress">
        <FaCloudUploadAlt className="bulk-import-progress-icon" aria-hidden="true" />
        <h4>Importing {importProgress.total} item(s)…</h4>
        <p>Please don&apos;t close this window until the import is complete.</p>
        <div className="bulk-import-progress-bar">
          <div className="bulk-import-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="bulk-import-progress-count">
          {importProgress.current} / {importProgress.total}
        </span>
      </div>
    );
  };

  const renderSummaryStep = () => {
    if (!summary) return null;
    const total = summary.imported + summary.updated + summary.skipped + summary.failed;
    return (
      <>
        <div
          className={`bulk-import-summary-banner ${summary.failed ? "is-partial" : "is-success"}`}
        >
          <FaCheckCircle aria-hidden="true" />
          <div>
            <h4>
              {summary.failed === 0
                ? `Imported ${summary.imported + summary.updated} item(s) successfully`
                : `Imported ${summary.imported + summary.updated} of ${total} item(s)`}
            </h4>
            <p>Your menu is updated and ready to use in Hotel Billing.</p>
          </div>
        </div>

        <div className="bulk-import-summary-grid">
          <div className="bulk-import-summary-stat ok">
            <FaCheck aria-hidden="true" />
            <div>
              <strong>{summary.imported}</strong>
              <span>new items added</span>
            </div>
          </div>
          <div className="bulk-import-summary-stat update">
            <FaSyncAlt aria-hidden="true" />
            <div>
              <strong>{summary.updated}</strong>
              <span>existing items updated</span>
            </div>
          </div>
          <div className="bulk-import-summary-stat muted">
            <FaTimes aria-hidden="true" />
            <div>
              <strong>{summary.skipped}</strong>
              <span>duplicates skipped</span>
            </div>
          </div>
          <div className="bulk-import-summary-stat error">
            <FaExclamationTriangle aria-hidden="true" />
            <div>
              <strong>{summary.failed}</strong>
              <span>rows failed</span>
            </div>
          </div>
        </div>

        {summary.errors.length > 0 && (
          <div className="bulk-import-summary-errors">
            <div className="bulk-import-summary-errors-head">
              <FaExclamationTriangle aria-hidden="true" />
              <strong>Failed rows ({summary.errors.length})</strong>
            </div>
            <ul>
              {summary.errors.map((err, i) => (
                <li key={`${err.row}-${i}`}>
                  <span className="bulk-import-summary-errors-row">Row {err.row}</span>
                  <span className="bulk-import-summary-errors-name">{err.name}</span>
                  <span className="bulk-import-summary-errors-msg">{err.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="bulk-import-summary-foot">
          <button
            type="button"
            className="hotel-menu-btn-secondary"
            onClick={() => {
              setStep("upload");
              setSummary(null);
              setFileName("");
              setHeaders([]);
              setRawRows([]);
            }}
          >
            <FaCloudUploadAlt aria-hidden="true" /> Import another file
          </button>
          <button type="button" className="hotel-menu-btn-primary" onClick={onClose}>
            <FaCheck aria-hidden="true" /> Done
          </button>
        </div>
      </>
    );
  };

  if (!open) return null;

  const stepIndex = step === "upload" ? 0 : step === "mapping" ? 1 : step === "preview" ? 2 : 3;

  return (
    <div className="hotel-menu-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="hotel-menu-modal bulk-import-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-import-title"
      >
        <header className="hotel-menu-modal-head bulk-import-head">
          <div>
            <span className="hotel-menu-eyebrow bulk-import-kicker">
              <FaCloudUploadAlt aria-hidden="true" /> Bulk Import
            </span>
            <h4 id="bulk-import-title">Import menu items from a file</h4>
            <p>
              Upload CSV, TSV or Excel — we&apos;ll map the columns, validate each row, and let you
              confirm before saving.
            </p>
          </div>
          <button
            type="button"
            className="hotel-menu-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <FaTimes aria-hidden="true" />
          </button>
        </header>

        <div className="bulk-import-stepper" role="tablist" aria-label="Import steps">
          {[
            { key: "upload", label: "Upload" },
            { key: "mapping", label: "Map columns" },
            { key: "preview", label: "Preview" },
            { key: "importing", label: "Import" },
            { key: "summary", label: "Result" },
          ].map((s, idx) => {
            const state = idx < stepIndex ? "done" : idx === stepIndex ? "active" : "pending";
            return (
              <div key={s.key} className={`bulk-import-step is-${state}`} role="tab">
                <span className="bulk-import-step-dot">{idx + 1}</span>
                <span className="bulk-import-step-label">{s.label}</span>
              </div>
            );
          })}
        </div>

        <div className="hotel-menu-modal-body bulk-import-body">
          {step === "upload" && renderUploadStep()}
          {step === "mapping" && renderMappingStep()}
          {step === "preview" && renderPreviewStep()}
          {step === "importing" && renderImportingStep()}
          {step === "summary" && renderSummaryStep()}
        </div>

        {step === "upload" && (
          <footer className="hotel-menu-modal-foot">
            <button type="button" className="hotel-menu-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="hotel-menu-btn-secondary"
              onClick={handleDownloadTemplate}
            >
              <FaDownload aria-hidden="true" /> Download sample CSV
            </button>
          </footer>
        )}
      </div>
    </div>
  );
};

export default MenuBulkImportModal;
