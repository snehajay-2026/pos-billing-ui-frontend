// IndustryTemplateModal.jsx
//
// Modern, responsive industry picker for Service Billing. Wraps the
// existing industry-selection logic — does NOT replace it. The parent
// (ServiceBilling.jsx) owns the `selectIndustry` handler that the chip
// already uses; this modal is a pure UI shell that calls it.
//
// Visual:
//   - Centered modal on desktop / tablet (max-width 880px), full-screen
//     on phones (≤640px).
//   - Sticky header (icon + title + subtitle + close), sticky search
//     input, scrollable card grid (16 industries grouped by
//     INDUSTRY_GROUPS), preserved Extra Fields section, sticky footer
//     with Cancel + "Use <industry>" buttons.
//   - Empty-state when the search has no matches.
//
// A11y:
//   - role="dialog", aria-modal="true", aria-labelledby.
//   - Esc closes the modal.
//   - On close, the parent returns focus to the chip.

import React, { useEffect, useMemo, useRef } from "react";
import { FaBuilding, FaCheck, FaSearch, FaTimes } from "react-icons/fa";
import { INDUSTRIES, INDUSTRY_GROUPS } from "./templates";
import "./IndustryTemplateModal.css";

const IndustryTemplateModal = ({
  activeIndustry,
  activeIndustryId,
  activeFieldConfig,
  filledFieldCount,
  industryFieldCount,
  activeBill,
  isLocked,
  lockedSubtitle,
  industrySearch,
  setIndustrySearch,
  searchInputRef,
  onSelect,
  onClose,
  updateIndustryField,
}) => {
  // Refs for the focus trap. Cycle Tab between search → cards → field
  // inputs → footer buttons. We keep it minimal — focus the search on
  // mount, restore focus to the trigger chip on close (parent side).
  const modalRef = useRef(null);
  const cardRefs = useRef({});
  const fieldRefs = useRef({});

  // Live-filter the industry list by label + description (case-
  // insensitive substring). When the search is empty, render all
  // groups; when present, hide any group whose filtered list is empty.
  const trimmedSearch = (industrySearch || "").trim().toLowerCase();
  const filteredByGroup = useMemo(() => {
    const map = {};
    for (const group of INDUSTRY_GROUPS) {
      const items = INDUSTRIES.filter((i) => i.group === group.id);
      if (!trimmedSearch) {
        map[group.id] = items;
        continue;
      }
      map[group.id] = items.filter(
        (i) =>
          i.label.toLowerCase().includes(trimmedSearch) ||
          (i.description || "").toLowerCase().includes(trimmedSearch)
      );
    }
    return map;
  }, [trimmedSearch]);

  const visibleGroups = INDUSTRY_GROUPS.filter((g) => (filteredByGroup[g.id] || []).length > 0);
  const totalVisible = visibleGroups.reduce(
    (sum, g) => sum + (filteredByGroup[g.id] || []).length,
    0
  );

  // Esc-to-close. Mounted only while the modal is open (the parent
  // unmounts this component on close, so cleanup is automatic).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the modal on mount. Run after the next paint so
  // refs are settled.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      if (searchInputRef && searchInputRef.current) {
        searchInputRef.current.focus();
      } else if (modalRef.current) {
        modalRef.current.focus();
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [searchInputRef]);

  // Click-outside (scrim) closes — but ONLY when the scrim itself
  // receives the click. The modal contents call stopPropagation so
  // clicks inside the dialog don't accidentally close it.

  return (
    <div
      className="sv-itm-scrim"
      onClick={(e) => {
        // Anything outside the modal panel is the scrim — close.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="sv-itm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sv-itm-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <header className="sv-itm-head">
          <div className="sv-itm-head-icon" aria-hidden="true">
            <FaBuilding />
          </div>
          <div className="sv-itm-head-meta">
            <h2 id="sv-itm-title">Choose invoice template</h2>
            <p>
              {isLocked
                ? lockedSubtitle
                : "Pick the layout that fits this bill. Fields update instantly."}
            </p>
          </div>
          <button
            type="button"
            className="sv-itm-close"
            onClick={onClose}
            aria-label="Close industry picker"
          >
            <FaTimes />
          </button>
        </header>

        {/* SEARCH */}
        <div className="sv-itm-search-wrap">
          <label htmlFor="sv-itm-search" className="sv-itm-search-label">
            Search industries
          </label>
          <div className="sv-itm-search">
            <FaSearch className="sv-itm-search-icon" aria-hidden="true" />
            <input
              id="sv-itm-search"
              ref={searchInputRef}
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder="Search 16 industries — try “tech”, “med”, “trade”…"
              value={industrySearch}
              onChange={(e) => setIndustrySearch(e.target.value)}
              className="sv-itm-search-input"
            />
            {industrySearch && (
              <button
                type="button"
                className="sv-itm-search-clear"
                onClick={() => setIndustrySearch("")}
                aria-label="Clear search"
              >
                <FaTimes />
              </button>
            )}
          </div>
        </div>

        {/* BODY */}
        <div className="sv-itm-body">
          {totalVisible === 0 ? (
            <div className="sv-itm-empty">
              <div className="sv-itm-empty-icon" aria-hidden="true">
                <FaSearch />
              </div>
              <strong>No industries match “{trimmedSearch}”</strong>
              <span>Try a different word or clear the search.</span>
              <button
                type="button"
                className="sv-itm-empty-btn"
                onClick={() => setIndustrySearch("")}
              >
                Clear search
              </button>
            </div>
          ) : (
            visibleGroups.map((group) => (
              <section className="sv-itm-group" key={group.id}>
                <h3 className="sv-itm-group-head">
                  <span>{group.label}</span>
                  <small>
                    {(filteredByGroup[group.id] || []).length}{" "}
                    {trimmedSearch ? "matched" : "industries"}
                  </small>
                </h3>
                <div className="sv-itm-grid">
                  {(filteredByGroup[group.id] || []).map((industry) => {
                    const isActive = industry.id === activeIndustryId;
                    return (
                      <button
                        type="button"
                        key={industry.id}
                        ref={(el) => {
                          if (el) cardRefs.current[industry.id] = el;
                          else delete cardRefs.current[industry.id];
                        }}
                        className={`sv-itm-card${isActive ? " is-active" : ""}`}
                        style={{ "--card-accent": industry.accent }}
                        onClick={() => onSelect(industry.id)}
                        aria-pressed={isActive}
                        aria-label={`${industry.label} — ${industry.description || "Invoice template"}`}
                      >
                        {isActive && (
                          <span className="sv-itm-card-check" aria-hidden="true">
                            <FaCheck />
                          </span>
                        )}
                        <span className="sv-itm-card-icon" aria-hidden="true">
                          {industry.icon}
                        </span>
                        <span className="sv-itm-card-name">{industry.label}</span>
                        {industry.description && (
                          <span className="sv-itm-card-desc">{industry.description}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}

          {/* EXTRA FIELDS — preserved in-place per the brief: don't
              remove or relocate the existing per-industry fields UX.
              The picker is the headline; the fields are a follow-up. */}
          {activeFieldConfig.length > 0 && (
            <section className="sv-itm-fields">
              <header className="sv-itm-fields-head">
                <h3>
                  <span>{activeIndustry.label} — extra fields</span>
                </h3>
                <span
                  className={`sv-itm-fields-pill${
                    filledFieldCount === industryFieldCount && industryFieldCount > 0
                      ? " is-complete"
                      : ""
                  }`}
                >
                  {filledFieldCount}/{industryFieldCount} filled
                </span>
              </header>
              <div className="sv-itm-fields-grid">
                {activeFieldConfig.map((field) => (
                  <label
                    key={field.key}
                    ref={(el) => {
                      if (el) fieldRefs.current[field.key] = el;
                      else delete fieldRefs.current[field.key];
                    }}
                    className={`sv-itm-field${
                      (activeBill.fields || {})[field.key] ? " is-filled" : ""
                    }`}
                  >
                    <span className="sv-itm-field-label">
                      {field.label}
                      {field.required && (
                        <span className="sv-itm-field-required" aria-label="required">
                          *
                        </span>
                      )}
                    </span>
                    {field.type === "textarea" ? (
                      <textarea
                        className="sv-input sv-itm-field-input"
                        rows={2}
                        placeholder={field.placeholder}
                        value={(activeBill.fields || {})[field.key] || ""}
                        onChange={(e) => updateIndustryField(field.key, e.target.value)}
                      />
                    ) : (
                      <input
                        className="sv-input sv-itm-field-input"
                        type={field.type || "text"}
                        placeholder={field.placeholder}
                        value={(activeBill.fields || {})[field.key] || ""}
                        onChange={(e) => updateIndustryField(field.key, e.target.value)}
                      />
                    )}
                  </label>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* FOOTER */}
        <footer className="sv-itm-foot">
          {isLocked ? (
            <button
              type="button"
              className="sv-itm-foot-primary sv-itm-foot-primary-block"
              onClick={onClose}
            >
              Got it
            </button>
          ) : (
            <>
              <button type="button" className="sv-itm-foot-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="sv-itm-foot-primary"
                onClick={onClose}
                style={{ "--card-accent": activeIndustry.accent }}
              >
                Use {activeIndustry.label}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
};

export default IndustryTemplateModal;
