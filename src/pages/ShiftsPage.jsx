import React, { useCallback, useEffect, useState } from "react";
import {
  FaPlus,
  FaTimes,
  FaSync,
  FaArrowLeft,
  FaArrowDown,
  FaArrowUp,
  FaExchangeAlt,
  FaCalculator,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { getUser } from "../utils/auth";
import {
  getShifts,
  getActiveShift,
  getShift,
  getShiftMovements,
  canCloseShiftClient,
} from "../services/shiftService";
import OpenShiftDialog from "../components/shift/OpenShiftDialog";
import CloseShiftDialog from "../components/shift/CloseShiftDialog";
import "./ShiftsPage.css";

const currency = (v) =>
  `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MOVEMENT_LABELS = {
  sale: { label: "Sale", icon: <FaArrowUp />, sign: "+" },
  refund: { label: "Refund", icon: <FaArrowDown />, sign: "-" },
  paid_in: { label: "Paid in", icon: <FaArrowUp />, sign: "+" },
  paid_out: { label: "Paid out", icon: <FaArrowDown />, sign: "-" },
  drop: { label: "Cash drop", icon: <FaArrowDown />, sign: "-" },
  pickup: { label: "Cash pickup", icon: <FaArrowUp />, sign: "+" },
  no_sale: { label: "No-sale", icon: <FaExchangeAlt />, sign: "±" },
  adjustment: { label: "Adjustment", icon: <FaCalculator />, sign: "±" },
};

// Local modal wrapper for the close + detail dialogs. (OpenShiftDialog
// is shared via ../components/shift/OpenShiftDialog.)
const Modal = ({ open, title, onClose, children, footer }) => {
  if (!open) return null;
  return (
    <div className="sh-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sh-modal">
        <header className="sh-modal-header">
          <h2>{title}</h2>
          <button type="button" className="sh-modal-close" onClick={onClose}>
            <FaTimes />
          </button>
        </header>
        <div className="sh-modal-body">{children}</div>
        {footer && <footer className="sh-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
};

const ShiftDetail = ({ shiftId, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [shift, recon, movements] = await Promise.all([
        getShift(shiftId),
        getShiftReconciliation(shiftId),
        getShiftMovements(shiftId),
      ]);
      setData({ shift, recon, movements });
    } catch (err) {
      setError(err?.body?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) return <div className="sh-loading">Loading shift…</div>;
  if (error) return <div className="sh-banner sh-banner-error">{error}</div>;
  if (!data) return null;
  const { shift, recon, movements } = data;
  return (
    <div className="sh-detail">
      <header className="sh-detail-header">
        <div>
          <span className="sh-mono">{shift.id}</span>
          <span className={`sh-pill sh-pill-${shift.status}`}>{shift.status}</span>
        </div>
        <button type="button" className="sh-btn sh-btn-secondary" onClick={onClose}>
          <FaTimes /> Close
        </button>
      </header>
      <div className="sh-reconcile-grid sh-reconcile-grid-wide">
        <div>
          <span>Opened by</span>
          <strong>
            {shift.openedByUser
              ? `${shift.openedByUser.email} (${shift.openedByUser.role})`
              : shift.openedBy || "—"}
          </strong>
        </div>
        <div>
          <span>Opened at</span>
          <strong>
            {String(shift.openedAt || "")
              .replace("T", " ")
              .slice(0, 19)}
          </strong>
        </div>
        <div>
          <span>Opening float</span>
          <strong>{currency(shift.openingFloat)}</strong>
        </div>
        <div>
          <span>Branch</span>
          <strong>
            {shift.branchName
              ? `${shift.branchName} · ${shift.storeType}/${shift.storeId || ""}`
              : `${shift.storeType}/${shift.storeId || ""}`}
          </strong>
        </div>
        <div>
          <span>Customer</span>
          <strong>{shift.customerEmail || "—"}</strong>
        </div>
        {shift.closedBy && (
          <>
            <div>
              <span>Closed by</span>
              <strong>
                {shift.closedByUser
                  ? `${shift.closedByUser.email} (${shift.closedByUser.role})`
                  : shift.closedBy || "—"}
              </strong>
            </div>
            <div>
              <span>Closed at</span>
              <strong>
                {String(shift.closedAt || "")
                  .replace("T", " ")
                  .slice(0, 19)}
              </strong>
            </div>
            <div>
              <span>Closing cash</span>
              <strong>{currency(shift.closingCash)}</strong>
            </div>
          </>
        )}
        <div>
          <span>Total sales</span>
          <strong>{shift.totalSales == null ? "—" : currency(shift.totalSales)}</strong>
        </div>
        <div>
          <span>Expected cash</span>
          <strong>{currency(recon?.expectedCash ?? shift.expectedCash)}</strong>
        </div>
        {shift.variance != null && (
          <div
            className={shift.variance < 0 ? "sh-negative" : shift.variance > 0 ? "sh-positive" : ""}
          >
            <span>Variance</span>
            <strong>{currency(shift.variance)}</strong>
          </div>
        )}
      </div>
      <h3>Cash movements ({movements.length})</h3>
      {movements.length === 0 ? (
        <div className="sh-empty">No movements recorded.</div>
      ) : (
        <table className="sh-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th className="sh-num">Amount</th>
              <th>Reason / Ref</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => {
              const meta = MOVEMENT_LABELS[m.type] || { label: m.type, sign: "?" };
              return (
                <tr key={m.id}>
                  <td className="sh-mono">
                    {String(m.at || "")
                      .slice(0, 19)
                      .replace("T", " ")}
                  </td>
                  <td>
                    {meta.icon} {meta.label}
                  </td>
                  <td className={`sh-num ${m.amount < 0 ? "sh-negative" : "sh-positive"}`}>
                    {currency(m.amount)}
                  </td>
                  <td>{m.reason || (m.refType ? `${m.refType}·${m.refId}` : "—")}</td>
                  <td className="sh-mono">{m.userEmail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

const ShiftsPage = () => {
  const navigate = useNavigate();
  const currentUser = getUser();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(null);
  const [detail, setDetail] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getShifts());
    } catch (err) {
      if (err && err.status === 409) {
        setError("Shifts are not enabled for this store type.");
      } else {
        setError(err?.body?.error || err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // On first load, if there are no shifts and the user has no active
  // shift, auto-prompt the OpenShiftDialog so the cashier doesn't have
  // to hunt for the button. They can dismiss the dialog to land on
  // the empty state if they want to browse first.
  useEffect(() => {
    if (opening || rows.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const active = await getActiveShift();
        if (cancelled) return;
        if (!active) setOpening(true);
      } catch {
        /* non-cash store type — leave the page in its empty state */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  // Local toggle for whether the auto-prompt has been dismissed once
  // this session — we don't want it popping back up after every refetch.
  const [dismissedAuto, setDismissedAuto] = useState(false);
  useEffect(() => {
    if (opening && dismissedAuto) setOpening(false);
  }, [dismissedAuto, opening]);

  return (
    <div className="sh-page">
      <header className="sh-header">
        <button type="button" className="sh-back-btn" onClick={() => navigate(-1)}>
          <FaArrowLeft /> Back
        </button>
        <div>
          <h1>Shifts &amp; Cash Reconciliation</h1>
          <p className="sh-subtitle">
            Open / close drawer sessions · count cash at end-of-day · surface variance
          </p>
        </div>
        <button type="button" className="sh-btn sh-btn-primary" onClick={() => setOpening(true)}>
          <FaPlus /> Open shift
        </button>
      </header>

      {error && <div className="sh-banner sh-banner-error">{error}</div>}

      <section className="sh-section">
        <div className="sh-section-actions">
          <button
            type="button"
            className="sh-btn sh-btn-secondary"
            onClick={refresh}
            disabled={loading}
          >
            <FaSync className={loading ? "sh-spin" : ""} /> Refresh
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="sh-empty">No shifts recorded yet. Click "Open shift" to start one.</div>
        ) : (
          <table className="sh-table">
            <thead>
              <tr>
                <th>Opened</th>
                <th>Branch / Cashier</th>
                <th>Status</th>
                <th className="sh-num">Opening</th>
                <th className="sh-num">Total sales</th>
                <th className="sh-num">Closing</th>
                <th className="sh-num">Variance</th>
                <th className="sh-num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const opener = s.openedByUser
                  ? `${s.openedByUser.email} (${s.openedByUser.role || "?"})`
                  : s.openedBy || "—";
                const branch = s.branchName
                  ? `${s.branchName} · ${s.storeType}/${s.storeId || ""}`
                  : `${s.storeType}/${s.storeId || ""}`;
                const canClose = canCloseShiftClient(s, currentUser);
                return (
                  <tr key={s.id}>
                    <td className="sh-mono">
                      {String(s.openedAt || s.createdAt || "")
                        .slice(0, 19)
                        .replace("T", " ")}
                    </td>
                    <td>
                      <div>{branch || "—"}</div>
                      <div className="sh-meta-row">{opener}</div>
                    </td>
                    <td>
                      <span className={`sh-pill sh-pill-${s.status}`}>{s.status}</span>
                    </td>
                    <td className="sh-num">{currency(s.openingFloat)}</td>
                    <td className="sh-num">
                      {s.totalSales == null ? "—" : currency(s.totalSales)}
                    </td>
                    <td className="sh-num">
                      {s.closingCash == null ? "—" : currency(s.closingCash)}
                    </td>
                    <td
                      className={`sh-num ${s.variance < 0 ? "sh-negative" : s.variance > 0 ? "sh-positive" : ""}`}
                    >
                      {s.variance == null ? "—" : currency(s.variance)}
                    </td>
                    <td className="sh-num">
                      <button type="button" className="sh-row-btn" onClick={() => setDetail(s.id)}>
                        View
                      </button>
                      {s.status === "open" && canClose && (
                        <button
                          type="button"
                          className="sh-row-btn"
                          onClick={() => setClosing(s)}
                          title={`Close shift (your role: ${currentUser?.role || "?"})`}
                        >
                          <FaTimes />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <OpenShiftDialog
        open={opening}
        onClose={() => {
          setDismissedAuto(true);
          setOpening(false);
        }}
        onOpened={refresh}
      />
      <CloseShiftDialog
        open={Boolean(closing)}
        shift={closing}
        onClose={() => setClosing(null)}
        onClosed={refresh}
      />
      <Modal
        open={Boolean(detail)}
        title="Shift detail"
        onClose={() => setDetail(null)}
        footer={null}
      >
        {detail && <ShiftDetail shiftId={detail} onClose={() => setDetail(null)} />}
      </Modal>
    </div>
  );
};

export default ShiftsPage;
