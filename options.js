(function initializeShieldBlockOptions() {
  'use strict';

  const elements = {
    tabButtons: [...document.querySelectorAll('[data-tab]')],
    panels: [...document.querySelectorAll('[data-panel]')],
    heroStatus: document.getElementById('hero-status'),
    heroStatusText: document.getElementById('hero-status-text'),
    heroRules: document.getElementById('hero-rules'),
    heroUpdated: document.getElementById('hero-updated'),
    summaryRules: document.getElementById('summary-rules'),
    summaryUpdated: document.getElementById('summary-updated'),
    filterListContainer: document.getElementById('filter-list-container'),
    customRulesInput: document.getElementById('custom-rules-input'),
    saveCustomRules: document.getElementById('save-custom-rules'),
    allowlistContainer: document.getElementById('allowlist-container'),
    debugToggle: document.getElementById('debug-toggle'),
    exportSettings: document.getElementById('export-settings'),
    importFile: document.getElementById('import-file'),
    importSettings: document.getElementById('import-settings'),
    resetDefaults: document.getElementById('reset-defaults'),
    statusMessage: document.getElementById('status-message'),
  };

  const FILTER_LIST_ORDER = Object.freeze([
    'EasyList',
    'EasyPrivacy',
    'uBlock Filters',
    'AdGuard Base',
  ]);

  let currentSettings = {
    enabled: true,
    ruleCount: 0,
    lastUpdated: 0,
    debug: false,
    filterListStatus: [],
    filterListConfig: {},
    customRulesText: '',
    allowlistedDomains: [],
  };

  /**
   * Sends a message to the background worker.
   * @param {object} payload
   * @returns {Promise<any>}
   */
  async function sendMessage(payload) {
    return chrome.runtime.sendMessage(payload);
  }

  /**
   * Formats a timestamp for the options page.
   * @param {number} timestamp
   * @returns {string}
   */
  function formatTimestamp(timestamp) {
    if (!timestamp) {
      return 'never';
    }

    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  }

  /**
   * Formats integer counts.
   * @param {number} value
   * @returns {string}
   */
  function formatCount(value) {
    return new Intl.NumberFormat().format(Number(value || 0));
  }

  /**
   * Sets a transient status line.
   * @param {string} message
   * @param {'success' | 'error' | 'muted'} [tone='muted']
   * @returns {void}
   */
  function setStatus(message, tone = 'muted') {
    elements.statusMessage.textContent = message;
    elements.statusMessage.dataset.tone = tone;
  }

  /**
   * Clears and replaces a node's children.
   * @param {Element} node
   * @param {Node[]} children
   * @returns {void}
   */
  function replaceChildren(node, children) {
    node.replaceChildren(...children);
  }

  /**
   * Creates a button with shared settings.
   * @param {string} className
   * @param {string} label
   * @param {() => void | Promise<void>} handler
   * @returns {HTMLButtonElement}
   */
  function createActionButton(className, label, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', () => {
      void handler();
    });
    return button;
  }

  /**
   * Updates the hero and summary counters.
   * @returns {void}
   */
  function renderSummary() {
    const enabled = currentSettings.enabled !== false;
    elements.heroStatus.dataset.enabled = String(enabled);
    elements.heroStatusText.textContent = enabled ? 'Protection enabled' : 'Protection disabled';
    elements.heroRules.textContent = `Rules: ${formatCount(currentSettings.ruleCount)}`;
    elements.heroUpdated.textContent = `Updated: ${formatTimestamp(currentSettings.lastUpdated)}`;
    elements.summaryRules.textContent = formatCount(currentSettings.ruleCount);
    elements.summaryUpdated.textContent = formatTimestamp(currentSettings.lastUpdated);
    elements.debugToggle.checked = currentSettings.debug === true;
  }

  /**
   * Renders the filter list tab.
   * @returns {void}
   */
  function renderFilterLists() {
    const statusByName = new Map(
      (currentSettings.filterListStatus || []).map((item) => [item.name, item]),
    );
    const config = currentSettings.filterListConfig || {};
    const rows = FILTER_LIST_ORDER.map((name) => {
      const status = statusByName.get(name) || {
        name,
        enabled: config[name] !== false,
        ok: false,
        fetchedAt: 0,
        parsedRules: 0,
        ruleset: name === 'EasyPrivacy' ? 'trackers' : 'ads-core',
      };

      const row = document.createElement('div');
      row.className = 'list-row';

      const copy = document.createElement('div');
      copy.className = 'list-copy';

      const title = document.createElement('div');
      title.className = 'list-title';
      title.textContent = status.name;

      const meta = document.createElement('div');
      meta.className = 'list-meta';
      meta.textContent = [
        status.ruleset || 'ads-core',
        status.enabled === false ? 'disabled' : (status.ok ? 'ready' : 'waiting'),
        `rules ${formatCount(status.parsedRules || 0)}`,
        `fetched ${formatTimestamp(status.fetchedAt || 0)}`,
      ].join('  |  ');

      copy.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'row-actions';

      const toggleLabel = document.createElement('label');
      toggleLabel.className = 'toggle';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = config[name] !== false;
      checkbox.addEventListener('change', () => {
        void handleFilterListToggle(name, checkbox.checked);
      });
      const checkboxText = document.createElement('span');
      checkboxText.textContent = 'Enabled';
      toggleLabel.append(checkbox, checkboxText);

      const refreshButton = createActionButton('ghost-button', 'Fetch now', async () => {
        await handleRefreshList(name, refreshButton);
      });

      actions.append(toggleLabel, refreshButton);
      row.append(copy, actions);
      return row;
    });

    replaceChildren(elements.filterListContainer, rows);
  }

  /**
   * Renders the allowlist tab.
   * @returns {void}
   */
  function renderAllowlist() {
    const domains = Array.isArray(currentSettings.allowlistedDomains)
      ? currentSettings.allowlistedDomains
      : [];

    if (domains.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No domains are currently allowlisted.';
      replaceChildren(elements.allowlistContainer, [empty]);
      return;
    }

    const rows = domains.map((domain) => {
      const row = document.createElement('div');
      row.className = 'allowlist-row';

      const copy = document.createElement('div');
      copy.className = 'allowlist-copy';

      const domainNode = document.createElement('div');
      domainNode.className = 'allowlist-domain';
      domainNode.textContent = domain;

      const meta = document.createElement('div');
      meta.className = 'allowlist-meta';
      meta.textContent = 'Dynamic allow rule active';

      copy.append(domainNode, meta);

      const removeButton = createActionButton('ghost-button', 'Remove', async () => {
        await handleRemoveAllowlist(domain);
      });

      row.append(copy, removeButton);
      return row;
    });

    replaceChildren(elements.allowlistContainer, rows);
  }

  /**
   * Renders all stateful UI sections.
   * @returns {void}
   */
  function render() {
    renderSummary();
    renderFilterLists();
    renderAllowlist();
    if (document.activeElement !== elements.customRulesInput) {
      elements.customRulesInput.value = currentSettings.customRulesText || '';
    }
  }

  /**
   * Loads the latest settings from the background worker.
   * @returns {Promise<void>}
   */
  async function loadSettings() {
    const settings = await sendMessage({ action: 'getSettings' });
    currentSettings = {
      ...currentSettings,
      ...settings,
    };
    render();
  }

  /**
   * Activates a specific tab.
   * @param {string} tabName
   * @returns {void}
   */
  function switchTab(tabName) {
    for (const button of elements.tabButtons) {
      button.setAttribute('aria-selected', String(button.dataset.tab === tabName));
    }

    for (const panel of elements.panels) {
      panel.hidden = panel.dataset.panel !== tabName;
    }
  }

  /**
   * Handles saving custom rules.
   * @returns {Promise<void>}
   */
  async function handleSaveCustomRules() {
    elements.saveCustomRules.disabled = true;
    try {
      const settings = await sendMessage({
        action: 'saveCustomRules',
        rulesText: elements.customRulesInput.value,
      });
      currentSettings = {
        ...currentSettings,
        ...settings,
      };
      render();
      setStatus('Custom rules saved.', 'success');
    } catch {
      setStatus('Saving custom rules failed.', 'error');
    } finally {
      elements.saveCustomRules.disabled = false;
    }
  }

  /**
   * Handles a filter list toggle change.
   * @param {string} name
   * @param {boolean} enabled
   * @returns {Promise<void>}
   */
  async function handleFilterListToggle(name, enabled) {
    setStatus(`Updating ${name}...`);
    try {
      const settings = await sendMessage({
        action: 'setFilterListEnabled',
        name,
        enabled,
      });
      currentSettings = {
        ...currentSettings,
        ...settings,
      };
      render();
      setStatus(`${name} updated.`, 'success');
    } catch {
      setStatus(`Updating ${name} failed.`, 'error');
      await loadSettings();
    }
  }

  /**
   * Refreshes a filter list from the options page.
   * @param {string} name
   * @param {HTMLButtonElement} button
   * @returns {Promise<void>}
   */
  async function handleRefreshList(name, button) {
    const previousLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Refreshing...';
    setStatus(`Refreshing ${name}...`);

    try {
      const settings = await sendMessage({
        action: 'refreshList',
        name,
      });
      currentSettings = {
        ...currentSettings,
        ...settings,
      };
      render();
      setStatus(`${name} refreshed.`, 'success');
    } catch {
      setStatus(`Refreshing ${name} failed.`, 'error');
      await loadSettings();
    } finally {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }

  /**
   * Removes a domain from the allowlist.
   * @param {string} domain
   * @returns {Promise<void>}
   */
  async function handleRemoveAllowlist(domain) {
    setStatus(`Removing ${domain} from the allowlist...`);
    try {
      await sendMessage({
        action: 'removeAllowlistDomain',
        domain,
      });
      await loadSettings();
      setStatus(`${domain} removed from the allowlist.`, 'success');
    } catch {
      setStatus(`Removing ${domain} failed.`, 'error');
    }
  }

  /**
   * Toggles debug mode.
   * @returns {Promise<void>}
   */
  async function handleDebugToggle() {
    try {
      const settings = await sendMessage({
        action: 'setDebug',
        enabled: elements.debugToggle.checked,
      });
      currentSettings = {
        ...currentSettings,
        ...settings,
      };
      render();
      setStatus(`Debug mode ${elements.debugToggle.checked ? 'enabled' : 'disabled'}.`, 'success');
    } catch {
      elements.debugToggle.checked = !elements.debugToggle.checked;
      setStatus('Updating debug mode failed.', 'error');
    }
  }

  /**
   * Downloads the current storage payload as JSON.
   * @returns {Promise<void>}
   */
  async function handleExportSettings() {
    try {
      const payload = await chrome.storage.local.get(null);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `shieldblock-settings-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus('Settings exported.', 'success');
    } catch {
      setStatus('Export failed.', 'error');
    }
  }

  /**
   * Imports settings from a selected JSON file.
   * @param {File} file
   * @returns {Promise<void>}
   */
  async function handleImportFile(file) {
    if (!(file instanceof File)) {
      return;
    }

    setStatus(`Importing ${file.name}...`);

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const settings = await sendMessage({
        action: 'importSettings',
        payload,
      });
      currentSettings = {
        ...currentSettings,
        ...settings,
      };
      render();
      setStatus('Settings imported.', 'success');
    } catch {
      setStatus('Import failed. Please provide a valid ShieldBlock JSON export.', 'error');
    } finally {
      elements.importFile.value = '';
    }
  }

  /**
   * Resets the extension to defaults.
   * @returns {Promise<void>}
   */
  async function handleResetDefaults() {
    if (!window.confirm('Reset ShieldBlock AI to defaults? This clears local rules, allowlists, and counters.')) {
      return;
    }

    elements.resetDefaults.disabled = true;
    setStatus('Resetting ShieldBlock AI...');
    try {
      const settings = await sendMessage({ action: 'resetToDefaults' });
      currentSettings = {
        ...currentSettings,
        ...settings,
      };
      render();
      setStatus('ShieldBlock AI reset to defaults.', 'success');
    } catch {
      setStatus('Reset failed.', 'error');
    } finally {
      elements.resetDefaults.disabled = false;
    }
  }

  for (const button of elements.tabButtons) {
    button.addEventListener('click', () => {
      switchTab(button.dataset.tab || 'filters');
    });
  }

  elements.saveCustomRules.addEventListener('click', () => {
    void handleSaveCustomRules();
  });

  elements.debugToggle.addEventListener('change', () => {
    void handleDebugToggle();
  });

  elements.exportSettings.addEventListener('click', () => {
    void handleExportSettings();
  });

  elements.importSettings.addEventListener('click', () => {
    elements.importFile.click();
  });

  elements.importFile.addEventListener('change', () => {
    const file = elements.importFile.files?.[0];
    void handleImportFile(file);
  });

  elements.resetDefaults.addEventListener('click', () => {
    void handleResetDefaults();
  });

  void loadSettings().catch(() => {
    setStatus('Unable to load ShieldBlock settings.', 'error');
  });
})();
