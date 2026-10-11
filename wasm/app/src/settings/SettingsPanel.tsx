import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { SettingsGroup } from './SettingsGroup';
import { isLineVisible } from './visibility';
import type { SettingsMode } from './types';
import './SettingsSearch.css';
import { useTranslation } from "../i18n";

export const SettingsPanel: React.FC = () => {
    const { t } = useTranslation();
  const {
    layout,
    configDefs,
    currentConfig,
    presetConfig,
    activePrintPage,
    setActivePrintPage,
    settingsMode,
    rulesState,
    setSettingsMode,
    searchQuery,
    setSearchQuery,
    jumpToOption,
    openSavePresetDialog,
  } = useAppStore();

  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);

  const printTab = layout?.tabs.find((t) => t.id === 'print');
  const pages = printTab?.pages || [];
  const currentPage = pages.find((p) => p.title === activePrintPage) || pages[0];

  // Helper to calculate modified count for a page
  const getModifiedCountForPage = (pageTitle: string): number => {
    const page = pages.find((p) => p.title === pageTitle);
    if (!page) return 0;

    let count = 0;
    const countedKeys = new Set<string>();

    for (const group of page.groups) {
      for (const line of group.lines) {
        const keysToCheck: string[] = [];
        if (line.key) keysToCheck.push(line.key);
        if (line.options) keysToCheck.push(...line.options);

        for (const k of keysToCheck) {
          if (countedKeys.has(k)) continue;
          countedKeys.add(k);

          const cur = currentConfig[k];
          const baseline = presetConfig[k];
          if (cur !== undefined && baseline !== undefined && cur !== baseline) {
            count++;
          }
        }
      }
    }
    return count;
  };

  // Search results
  const trimmedQuery = searchQuery.trim();
  const searchResults: Array<{ key: string; label: string; pageTitle: string }> = [];
  if (trimmedQuery.length > 0) {
    const q = trimmedQuery.toLowerCase();
    const seenKeys = new Set<string>();

    for (const page of pages) {
      for (const group of page.groups) {
        for (const line of group.lines) {
          const keys: string[] = [];
          if (line.key) keys.push(line.key);
          if (line.options) keys.push(...line.options);

          for (const k of keys) {
            if (seenKeys.has(k)) continue;
            const def = configDefs[k];
            const label = def?.label || k;
            if (k.toLowerCase().includes(q) || label.toLowerCase().includes(q)) {
              seenKeys.add(k);
              searchResults.push({ key: k, label, pageTitle: page.title });
            }
          }
        }
      }
    }
  }

  const displayedResults = searchResults.slice(0, 10);
  const hasQuery = trimmedQuery.length > 0;
  const isOpen = hasQuery && !isDismissed;

  // Reset activeIndex when query becomes empty
  useEffect(() => {
    if (!searchQuery.trim()) {
      setActiveIndex(-1);
      setIsDismissed(false);
    }
  }, [searchQuery]);

  // Ensure activeIndex is in valid bounds
  useEffect(() => {
    if (activeIndex >= displayedResults.length) {
      setActiveIndex(-1);
    }
  }, [displayedResults.length, activeIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && activeItemRef.current) {
      activeItemRef.current.scrollIntoView?.({ block: 'nearest' });
    }
  }, [activeIndex]);

  const handleSelect = (key: string) => {
    jumpToOption(key);
    setSearchQuery('');
    setIsDismissed(false);
    setActiveIndex(-1);
  };

  const handleClear = () => {
    setSearchQuery('');
    setIsDismissed(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (isDismissed) {
        setIsDismissed(false);
      }
      if (displayedResults.length > 0) {
        setActiveIndex((prev) => {
          if (prev === -1 || prev >= displayedResults.length - 1) {
            return 0;
          }
          return prev + 1;
        });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isDismissed) {
        setIsDismissed(false);
      }
      if (displayedResults.length > 0) {
        setActiveIndex((prev) => {
          if (prev <= 0) {
            return displayedResults.length - 1;
          }
          return prev - 1;
        });
      }
    } else if (e.key === 'Enter') {
      if (isOpen && activeIndex >= 0 && activeIndex < displayedResults.length) {
        e.preventDefault();
        handleSelect(displayedResults[activeIndex].key);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsDismissed(true);
      setActiveIndex(-1);
    }
  };

  return (
    <aside className="settings-panel" data-testid="settings-panel">
      {/* Top Header */}
      <div className="settings-header">
        <div className="settings-header-top">
          <div className="settings-title-wrap">
            <h2 className="settings-title">{t("Process Settings")}</h2>
            <button
              type="button"
              className="btn btn-secondary btn-xs save-preset-btn"
              data-testid="save-process-btn"
              title={t("Save current overrides as user process preset")}
              onClick={() => openSavePresetDialog('process')}
            >
              {t("💾 Save")}</button>
          </div>

          {/* Mode Switcher */}
          <div className="mode-switcher">
            <select
              value={settingsMode}
              data-testid="mode-select"
              className="mode-select"
              onChange={(e) => setSettingsMode(e.target.value as SettingsMode)}
            >
              <option value="simple">{t("Simple")}</option>
              <option value="advanced">{t("Advanced")}</option>
              <option value="expert">{t("Expert")}</option>
            </select>
          </div>
        </div>

        {/* Search Input */}
        <div className="settings-search-wrap">
          <label htmlFor="settings-search-input" className="sr-only">
            {t("Search settings")}</label>
          <input
            ref={inputRef}
            id="settings-search-input"
            type="text"
            className="settings-search-input"
            data-testid="settings-search"
            placeholder={t("🔍 Search settings...")}
            aria-label={t("Search settings")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            aria-controls={isOpen ? 'settings-search-results' : undefined}
            aria-activedescendant={
              isOpen && activeIndex >= 0 && activeIndex < displayedResults.length
                ? `search-result-option-${activeIndex}`
                : undefined
            }
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setIsDismissed(false);
              setActiveIndex(-1);
            }}
            onKeyDown={handleKeyDown}
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              className="search-clear-btn"
              data-testid="search-clear-btn"
              aria-label={t("Clear search")}
              title={t("Clear search")}
              onClick={handleClear}
            >
              ✕
            </button>
          )}

          {/* Search Dropdown */}
          {isOpen && (
            <div
              id="settings-search-results"
              className="search-results-dropdown"
              data-testid="search-results"
              role={displayedResults.length > 0 ? 'listbox' : 'region'}
              aria-label={t("Search results")}
            >
              {displayedResults.length > 0 ? (
                displayedResults.map((r, idx) => (
                  <div
                    key={r.key}
                    id={`search-result-option-${idx}`}
                    ref={activeIndex === idx ? activeItemRef : undefined}
                    role="option"
                    aria-selected={activeIndex === idx}
                    className={`search-result-item ${activeIndex === idx ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                    onClick={() => handleSelect(r.key)}
                    onMouseMove={() => setActiveIndex(idx)}
                  >
                    <span className="search-result-label">{r.label}</span>
                    <span className="search-result-page">{r.pageTitle}</span>
                  </div>
                ))
              ) : (
                <div
                  className="search-no-results"
                  data-testid="search-no-results"
                  role="status"
                >
                  {t("No settings found")}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pages Sub-tabs */}
      <div className="settings-tabs" role="tablist">
        {pages.map((page) => {
          const modCount = getModifiedCountForPage(page.title);
          return (
            <button
              key={page.title}
              role="tab"
              aria-selected={currentPage?.title === page.title}
              className={`tab-btn ${currentPage?.title === page.title ? 'active' : ''}`}
              data-testid={`page-tab-${page.title}`}
              onClick={() => setActivePrintPage(page.title)}
            >
              <span className="tab-title">{t(page.title)}</span>
              {modCount > 0 && (
                <span className="modified-badge" data-testid={`mod-count-${page.title}`}>
                  {modCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Page Content */}
      <div className="settings-content" data-testid="settings-content">
        {currentPage && currentPage.groups.length > 0 ? (
          currentPage.groups.some(group => group.lines.some(line => isLineVisible(line, settingsMode, configDefs, rulesState.fields)))
            ? currentPage.groups.map((group) => <SettingsGroup key={group.title} group={group} kind="print" />)
            : <div className="empty-page-placeholder">{t("No settings available in this mode.")}</div>
        ) : (
          <div className="empty-page-placeholder">
            <p>{t("Loading settings layout...")}</p>
          </div>
        )}
      </div>
    </aside>
  );
};
