import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { isModeVisible } from './visibility';
import type { LayoutPage } from './types';
import './SettingsSearch.css';
import { useTranslation } from '../i18n';

export interface SettingsSearchBarProps {
  pages: LayoutPage[];
  onSelect: (key: string) => void;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  testIdPrefix?: string;
  autoFocus?: boolean;
  listenCtrlF?: boolean;
  placeholder?: string;
}

export const SettingsSearchBar: React.FC<SettingsSearchBarProps> = ({
  pages,
  onSelect,
  searchQuery: controlledQuery,
  onSearchQueryChange,
  testIdPrefix = '',
  autoFocus = false,
  listenCtrlF = false,
  placeholder
}) => {
  const { t } = useTranslation();
  const { configDefs, settingsMode, rulesState } = useAppStore();

  const [internalQuery, setInternalQuery] = useState<string>('');
  const isControlled = controlledQuery !== undefined;
  const currentQuery = isControlled ? controlledQuery : internalQuery;

  const updateQuery = (val: string) => {
    if (isControlled) {
      onSearchQueryChange?.(val);
    } else {
      setInternalQuery(val);
    }
  };

  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLDivElement>(null);

  // Auto focus on open if requested
  useEffect(() => {
    if (autoFocus) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  // Global Ctrl+F / Cmd+F handler to focus search box
  useEffect(() => {
    if (!listenCtrlF) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [listenCtrlF]);

  // Search results
  const trimmedQuery = currentQuery.trim();
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

            // Respect Simple/Advanced/Expert mode filter
            if (!isModeVisible(settingsMode, def?.mode)) continue;

            // Check field visibility from rulesState
            const ruleKey = line.index !== undefined ? `${k}#${line.index}` : k;
            const fieldState = rulesState.fields[ruleKey] || rulesState.fields[k];
            if (fieldState && fieldState.visible === false) continue;

            const baseLabel = fieldState?.label || def?.label || k;
            const localizedLabel = t(baseLabel);
            const localizedPage = t(page.title);

            if (
              k.toLowerCase().includes(q) ||
              baseLabel.toLowerCase().includes(q) ||
              localizedLabel.toLowerCase().includes(q)
            ) {
              seenKeys.add(k);
              searchResults.push({
                key: k,
                label: localizedLabel,
                pageTitle: localizedPage
              });
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
    if (!trimmedQuery) {
      setActiveIndex(-1);
      setIsDismissed(false);
    }
  }, [trimmedQuery]);

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
    onSelect(key);
    updateQuery('');
    setIsDismissed(false);
    setActiveIndex(-1);
  };

  const handleClear = () => {
    updateQuery('');
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
      if (isOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsDismissed(true);
        setActiveIndex(-1);
      }
    }
  };

  const prefix = testIdPrefix;
  const inputId = `${prefix}settings-search-input`;
  const resultsId = `${prefix}settings-search-results`;
  const noResultsId = `${prefix}settings-search-no-results`;

  return (
    <div className="settings-search-wrap">
      <input
        ref={inputRef}
        id={inputId}
        data-testid={`${prefix}settings-search`}
        type="text"
        className="settings-search-input"
        placeholder={placeholder || t("Search settings (Ctrl+F)")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={resultsId}
        aria-activedescendant={
          activeIndex >= 0 ? `${prefix}search-result-option-${activeIndex}` : undefined
        }
        value={currentQuery}
        onChange={(e) => {
          updateQuery(e.target.value);
          setIsDismissed(false);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
      />
      {currentQuery.length > 0 && (
        <button
          type="button"
          className="search-clear-btn"
          data-testid={`${prefix}search-clear-btn`}
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
          id={resultsId}
          className="search-results-dropdown"
          data-testid={`${prefix}search-results`}
          role={displayedResults.length > 0 ? 'listbox' : 'region'}
          aria-label={t("Search results")}
        >
          {displayedResults.length > 0 ? (
            displayedResults.map((r, idx) => (
              <div
                key={r.key}
                id={`${prefix}search-result-option-${idx}`}
                data-key={r.key}
                data-testid={`${prefix}search-result-item-${r.key}`}
                ref={idx === activeIndex ? activeItemRef : null}
                className={`search-result-item ${idx === activeIndex ? 'active' : ''}`}
                role="option"
                aria-selected={idx === activeIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={() => handleSelect(r.key)}
                onMouseMove={() => setActiveIndex(idx)}
              >
                <div className="search-result-info">
                  <span className="search-result-label">{r.label}</span>
                  <span className="search-result-page">{r.pageTitle}</span>
                </div>
              </div>
            ))
          ) : (
            <div
              id={noResultsId}
              className="search-no-results"
              data-testid={`${prefix}search-no-results`}
              role="status"
            >
              {t('No settings found for "{{query}}"', { query: trimmedQuery })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
