import React, { useEffect, useRef } from 'react';
import './settings-ui.css';
import { useAppStore } from '../store/appStore';
import { SettingsGroup } from './SettingsGroup';
import { isLineVisible } from './visibility';
import type { SettingsMode } from './types';
import { SettingsSearchBar } from './SettingsSearchBar';
import './SettingsSearch.css';
import { Icon } from '../shell/Icon';
import { useTranslation } from '../i18n';

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

  const printTab = layout?.tabs.find((t) => t.id === 'print');
  const pages = printTab?.pages || [];
  const currentPage = pages.find((p) => p.title === activePrintPage) || pages[0];
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentPage?.title]);

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
              aria-label={t('Save process preset')}
              title={t("Save current overrides as user process preset")}
              onClick={() => openSavePresetDialog('process')}
            >
              <Icon name="save" size={14} /> {t("Save")}</button>
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
        <p className="process-save-scope">{t('Save process preset for reuse. Save project keeps models and settings together.')}</p>

        {/* Search Input */}
        <SettingsSearchBar
          pages={pages}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onSelect={(key) => jumpToOption(key)}
        />
      </div>
      <div className="settings-tabs" role="tablist" ref={tabsRef}>
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
